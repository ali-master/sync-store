import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger } from "@nestjs/common";
import { CommandBus, QueryBus, EventBus } from "@nestjs/cqrs";
import { SetItemCommand } from "../commands/impl/set-item.command";
import { RemoveItemCommand } from "../commands/impl/remove-item.command";
import { GetItemQuery } from "../queries/impl/get-item.query";
import { GetAllItemsQuery } from "../queries/impl/get-all-items.query";
import { UserSessionService } from "../services/user-session.service";
import { SyncQueueService } from "../services/sync-queue.service";
import { ItemSyncedEvent } from "../events/impl/item-synced.event";
import { ItemRemovedEvent } from "../events/impl/item-removed.event";

interface SyncMessage {
  type: "set" | "remove" | "get" | "getAll" | "subscribe" | "unsubscribe";
  key?: string;
  value?: any;
  metadata?: Record<string, any>;
  prefix?: string;
  userId: string;
  instanceId: string;
  timestamp?: number;
  version?: number;
}

interface SyncResponse {
  type: "sync" | "response" | "error";
  key?: string;
  value?: any;
  metadata?: Record<string, any>;
  items?: any[];
  error?: string;
  timestamp: number;
  version?: number;
}

@WebSocketGateway({
  namespace: "/sync",
  cors: {
    origin: "*",
    credentials: true,
  },
})
export class SyncStorageGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SyncStorageGateway.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly eventBus: EventBus,
    private readonly userSessionService: UserSessionService,
    private readonly syncQueueService: SyncQueueService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const userId = client.handshake.query.userId as string;
    const instanceId = client.handshake.query.instanceId as string;

    if (!userId || !instanceId) {
      client.disconnect();
      return;
    }

    this.logger.log(`Client connected: ${client.id} (User: ${userId})`);

    await this.userSessionService.addSession(userId, instanceId, client.id);

    client.join(`user:${userId}`);
    client.join(`instance:${instanceId}`);

    const pendingUpdates = await this.syncQueueService.getPendingUpdates(userId, instanceId);

    if (pendingUpdates.length > 0) {
      client.emit("pending-updates", pendingUpdates);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.handshake.query.userId as string;
    const instanceId = client.handshake.query.instanceId as string;

    this.logger.log(`Client disconnected: ${client.id}`);

    if (userId && instanceId) {
      await this.userSessionService.removeSession(userId, instanceId, client.id);
    }
  }

  @SubscribeMessage("sync:set")
  async handleSetItem(
    @MessageBody() data: SyncMessage,
    @ConnectedSocket() client: Socket,
  ): Promise<SyncResponse> {
    try {
      const { key, value, metadata, userId, instanceId } = data;

      if (!key || value === undefined) {
        throw new WsException("Key and value are required");
      }

      const command = new SetItemCommand(userId, instanceId, key, value, metadata);

      const result = await this.commandBus.execute(command);

      this.server.to(`user:${userId}`).except(client.id).emit("sync:update", {
        type: "sync",
        key,
        value: result.value,
        metadata: result.metadata,
        timestamp: result.timestamp,
        version: result.version,
      });

      this.eventBus.publish(new ItemSyncedEvent(userId, instanceId, key, value, metadata));

      return {
        type: "response",
        key,
        value: result.value,
        metadata: result.metadata,
        timestamp: result.timestamp,
        version: result.version,
      };
    } catch (error) {
      this.logger.error("Error setting item:", error);
      return {
        type: "error",
        error: error instanceof Error ? error.message : "Failed to set item",
        timestamp: Date.now(),
      };
    }
  }

  @SubscribeMessage("sync:remove")
  async handleRemoveItem(
    @MessageBody() data: SyncMessage,
    @ConnectedSocket() client: Socket,
  ): Promise<SyncResponse> {
    try {
      const { key, userId, instanceId } = data;

      if (!key) {
        throw new WsException("Key is required");
      }

      const command = new RemoveItemCommand(userId, instanceId, key);
      await this.commandBus.execute(command);

      this.server.to(`user:${userId}`).except(client.id).emit("sync:remove", {
        type: "sync",
        key,
        timestamp: Date.now(),
      });

      this.eventBus.publish(new ItemRemovedEvent(userId, instanceId, key));

      return {
        type: "response",
        key,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error("Error removing item:", error);
      return {
        type: "error",
        error: error instanceof Error ? error.message : "Failed to remove item",
        timestamp: Date.now(),
      };
    }
  }

  @SubscribeMessage("sync:get")
  async handleGetItem(@MessageBody() data: SyncMessage): Promise<SyncResponse> {
    try {
      const { key, userId, instanceId } = data;

      if (!key) {
        throw new WsException("Key is required");
      }

      const query = new GetItemQuery(userId, instanceId, key);
      const result = await this.queryBus.execute(query);

      if (!result) {
        return {
          type: "response",
          key,
          value: null,
          timestamp: Date.now(),
        };
      }

      return {
        type: "response",
        key,
        value: result.value,
        metadata: result.metadata,
        timestamp: result.timestamp,
        version: result.version,
      };
    } catch (error) {
      this.logger.error("Error getting item:", error);
      return {
        type: "error",
        error: error instanceof Error ? error.message : "Failed to get item",
        timestamp: Date.now(),
      };
    }
  }

  @SubscribeMessage("sync:getAll")
  async handleGetAllItems(@MessageBody() data: SyncMessage): Promise<SyncResponse> {
    try {
      const { userId, instanceId, prefix } = data;

      const query = new GetAllItemsQuery(userId, instanceId, prefix);
      const items = await this.queryBus.execute(query);

      return {
        type: "response",
        items,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error("Error getting all items:", error);
      return {
        type: "error",
        error: error instanceof Error ? error.message : "Failed to get items",
        timestamp: Date.now(),
      };
    }
  }

  @SubscribeMessage("sync:subscribe")
  async handleSubscribe(
    @MessageBody() data: { keys: string[]; userId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const { keys, userId } = data;

    keys.forEach((key) => {
      client.join(`key:${userId}:${key}`);
    });
  }

  @SubscribeMessage("sync:unsubscribe")
  async handleUnsubscribe(
    @MessageBody() data: { keys: string[]; userId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const { keys, userId } = data;

    keys.forEach((key) => {
      client.leave(`key:${userId}:${key}`);
    });
  }

  broadcastToUser(userId: string, event: string, data: any): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  broadcastToInstance(instanceId: string, event: string, data: any): void {
    this.server.to(`instance:${instanceId}`).emit(event, data);
  }

  broadcastToKey(userId: string, key: string, event: string, data: any): void {
    this.server.to(`key:${userId}:${key}`).emit(event, data);
  }
}
