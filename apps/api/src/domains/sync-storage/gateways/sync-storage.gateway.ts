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
import { Logger, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../guards/api-key.guard";
import { ClearStorageCommand } from "../commands/impl/clear-storage.command";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { SetItemCommand } from "../commands/impl/set-item.command";
import { RemoveItemCommand } from "../commands/impl/remove-item.command";
import { GetItemQuery } from "../queries/impl/get-item.query";
import { GetAllItemsQuery } from "../queries/impl/get-all-items.query";
import { permits } from "../services/access-policy";
import { socketCorsOrigin } from "../../../cors";

interface SyncMessage {
  requestId?: string;
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
  id?: string;
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
  transports: ["websocket"],
  cors: {
    origin: socketCorsOrigin,
    credentials: false,
  },
})
@UseGuards(ApiKeyGuard)
export class SyncStorageGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SyncStorageGateway.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly apiKeyGuard: ApiKeyGuard,
  ) {}

  /** Authenticate before Socket.IO exposes the namespace as connected. */
  afterInit(server: Server): void {
    server.use((client, next) => {
      void this.apiKeyGuard.authorizeSocket(client).then(
        () => next(),
        () => next(new Error("Unauthorized")),
      );
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const { userId, instanceId } = client.data.identity ?? {};

    if (!userId || !instanceId) {
      client.disconnect();
      return;
    }

    this.logger.log(`Client connected: ${client.id} (User: ${userId})`);

    client.data.connectedAt = Date.now();
    await client.join(`user:${userId}`);
    await client.join(JSON.stringify([userId, instanceId]));

    // Notify this instance about successful connection
    this.notifyInstanceConnectionStatus(userId, instanceId, "connected");
  }

  /** Expose active connection identity without leaking handshake credentials. */
  async getSessions() {
    const sockets = await this.server.fetchSockets();
    return sockets
      .filter((socket) => socket.data.identity)
      .map((socket) => ({
        _id: socket.id,
        userId: String(socket.data.identity.userId),
        instanceId: String(socket.data.identity.instanceId),
        socketId: socket.id,
        connectedAt: new Date(socket.data.connectedAt ?? socket.handshake.time),
        connectionType: "websocket",
        disconnectedAt: null,
      }));
  }

  /** Disconnect the requested session on whichever replica owns its socket. */
  async disconnectSession(socketId: string): Promise<number> {
    const sockets = await this.server.in(socketId).fetchSockets();
    for (const socket of sockets) socket.disconnect(true);
    return sockets.length;
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const { userId, instanceId } = client.data.identity ?? {};

    this.logger.log(`Client disconnected: ${client.id}`);

    if (userId && instanceId) {
      // Notify this instance about disconnection
      this.notifyInstanceConnectionStatus(userId, instanceId, "disconnected");
    }
  }

  @SubscribeMessage("sync:set")
  async handleSetItem(
    @MessageBody() data: SyncMessage,
    @ConnectedSocket() client: Socket,
  ): Promise<SyncResponse> {
    try {
      const { key, value, metadata } = data;
      const { userId, instanceId } = client.data.identity;

      if (!key || value === undefined) {
        throw new WsException("Key and value are required");
      }

      const command = new SetItemCommand(userId, instanceId, key, value, metadata, data.requestId);

      const result = await this.commandBus.execute(command);

      return {
        type: "response",
        key,
        value: result.value,
        id: result.id,
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
      const { key } = data;
      const { userId, instanceId } = client.data.identity;

      if (!key) {
        throw new WsException("Key is required");
      }

      const command = new RemoveItemCommand(userId, instanceId, key, data.requestId);
      await this.commandBus.execute(command);

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
  async handleGetItem(
    @MessageBody() data: SyncMessage,
    @ConnectedSocket() client: Socket,
  ): Promise<SyncResponse> {
    try {
      const { key } = data;
      const { userId, instanceId } = client.data.identity;

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
        id: result.id,
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
  async handleGetAllItems(
    @MessageBody() data: SyncMessage,
    @ConnectedSocket() client: Socket,
  ): Promise<SyncResponse> {
    try {
      const { prefix } = data;
      const { userId, instanceId } = client.data.identity;

      const query = new GetAllItemsQuery(userId, instanceId, prefix);
      const items = await this.queryBus.execute(query);

      return {
        type: "response",
        items: client.data.access
          ? items.filter((item: any) => permits(client.data.access, item.key, true))
          : items,
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
  ): Promise<SyncResponse> {
    const { keys } = data;
    const { userId } = client.data.identity;
    if (!Array.isArray(keys) || keys.length > 1000 || keys.some((key) => typeof key !== "string"))
      throw new WsException("Invalid subscription keys");

    keys.forEach((key) => {
      client.join(`key:${userId}:${key}`);
    });
    return { type: "response", timestamp: Date.now() };
  }

  @SubscribeMessage("sync:unsubscribe")
  async handleUnsubscribe(
    @MessageBody() data: { keys: string[]; userId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<SyncResponse> {
    const { keys } = data;
    const { userId } = client.data.identity;
    if (!Array.isArray(keys) || keys.length > 1000 || keys.some((key) => typeof key !== "string"))
      throw new WsException("Invalid subscription keys");

    keys.forEach((key) => {
      client.leave(`key:${userId}:${key}`);
    });
    return { type: "response", timestamp: Date.now() };
  }

  /** Clear only the authenticated user's records. */
  @SubscribeMessage("sync:clear")
  async handleClear(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { requestId?: string } = {},
  ): Promise<SyncResponse> {
    const { userId, instanceId } = client.data.identity;
    await this.commandBus.execute(new ClearStorageCommand(userId, instanceId, data.requestId));
    return { type: "response", timestamp: Date.now() };
  }

  broadcastToUser(userId: string, event: string, data: any): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /** Only current authorized recipients become targets in the durable Redis broadcast. */
  async recipientRooms(userId: string, key: string): Promise<string[]> {
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    const allowed = await Promise.all(
      sockets.map(async (socket) =>
        (await this.apiKeyGuard.canReceive(socket.data, key)) ? socket.id : null,
      ),
    );
    return allowed.filter((id): id is string => id !== null);
  }

  broadcastToRooms(rooms: string[], event: string, data: unknown): void {
    if (rooms.length) this.server.to(rooms).emit(event, data);
  }

  broadcastToInstance(userId: string, instanceId: string, event: string, data: any): void {
    this.server.to(JSON.stringify([userId, instanceId])).emit(event, data);
  }

  broadcastToKey(userId: string, key: string, event: string, data: any): void {
    this.server.to(`key:${userId}:${key}`).emit(event, data);
  }

  broadcastToUserExcept(userId: string, excludeSocketId: string, event: string, data: any): void {
    this.server.to(`user:${userId}`).except(excludeSocketId).emit(event, data);
  }

  // Utility methods for common broadcast scenarios
  notifyUserStorageQuotaExceeded(userId: string, currentSize: number, maxSize: number): void {
    this.broadcastToUser(userId, "storage:quota-exceeded", {
      currentSize,
      maxSize,
      timestamp: Date.now(),
    });
  }

  notifyInstanceConnectionStatus(
    userId: string,
    instanceId: string,
    status: "connected" | "disconnected",
  ): void {
    this.broadcastToInstance(userId, instanceId, "connection:status", {
      status,
      timestamp: Date.now(),
    });
  }

  notifyUserSyncComplete(userId: string, syncedKeys: string[]): void {
    this.broadcastToUser(userId, "sync:complete", {
      keys: syncedKeys,
      count: syncedKeys.length,
      timestamp: Date.now(),
    });
  }
}
