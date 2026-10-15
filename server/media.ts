import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpError } from './search.js';
import { digest } from './auth.js';
import type { Store } from './store.js';
import type { Call, User } from '../src/types.js';

export function mediaConfig() {
  const dev = process.env.LIVEKIT_DEV_MODE === 'true';
  const url = process.env.LIVEKIT_URL ?? (dev ? 'ws://127.0.0.1:7880' : '');
  const file = resolve('.tools/media-dev.json');
  const local =
    dev && existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as { apiKey?: string; apiSecret?: string })
      : {};
  const key = process.env.LIVEKIT_API_KEY ?? local.apiKey ?? '';
  const secret = process.env.LIVEKIT_API_SECRET ?? local.apiSecret ?? '';
  if (!url || !key || !secret) return null;
  const parsed = new URL(url);
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('LIVEKIT_URL must be a WebSocket URL without embedded credentials');
  return { url: parsed.toString(), key, secret };
}
export class MediaService {
  readonly config = mediaConfig();
  readonly calls = new Map<string, Call>();
  private grants = new Map<
    string,
    { room: string; identity: string; userId: string; session: string }
  >();
  private client = this.config
    ? new RoomServiceClient(
        this.config.url.replace(/^ws/, 'http'),
        this.config.key,
        this.config.secret,
      )
    : null;
  constructor(
    private store: Store,
    private notify: (userId: string, call: Call | null) => void,
  ) {}
  get currentOrigins() {
    if (!this.config) return '';
    const url = new URL(this.config.url);
    return `${url.origin} ${url.origin.replace(/^ws/, 'http')}`;
  }
  private ready() {
    if (!this.config)
      throw new HttpError(503, 'Mídia não configurada. Inicie o LiveKit e configure o servidor.');
    return this.config;
  }
  currentCall(userId: string) {
    return (
      [...this.calls.values()].find(
        (call) => call.caller.id === userId || call.callee.id === userId,
      ) ?? null
    );
  }
  start(channelId: string, caller: User, callee: User) {
    this.ready();
    this.store.requireMembership(channelId, caller.id);
    this.store.requireMembership(channelId, callee.id);
    if (caller.id === callee.id) throw new HttpError(400, 'Escolha outra pessoa.');
    if (this.currentCall(caller.id) || this.currentCall(callee.id))
      throw new HttpError(409, 'Uma das pessoas já está em uma chamada.');
    const call: Call = {
      id: randomUUID(),
      channelId,
      caller,
      callee,
      state: 'ringing',
      expiresAt: Date.now() + 45000,
    };
    this.calls.set(call.id, call);
    this.broadcast(call);
    return call;
  }
  accept(id: string, user: User) {
    const call = this.forUser(id, user.id);
    if (call.callee.id !== user.id || call.state !== 'ringing')
      throw new HttpError(409, 'Este convite não pode ser aceito.');
    if (call.expiresAt <= Date.now()) throw new HttpError(410, 'O convite expirou.');
    call.state = 'active';
    this.broadcast(call);
    return call;
  }
  private forUser(id: string, userId: string) {
    const call = this.calls.get(id);
    if (!call || ![call.caller.id, call.callee.id].includes(userId))
      throw new HttpError(404, 'Chamada não encontrada.');
    this.store.requireMembership(call.channelId, userId);
    return call;
  }
  private broadcast(call: Call) {
    this.notify(call.caller.id, call);
    this.notify(call.callee.id, call);
  }
  async end(id: string, userId: string) {
    this.forUser(id, userId);
    await this.finish(id);
  }
  private async finish(id: string) {
    const call = this.calls.get(id);
    if (!call) return;
    this.calls.delete(id);
    for (const [key, grant] of this.grants)
      if (grant.room === `call-${id}`) this.grants.delete(key);
    this.notify(call.caller.id, null);
    this.notify(call.callee.id, null);
    try {
      await this.client?.deleteRoom(`call-${id}`);
    } catch {
      /* A room may not have been created yet. */
    }
  }
  async expire() {
    for (const grant of [...this.grants.values()])
      if (
        !this.store.db
          .prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?')
          .get(grant.session, Date.now())
      )
        await this.revoke(grant.userId);
    for (const call of this.calls.values())
      if (call.state === 'ringing' && call.expiresAt <= Date.now()) await this.finish(call.id);
  }
  async token(channelId: string, user: User, sessionToken: string, callId?: string) {
    const config = this.ready();
    this.store.requireMembership(channelId, user.id);
    let room = `channel-${channelId}`;
    if (callId) {
      const call = this.forUser(callId, user.id);
      if (call.channelId !== channelId || call.state !== 'active')
        throw new HttpError(403, 'Aceite o convite antes de entrar.');
      room = `call-${callId}`;
    }
    const session = digest(sessionToken);
    const identity = `${user.id}:${session.slice(0, 12)}`;
    const jwt = new AccessToken(config.key, config.secret, {
      identity,
      name: user.name,
      ttl: 20,
      metadata: JSON.stringify({ userId: user.id }),
    });
    jwt.addGrant({
      room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      canPublishData: false,
      canPublishSources: [
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
    });
    this.grants.set(`${room}:${identity}`, { room, identity, userId: user.id, session });
    return { url: config.url, token: await jwt.toJwt(), room };
  }
  async leave(channelId: string, userId: string, token: string, callId?: string) {
    const room = callId ? `call-${callId}` : `channel-${channelId}`;
    const identity = `${userId}:${digest(token).slice(0, 12)}`;
    this.grants.delete(`${room}:${identity}`);
    try {
      await this.client?.removeParticipant(room, identity);
    } catch {
      /* Already disconnected is a successful local cleanup. */
    }
  }
  async revoke(userId: string, session?: string, communityId?: string) {
    const channels = communityId
      ? new Set(this.store.getChannels(communityId).map((c) => `channel-${c.id}`))
      : null;
    for (const call of [...this.calls.values()])
      if (
        [call.caller.id, call.callee.id].includes(userId) &&
        (!communityId || this.store.getChannels(communityId).some((c) => c.id === call.channelId))
      )
        await this.finish(call.id);
    const operations: Promise<unknown>[] = [];
    for (const [id, grant] of this.grants)
      if (
        grant.userId === userId &&
        (!session || grant.session === digest(session)) &&
        (!channels || channels.has(grant.room))
      ) {
        this.grants.delete(id);
        operations.push(this.client!.removeParticipant(grant.room, grant.identity));
      }
    await Promise.allSettled(operations);
  }
}
