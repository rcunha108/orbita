import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Store } from './store.js';
import { createApp } from './http.js';
import type { User, Call } from '../src/types.js';
process.env.LIVEKIT_DEV_MODE = 'true';
process.env.LIVEKIT_API_KEY = 'orbita-test';
process.env.LIVEKIT_API_SECRET = 'server-test-secret-for-signed-token-claims-only';
test('media grants and call lifecycle enforce authenticated membership, consent and participant identity', async () => {
  const store = new Store(':memory:');
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  async function register(name: string) {
    const r = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `${name}@example.test`,
        password: 'test media password',
      }),
    });
    return {
      cookie: r.headers.get('set-cookie')!.split(';')[0],
      user: ((await r.json()) as { user: User }).user,
    };
  }
  const request = (cookie: string, path: string, body?: unknown) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const a = await register('Alice');
    const b = await register('Bob');
    const c = await register('Carol');
    assert.equal((await request('', '/api/channels/dev-1/media-token', {})).status, 401);
    assert.equal((await request(a.cookie, '/api/channels/dev-1/media-token', {})).status, 403);
    store.setMembership('dev', true, a.user.id);
    store.setMembership('dev', true, b.user.id);
    store.setMembership('dev', true, c.user.id);
    const grant = (await (
      await request(a.cookie, '/api/channels/dev-1/media-token', {})
    ).json()) as { token: string; room: string };
    const claims = JSON.parse(Buffer.from(grant.token.split('.')[1], 'base64url').toString()) as {
      video: { room: string; canPublishSources: string[] };
      exp: number;
      iat: number;
    };
    assert.equal(claims.video.room, 'channel-dev-1');
    assert.deepEqual(claims.video.canPublishSources, [
      'microphone',
      'screen_share',
      'screen_share_audio',
    ]);
    assert.ok(
      claims.exp - Math.floor(Date.now() / 1000) <= 20 &&
        claims.exp > Math.floor(Date.now() / 1000),
    );
    const call = app.realtime.media.start('dev-1', a.user, b.user);
    assert.equal(
      (await request(a.cookie, '/api/channels/dev-1/media-token', { callId: call.id })).status,
      403,
    );
    assert.equal((await request(a.cookie, `/api/calls/${call.id}/accept`, {})).status, 409);
    assert.equal((await request(c.cookie, `/api/calls/${call.id}/accept`, {})).status, 404);
    const accepted = (await (
      await request(b.cookie, `/api/calls/${call.id}/accept`, {})
    ).json()) as { call: Call };
    assert.equal(accepted.call.state, 'active');
    assert.equal(
      (await request(c.cookie, '/api/channels/dev-1/media-token', { callId: call.id })).status,
      404,
    );
    const privateGrant = (await (
      await request(a.cookie, '/api/channels/dev-1/media-token', { callId: call.id })
    ).json()) as { room: string };
    assert.equal(privateGrant.room, `call-${call.id}`);
    assert.throws(() => app.realtime.media.start('dev-1', a.user, c.user), { status: 409 });
    await request(b.cookie, `/api/calls/${call.id}/end`, {});
    assert.equal(app.realtime.media.currentCall(a.user.id), null);
    const expired = app.realtime.media.start('dev-1', a.user, b.user);
    expired.expiresAt = Date.now() - 1;
    await app.realtime.media.expire();
    assert.equal(app.realtime.media.currentCall(b.user.id), null);
    assert.equal(
      (await request(a.cookie, '/api/channels/dev-1/call', { targetId: c.user.id })).status,
      404,
    );
  } finally {
    await new Promise<void>((done) => app.realtime.io.close(() => done()));
    store.close();
  }
});
