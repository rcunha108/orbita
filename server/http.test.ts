import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { Store } from './store.js';
import { createApp } from './http.js';
import type { DiscoveryResult, Message, MessagesResult } from '../src/types.js';

const store = new Store(':memory:');
const server = createApp(store);
let base: string;
let cookie = '';
const request = (url: string, options: RequestInit = {}) =>
  fetch(url, { ...options, headers: { ...options.headers, Cookie: cookie } });
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test User',
      email: 'test@example.test',
      password: 'correct horse battery staple',
    }),
  });
  cookie = response.headers.get('set-cookie')!.split(';')[0];
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
});

test('HTTP discovery returns typed JSON and useful validation errors', async () => {
  const response = await request(`${base}/api/discover?q=programacao`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /application\/json/);
  const result = (await response.json()) as DiscoveryResult;
  assert.equal(result.items[0].id, 'dev');
  assert.equal((await request(`${base}/api/discover?scope=bad`)).status, 400);
  assert.equal((await request(`${base}/api/unknown`)).status, 404);
  assert.equal((await request(`${base}/api/health`)).status, 200);
});

test('HTTP join, post, read and leave enforce membership and input constraints', async () => {
  const send = (path: string, method: string, body: unknown) =>
    request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await send('/api/channels/pixel-1/messages', 'POST', { body: 'no membership' })).status,
    403,
  );
  assert.equal(
    (await send('/api/communities/pixel/membership', 'PUT', { joined: true })).status,
    200,
  );
  const created = await send('/api/channels/pixel-1/messages', 'POST', {
    body: 'Mensagem via HTTP',
    clientId: randomUUID(),
  });
  assert.equal(created.status, 201);
  const message = (await created.json()) as Message;
  const history = (await (
    await request(`${base}/api/channels/pixel-1/messages`)
  ).json()) as MessagesResult;
  assert.equal(history.items.at(-1)?.id, message.id);
  assert.equal((await send('/api/channels/pixel-1/messages', 'POST', { body: '' })).status, 400);
  assert.equal(
    (await send('/api/communities/pixel/membership', 'PUT', { joined: 'yes' })).status,
    400,
  );
  assert.equal(
    (await send('/api/communities/pixel/membership', 'PUT', { joined: false })).status,
    200,
  );
  assert.equal(
    (await send('/api/channels/pixel-1/messages', 'POST', { body: 'blocked after leave' })).status,
    403,
  );
});

test('HTTP rejects cross-origin writes, malformed JSON, unsupported content and oversized bodies', async () => {
  const path = `${base}/api/communities/dev/membership`;
  assert.equal(
    (
      await request(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.invalid' },
        body: '{"joined":true}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })
    ).status,
    400,
  );
  assert.equal((await request(path, { method: 'PUT', body: 'text' })).status, 415);
  assert.equal(
    (
      await request(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joined: true, extra: 'x'.repeat(17000) }),
      })
    ).status,
    413,
  );
});
