import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from 'src/common/types/domain.types';

/**
 * Pushes ledger and notification events to the browser so dashboards update
 * without polling. Every socket joins a room named after its user id, which
 * is also the authorisation boundary - a client can only ever receive its own
 * events.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(EventsGateway.name);
  private readonly online = new Map<string, Set<string>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);

    if (!token) {
      client.emit('error', { message: 'Missing auth token' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
      const set = this.online.get(payload.sub) ?? new Set<string>();
      set.add(client.id);
      this.online.set(payload.sub, set);
      client.emit('connected', { userId: payload.sub, at: new Date().toISOString() });
    } catch {
      client.emit('error', { message: 'Invalid token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.userId as string | undefined;
    if (!userId) return;
    const set = this.online.get(userId);
    set?.delete(client.id);
    if (set && set.size === 0) this.online.delete(userId);
  }

  onlineCount(): number {
    return this.online.size;
  }

  private push(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  @OnEvent('transaction.created')
  onTxCreated(p: { userId: string; transaction: unknown }) {
    this.push(p.userId, 'transaction.created', p.transaction);
  }

  @OnEvent('transaction.updated')
  onTxUpdated(p: { userId: string; transaction: unknown }) {
    this.push(p.userId, 'transaction.updated', p.transaction);
  }

  @OnEvent('transaction.deleted')
  onTxDeleted(p: { userId: string; id: string }) {
    this.push(p.userId, 'transaction.deleted', { id: p.id });
  }

  @OnEvent('notification.created')
  onNotification(p: { userId: string; notification: unknown }) {
    this.push(p.userId, 'notification', p.notification);
  }

  @OnEvent('import.progress')
  onImportProgress(p: { userId: string; processed: number; total: number }) {
    this.push(p.userId, 'import.progress', p);
  }

  @OnEvent('sync.progress')
  onSyncProgress(p: { userId: string; provider: string; status: string }) {
    this.push(p.userId, 'sync.progress', p);
  }
}
