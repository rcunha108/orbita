import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { HttpError } from './search.js';
import { Store } from './store.js';
import { Auth, sessionToken } from './auth.js';
import { attachRealtime } from './realtime.js';

function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new HttpError(415, 'Envie um corpo JSON.');
  if (Number(request.headers['content-length'] ?? 0) > 16_384) {
    request.resume();
    throw new HttpError(413, 'Conteúdo muito grande.');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk as Buffer);
    if (size > 16_384) throw new HttpError(413, 'Conteúdo muito grande.');
    chunks.push(Buffer.from(chunk as Buffer));
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

export function createApp(store: Store, staticDirectory?: string) {
  const staticRoot = staticDirectory ? resolve(staticDirectory) : undefined;
  const auth = new Auth(store);
  const authAttempts = new Map<string, { count: number; until: number }>();
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) json(response, error.status, { error: error.message });
      else {
        console.error('Request failed:', error);
        json(response, 500, { error: 'Não foi possível concluir a operação. Tente novamente.' });
      }
    });
  });

  const realtime = attachRealtime(server, store, auth);
  return Object.assign(server, { realtime });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin) {
        let host: string;
        try {
          host = new URL(origin).host;
        } catch {
          throw new HttpError(403, 'Origem inválida.');
        }
        if (host !== request.headers.host) throw new HttpError(403, 'Origem não permitida.');
      }
    }
    const token = sessionToken(request.headers.cookie);
    const user = auth.userForToken(token);
    if (path === '/api/auth/me' && method === 'GET') return json(response, 200, { user });
    if (['/api/auth/register', '/api/auth/login'].includes(path) && method === 'POST') {
      const ip = request.socket.remoteAddress ?? 'unknown';
      const now = Date.now();
      for (const [key, attempt] of authAttempts) if (attempt.until <= now) authAttempts.delete(key);
      if (authAttempts.size > 10000) throw new HttpError(429, 'Tente novamente mais tarde.');
      const attempt = authAttempts.get(ip) ?? { count: 0, until: now + 60000 };
      if (++attempt.count > 10) throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto.');
      authAttempts.set(ip, attempt);
      const body = await readBody(request);
      const result = path.endsWith('/register')
        ? await auth.register(body.name, body.email, body.password)
        : await auth.login(body.email, body.password);
      response.setHeader(
        'Set-Cookie',
        `orbita_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.SECURE_COOKIES === 'true' ? '; Secure' : ''}`,
      );
      return json(response, 200, { user: result.user });
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      if (user) await realtime.media.revoke(user.id, token);
      auth.logout(token);
      realtime.revokeSession(token);
      response.setHeader(
        'Set-Cookie',
        'orbita_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      );
      return json(response, 200, { ok: true });
    }
    if (path === '/api/health' && method === 'GET') return json(response, 200, { ok: true });
    if (path === '/api/discover' && method === 'GET')
      return json(response, 200, store.discover(url.searchParams, user?.id ?? null));
    if (path === '/api/memberships' && method === 'GET')
      return json(response, 200, store.getMemberships(auth.require(token).id));
    const community = /^\/api\/communities\/([a-z0-9-]+)$/.exec(path);
    if (community && method === 'GET')
      return json(response, 200, store.getCommunity(community[1], user?.id ?? null));
    const membership = /^\/api\/communities\/([a-z0-9-]+)\/membership$/.exec(path);
    if (membership && method === 'PUT') {
      const body = await readBody(request);
      if (typeof body.joined !== 'boolean')
        throw new HttpError(400, 'Informe se deseja entrar ou sair.');
      const member = auth.require(token);
      const updated = store.setMembership(membership[1], body.joined, member.id);
      if (!body.joined) {
        realtime.revokeMembership(member.id, membership[1]);
        await realtime.media.revoke(member.id, undefined, membership[1]);
      }
      return json(response, 200, updated);
    }
    const channels = /^\/api\/communities\/([a-z0-9-]+)\/channels$/.exec(path);
    if (channels && method === 'GET') return json(response, 200, store.getChannels(channels[1]));
    if (path === '/api/media/status' && method === 'GET')
      return json(response, 200, { configured: Boolean(realtime.media.config) });
    const mediaRoute =
      /^\/api\/channels\/([a-z0-9-]+)\/(media-token|media-leave|call|participants)$/.exec(path);
    if (mediaRoute) {
      const member = auth.require(token);
      store.requireMembership(mediaRoute[1], member.id);
      if (mediaRoute[2] === 'media-leave' && method === 'POST') {
        const body = await readBody(request);
        await realtime.media.leave(
          mediaRoute[1],
          member.id,
          token,
          typeof body.callId === 'string' ? body.callId : undefined,
        );
        return json(response, 200, { ok: true });
      }
      if (mediaRoute[2] === 'participants' && method === 'GET')
        return json(response, 200, realtime.online(mediaRoute[1]));
      if (mediaRoute[2] === 'media-token' && method === 'POST') {
        const body = await readBody(request);
        if (body.callId !== undefined && typeof body.callId !== 'string')
          throw new HttpError(400, 'Chamada inválida.');
        return json(
          response,
          200,
          await realtime.media.token(
            mediaRoute[1],
            member,
            token,
            body.callId as string | undefined,
          ),
        );
      }
      if (mediaRoute[2] === 'call' && method === 'GET')
        return json(response, 200, { call: realtime.media.currentCall(member.id) });
      if (mediaRoute[2] === 'call' && method === 'POST') {
        const body = await readBody(request);
        const target = realtime.online(mediaRoute[1]).find((u) => u.id === body.targetId);
        if (!target) throw new HttpError(404, 'A pessoa não está conectada a este canal.');
        return json(response, 200, { call: realtime.media.start(mediaRoute[1], member, target) });
      }
    }
    const callRoute = /^\/api\/calls\/([a-f0-9-]+)\/(accept|end)$/.exec(path);
    if (callRoute && method === 'POST') {
      const member = auth.require(token);
      if (callRoute[2] === 'accept')
        return json(response, 200, { call: realtime.media.accept(callRoute[1], member) });
      await realtime.media.end(callRoute[1], member.id);
      return json(response, 200, { ok: true });
    }
    const messages = /^\/api\/channels\/([a-z0-9-]+)\/messages$/.exec(path);
    if (messages && method === 'GET')
      return json(
        response,
        200,
        url.searchParams.has('after')
          ? store.getMessagesAfter(
              messages[1],
              url.searchParams.get('after')!,
              auth.require(token).id,
            )
          : store.getMessages(messages[1], url.searchParams.get('before'), auth.require(token).id),
      );
    if (messages && method === 'POST') {
      const body = await readBody(request);
      const message = store.createMessage(
        messages[1],
        body.body,
        auth.require(token).id,
        body.clientId,
      );
      realtime.publish(messages[1], message);
      return json(response, 201, message);
    }
    if (path.startsWith('/api/')) throw new HttpError(404, 'Rota não encontrada.');
    if (!staticRoot || !['GET', 'HEAD'].includes(method))
      throw new HttpError(404, 'Página não encontrada.');
    let relative: string;
    try {
      relative = decodeURIComponent(path);
    } catch {
      throw new HttpError(400, 'Caminho inválido.');
    }
    const file = resolve(staticRoot, `.${relative === '/' ? '/index.html' : relative}`);
    if (!file.startsWith(staticRoot + sep)) throw new HttpError(404, 'Arquivo não encontrado.');
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    try {
      const content = await readFile(file);
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${realtime.media.currentOrigins}; media-src 'self' blob:; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
        'Cache-Control': path.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      response.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' ||
        (error as NodeJS.ErrnoException).code === 'EISDIR'
      )
        throw new HttpError(404, 'Arquivo não encontrado.');
      throw error;
    }
  }
}
