import { Injectable, Logger } from "@nestjs/common";

export interface UserSession {
  userId: string;
  instanceId: string;
  socketId: string;
  connectedAt: Date;
  lastActivity: Date;
  metadata?: Record<string, any>;
}

@Injectable()
export class UserSessionService {
  private readonly logger = new Logger(UserSessionService.name);
  private readonly sessions = new Map<string, UserSession[]>();
  private readonly socketToSession = new Map<string, UserSession>();

  async addSession(
    userId: string,
    instanceId: string,
    socketId: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const session: UserSession = {
      userId,
      instanceId,
      socketId,
      connectedAt: new Date(),
      lastActivity: new Date(),
      metadata,
    };

    if (!this.sessions.has(userId)) {
      this.sessions.set(userId, []);
    }

    const userSessions = this.sessions.get(userId)!;
    const existingIndex = userSessions.findIndex(
      (s) => s.instanceId === instanceId && s.socketId === socketId,
    );

    if (existingIndex >= 0) {
      userSessions[existingIndex] = session;
    } else {
      userSessions.push(session);
    }

    this.socketToSession.set(socketId, session);

    this.logger.debug(
      `Added session for user ${userId}, instance ${instanceId}, socket ${socketId}`,
    );
  }

  async removeSession(userId: string, instanceId: string, socketId: string): Promise<void> {
    const userSessions = this.sessions.get(userId);

    if (userSessions) {
      const filteredSessions = userSessions.filter(
        (s) => !(s.instanceId === instanceId && s.socketId === socketId),
      );

      if (filteredSessions.length === 0) {
        this.sessions.delete(userId);
      } else {
        this.sessions.set(userId, filteredSessions);
      }
    }

    this.socketToSession.delete(socketId);

    this.logger.debug(
      `Removed session for user ${userId}, instance ${instanceId}, socket ${socketId}`,
    );
  }

  getUserSessions(userId: string): UserSession[] {
    return this.sessions.get(userId) || [];
  }

  getSessionBySocket(socketId: string): UserSession | undefined {
    return this.socketToSession.get(socketId);
  }

  getActiveUsers(): string[] {
    return Array.from(this.sessions.keys());
  }

  getActiveInstancesForUser(userId: string): string[] {
    const sessions = this.getUserSessions(userId);
    const instances = new Set(sessions.map((s) => s.instanceId));
    return Array.from(instances);
  }

  updateLastActivity(socketId: string): void {
    const session = this.socketToSession.get(socketId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  async cleanupInactiveSessions(maxInactiveMinutes: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - maxInactiveMinutes * 60 * 1000);
    let cleaned = 0;

    for (const [userId, sessions] of this.sessions.entries()) {
      const activeSessions = sessions.filter((s) => s.lastActivity >= cutoff);

      const inactiveSessions = sessions.filter((s) => s.lastActivity < cutoff);
      inactiveSessions.forEach((s) => {
        this.socketToSession.delete(s.socketId);
        cleaned++;
      });

      if (activeSessions.length === 0) {
        this.sessions.delete(userId);
      } else {
        this.sessions.set(userId, activeSessions);
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} inactive sessions`);
    }

    return cleaned;
  }

  getTotalSessions(): number {
    let total = 0;
    for (const sessions of this.sessions.values()) {
      total += sessions.length;
    }
    return total;
  }

  getUserStats(userId: string) {
    const sessions = this.getUserSessions(userId);
    const instances = this.getActiveInstancesForUser(userId);

    return {
      userId,
      totalSessions: sessions.length,
      activeInstances: instances.length,
      instances,
      sessions: sessions.map((s) => ({
        instanceId: s.instanceId,
        socketId: s.socketId,
        connectedAt: s.connectedAt,
        lastActivity: s.lastActivity,
        metadata: s.metadata,
      })),
    };
  }
}
