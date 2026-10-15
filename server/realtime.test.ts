import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { Store } from './store.js';
import { Auth } from './auth.js';
import { createApp } from './http.js';
import type { Message, User } from '../src/types.js';

function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`Timeout: ${name}`));
    }, 5000);
    function listener(value: T) {
      clearTimeout(timer);
      resolve(value);
    }
    socket.once(name, listener);
  });
}
test('passwords, unique identities, session expiry and logout are enforced', async () => {
  const store = new Store(':memory:');
  const auth = new Auth(store);
  try {
    const account = await auth.register('Alice', 'ALICE@example.test', 'correct horse battery');
    const row = store.db.prepare('SELECT * FROM users').get()!;
    assert.notEqual(row.password_hash, 'correct horse battery');
    assert.equal(auth.require(account.token).name, 'Alice');
    assert.equal(
      (await auth.login('alice@example.test', 'correct horse battery')).user.id,
      account.user.id,
    );
    await assert.rejects(auth.login('alice@example.test', 'incorrect password'), { status: 401 });
    await assert.rejects(auth.login('missing@example.test', 'incorrect password'), { status: 401 });
    await assert.rejects(auth.register('Again', 'alice@example.test', 'correct horse battery'), {
      status: 409,
    });
    auth.logout(account.token);
    assert.equal(auth.userForToken(account.token), null);
    const login = await auth.login('alice@example.test', 'correct horse battery');
    store.db.prepare('UPDATE sessions SET expires_at=0').run();
    assert.equal(auth.userForToken(login.token), null);
  } finally {
    store.close();
  }
});

test('two authenticated clients receive live messages, typing, presence and replay; membership and logout revoke access', async () => {
  const store = new Store(':memory:');
  const server = createApp(store);
  const clients: Socket[] = [];
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function register(name: string) {
    const r = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `${name.toLowerCase()}@example.test`,
        password: 'correct horse battery staple',
      }),
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(r.headers.get('set-cookie')!, /SameSite=Strict/);
    return {
      cookie: r.headers.get('set-cookie')!.split(';')[0],
      user: ((await r.json()) as { user: User }).user,
    };
  }
  const request = (cookie: string, path: string, method = 'GET', body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function connect(cookie: string) {
    const socket = io(base, {
      autoConnect: false,
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie, Origin: base },
    });
    clients.push(socket);
    const ready = event(socket, 'connect');
    socket.connect();
    await ready;
    return socket;
  }
  const join = (socket: Socket, channelId: string) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) =>
      socket.emit('channel:join', { channelId }, resolve),
    );
  try {
    assert.equal((await request('', '/api/memberships')).status, 401);
    assert.equal((await request('', '/api/channels/dev-1/messages')).status, 401);
    const alice = await register('Alice');
    const bob = await register('Bob');
    for (const [cookie, origin] of [
      ['', base],
      [alice.cookie, 'https://unrelated.invalid'],
    ]) {
      const denied = io(base, {
        autoConnect: false,
        reconnection: false,
        transports: ['websocket'],
        extraHeaders: { Cookie: cookie, Origin: origin },
      });
      clients.push(denied);
      const rejected = event<Error>(denied, 'connect_error');
      denied.connect();
      assert.ok(await rejected);
      assert.equal(denied.connected, false);
      denied.disconnect();
    }
    await request(alice.cookie, '/api/communities/dev/membership', 'PUT', { joined: true });
    assert.equal(
      ((await (await request(bob.cookie, '/api/memberships')).json()) as unknown[]).length,
      0,
    );
    const a = await connect(alice.cookie);
    const b = await connect(bob.cookie);
    assert.equal((await join(b, 'dev-1')).ok, false);
    assert.equal((await request(bob.cookie, '/api/channels/dev-1/messages')).status, 403);
    await request(bob.cookie, '/api/communities/dev/membership', 'PUT', { joined: true });
    assert.equal((await join(a, 'dev-1')).ok, true);
    const presence = event<User[]>(a, 'presence');
    assert.equal((await join(b, 'dev-1')).ok, true);
    assert.equal((await presence).length, 2);
    const typing = event<{ name: string }>(b, 'typing');
    a.emit('typing', true);
    assert.equal((await typing).name, 'Alice');
    const liveA = event<Message>(a, 'message');
    const liveB = event<Message>(b, 'message');
    const clientId = randomUUID();
    const sent = await request(alice.cookie, '/api/channels/dev-1/messages', 'POST', {
      body: 'live hello',
      clientId,
    });
    assert.equal(sent.status, 201);
    const canonical = (await sent.json()) as Message;
    assert.equal((await liveA).own, true);
    const received = await liveB;
    assert.equal(received.body, 'live hello');
    assert.equal(received.author, 'Alice');
    assert.equal(received.own, false);
    const duplicate = (await (
      await request(alice.cookie, '/api/channels/dev-1/messages', 'POST', {
        body: 'live hello',
        clientId,
      })
    ).json()) as Message;
    assert.equal(duplicate.id, canonical.id);
    assert.equal(
      (
        await request(alice.cookie, '/api/channels/dev-1/messages', 'POST', {
          body: 'different content',
          clientId,
        })
      ).status,
      409,
    );
    b.disconnect();
    for (let i = 0; i < 3; i++)
      assert.equal(
        (
          await request(alice.cookie, '/api/channels/dev-1/messages', 'POST', {
            body: `missed ${i}`,
            clientId: randomUUID(),
          })
        ).status,
        201,
      );
    const reconnected = await connect(bob.cookie);
    await join(reconnected, 'dev-1');
    const replay = (await (
      await request(bob.cookie, `/api/channels/dev-1/messages?after=${canonical.id}`)
    ).json()) as { items: Message[] };
    assert.deepEqual(
      replay.items.map((m) => m.body),
      ['missed 0', 'missed 1', 'missed 2'],
    );
    const revoked = event(reconnected, 'disconnect');
    await request(bob.cookie, '/api/communities/dev/membership', 'PUT', { joined: false });
    await revoked;
    assert.equal((await request(bob.cookie, '/api/channels/dev-1/messages')).status, 403);
    const disconnected = event(a, 'disconnect');
    await request(alice.cookie, '/api/auth/logout', 'POST', {});
    await disconnected;
    assert.equal((await request(alice.cookie, '/api/memberships')).status, 401);
  } finally {
    for (const socket of clients) socket.disconnect();
    await new Promise<void>((done) => server.realtime.io.close(() => done()));
    store.close();
  }
});
