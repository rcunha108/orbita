import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Auth } from './auth.js';
import { sessionToken } from './auth.js';
import { MediaService } from './media.js';
import type { Store } from './store.js';
import type { Message, User } from '../src/types.js';

export function attachRealtime(server: HttpServer, store: Store, auth: Auth) {
  const io = new Server(server, {
    maxHttpBufferSize: 8192,
    allowRequest: (req, done) => {
      let valid = !req.headers.origin;
      try {
        if (req.headers.origin) valid = new URL(req.headers.origin).host === req.headers.host;
      } catch {
        valid = false;
      }
      done(null, valid);
    },
  });
  const media = new MediaService(store, (userId, call) =>
    io.to(`user:${userId}`).emit('call', call),
  );
  const typing = new Map<string, { channelId: string; user: User; until: number }>();
  const room = (channelId: string) => `channel:${channelId}`;
  function presence(channelId: string) {
    const users = new Map<string, User>();
    for (const socket of io.sockets.sockets.values())
      if (socket.data.channelId === channelId && auth.userForToken(socket.data.token))
        users.set(socket.data.user.id, socket.data.user);
    io.to(room(channelId)).emit('presence', [...users.values()]);
  }
  function stopTyping(socketId: string) {
    const item = typing.get(socketId);
    typing.delete(socketId);
    if (item)
      io.to(room(item.channelId)).emit('typing', {
        userId: item.user.id,
        name: item.user.name,
        until: 0,
      });
  }
  io.use((socket, next) => {
    try {
      const token = sessionToken(socket.request.headers.cookie);
      socket.data.user = auth.require(token);
      socket.data.token = token;
      next();
    } catch {
      next(new Error('Sua sessão expirou. Entre novamente.'));
    }
  });
  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.user.id}`);
    socket.on('channel:join', (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      try {
        const user = auth.require(socket.data.token);
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('channelId' in payload) ||
          typeof payload.channelId !== 'string'
        )
          throw new Error('Canal inválido.');
        store.requireMembership(payload.channelId, user.id);
        const previous = socket.data.channelId as string | undefined;
        stopTyping(socket.id);
        if (previous) void socket.leave(room(previous));
        socket.data.channelId = payload.channelId;
        void socket.join(room(payload.channelId));
        ack({ ok: true, history: store.getMessages(payload.channelId, null, user.id) });
        if (previous) presence(previous);
        presence(payload.channelId);
      } catch (error) {
        ack({
          ok: false,
          error: error instanceof Error ? error.message : 'Não foi possível acessar o canal.',
        });
      }
    });
    socket.on('typing', (active: unknown) => {
      try {
        const user = auth.require(socket.data.token);
        const channelId = socket.data.channelId as string | undefined;
        if (!channelId || typeof active !== 'boolean') return;
        store.requireMembership(channelId, user.id);
        if (!active) {
          stopTyping(socket.id);
          return;
        }
        const previous = typing.get(socket.id);
        if (previous && previous.until - Date.now() > 2500) return;
        const until = Date.now() + 4000;
        typing.set(socket.id, { channelId, user, until });
        socket.to(room(channelId)).emit('typing', { userId: user.id, name: user.name, until });
      } catch {
        socket.disconnect(true);
      }
    });
    socket.on('disconnect', () => {
      const userId = socket.data.user.id as string;
      const grace = setTimeout(() => {
        if (![...io.sockets.sockets.values()].some((s) => s.data.user.id === userId))
          void media.revoke(userId);
      }, 10000);
      grace.unref();
      stopTyping(socket.id);
      if (socket.data.channelId) presence(socket.data.channelId);
    });
  });
  const timer = setInterval(() => {
    void media.expire();
    for (const [id, item] of typing) if (item.until <= Date.now()) stopTyping(id);
    for (const socket of io.sockets.sockets.values())
      if (!auth.userForToken(socket.data.token)) socket.disconnect(true);
  }, 1000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return {
    io,
    media,
    online(channelId: string) {
      return [
        ...new Map(
          [...io.sockets.sockets.values()]
            .filter((s) => s.data.channelId === channelId && auth.userForToken(s.data.token))
            .map((s) => [s.data.user.id, s.data.user]),
        ).values(),
      ] as User[];
    },
    publish(channelId: string, message: Message) {
      for (const socket of io.sockets.sockets.values()) {
        const user = auth.userForToken(socket.data.token);
        if (!user) {
          socket.disconnect(true);
          continue;
        }
        if (socket.data.channelId === channelId) {
          try {
            store.requireMembership(channelId, user.id);
            socket.emit('message', { ...message, own: message.authorId === user.id });
          } catch {
            socket.disconnect(true);
          }
        }
      }
    },
    revokeMembership(userId: string, communityId: string) {
      const channels = new Set(store.getChannels(communityId).map((c) => c.id));
      for (const socket of io.sockets.sockets.values())
        if (socket.data.user.id === userId && channels.has(socket.data.channelId)) {
          socket.emit('membership:revoked');
          socket.disconnect(true);
        }
    },
    revokeSession(token: string) {
      for (const socket of io.sockets.sockets.values())
        if (socket.data.token === token) socket.disconnect(true);
    },
  };
}
