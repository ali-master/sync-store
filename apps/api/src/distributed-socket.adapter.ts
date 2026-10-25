import { IoAdapter } from "@nestjs/platform-socket.io";
import type { Server, ServerOptions } from "socket.io";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-streams-adapter";

/** Forward room events and socket-management requests across replicas of one installation. */
export class DistributedSocketAdapter extends IoAdapter {
  private redis?: Pick<ReturnType<typeof createClient>, "isOpen" | "destroy">;
  private adapter?: ReturnType<typeof createAdapter>;
  private readonly servers = new Set<Server>();

  /** Refuse startup rather than silently create an isolated node when Redis is configured. */
  async connect(url: string, prefix: string) {
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(prefix)) throw new Error("Invalid SOCKET_IO_PREFIX");
    const client = createClient({ url, socket: { connectTimeout: 5000 } });
    client.on("error", () => this.logger.error("Socket.IO Redis connection unavailable"));
    client.on("ready", () => {
      // A lost publish cannot be replayed from Redis; reconnect makes the SDK reload MongoDB.
      for (const server of this.servers) {
        for (const socket of server.of("/sync").sockets.values()) socket.conn.close();
      }
    });
    this.redis = client;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Socket.IO Redis startup timed out")), 10000);
        }),
      ]);
      this.adapter = createAdapter(client, {
        streamName: `${prefix}:events`,
        channelPrefix: `${prefix}:control`,
        maxLen: 100_000,
      });
    } catch (error) {
      if (client.isOpen) client.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    if (!this.adapter) throw new Error("Connect Redis before creating the socket server");
    const server = super.createIOServer(port, options);
    server.adapter(this.adapter);
    this.servers.add(server);
    return server;
  }

  async dispose() {
    this.servers.clear();
    if (this.redis?.isOpen) this.redis.destroy();
    await super.dispose();
  }
}
