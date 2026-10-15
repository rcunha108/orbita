import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const data = await mkdtemp(join(tmpdir(), 'orbita-installer-'));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = (probe.address() as AddressInfo).port;
await new Promise<void>((done) => probe.close(() => done()));
const env = {
  ...process.env,
  ORBITA_DATA_DIR: data,
  ORBITA_PORT: String(port),
  LIVEKIT_DEV_MODE: 'true',
  LIVEKIT_API_KEY: 'must-not-activate',
  LIVEKIT_API_SECRET: 'must-not-activate',
  LIVEKIT_URL: 'ws://127.0.0.1:7880',
};
const entry = join(data, 'payload/orbita.cjs');
await mkdir(join(data, 'payload'));
await cp(resolve('release/windows-x64/orbita.cjs'), entry);
await cp(resolve('release/windows-x64/dist'), join(data, 'payload/dist'), { recursive: true });
let child: ChildProcess | undefined;
const checks: string[] = [];
async function launch(flags: string[] = []) {
  const process = spawn(globalThis.process.execPath, [entry, '--no-browser', ...flags], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  process.stdout!.on('data', (bytes) => {
    output += bytes.toString();
  });
  process.stderr!.on('data', (bytes) => {
    output += bytes.toString();
  });
  return { process, output: () => output };
}
async function start() {
  const running = await launch();
  child = running.process;
  const timeout = Date.now() + 10000;
  while (!running.output().includes('Órbita ready:')) {
    if (child.exitCode !== null) throw new Error(running.output());
    if (Date.now() > timeout) throw new Error(`Packaged server did not start: ${running.output()}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}
async function stop() {
  const exit = child?.exitCode === null ? once(child, 'exit') : undefined;
  const stopped = await launch(['--stop']);
  assert.equal((await once(stopped.process, 'exit'))[0], 0);
  if (exit) assert.equal((await exit)[0], 0);
  child = undefined;
}
const base = `http://127.0.0.1:${port}`;
let cookie = '';
const send = (path: string, method = 'GET', body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
try {
  await start();
  assert.match(await (await send('/')).text(), /<div id="root"><\/div>/);
  assert.equal((await send('/api/health')).status, 200);
  const status = await (await send('/api/media/status')).json();
  assert.equal(status.configured, false);
  checks.push(
    'Bundled server serves the production interface and ignores inherited development media credentials.',
  );
  const registered = await send('/api/auth/register', 'POST', {
    name: 'Installer Test',
    email: 'installer@example.test',
    password: 'installer-test-password-123',
  });
  assert.equal(registered.status, 200);
  cookie = registered.headers.get('set-cookie')!.split(';')[0];
  assert.equal(
    (await send('/api/communities/pixel/membership', 'PUT', { joined: true })).status,
    200,
  );
  const client = io(base, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Packaged WebSocket timeout')), 5000);
      client.once('connect', () => {
        clearTimeout(timer);
        done();
      });
      client.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    client.disconnect();
  }
  const message = `Packaged persistent message ${randomUUID()}`;
  assert.equal(
    (
      await send('/api/channels/pixel-1/messages', 'POST', {
        body: message,
        clientId: randomUUID(),
      })
    ).status,
    201,
  );
  checks.push(
    'Registration, authenticated WebSocket, membership and message creation work without node_modules beside the payload.',
  );
  const duplicate = await launch();
  assert.equal((await once(duplicate.process, 'exit'))[0], 0);
  assert.equal((await send('/api/health')).status, 200);
  checks.push('Opening a second instance reuses the existing server.');
  await stop();
  await start();
  assert.equal((await send('/api/auth/me')).status, 200);
  const history = await (await send('/api/channels/pixel-1/messages')).json();
  assert.equal(history.items.at(-1).body, message);
  checks.push(
    'Stopping and restarting preserve the SQLite account, membership, session and message.',
  );
  await stop();
  await writeFile(
    join(data, 'server.json'),
    JSON.stringify({ serverUrl: 'https://orbita.example' }),
  );
  const remote = await launch();
  assert.equal((await once(remote.process, 'exit'))[0], 0);
  await assert.rejects(fetch(base + '/api/health'));
  await writeFile(
    join(data, 'server.json'),
    JSON.stringify({ serverUrl: 'http://unsafe.example' }),
  );
  const invalid = await launch();
  assert.equal((await once(invalid.process, 'exit'))[0], 1);
  checks.push(
    'Remote HTTPS mode does not start a local backend; insecure remote URLs are rejected.',
  );
  const report = {
    passed: checks.length,
    failed: 0,
    host: process.platform,
    windowsInstallExecuted: false,
    checks,
  };
  await writeFile(
    'docs/evidence/windows-package-report.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  child?.kill('SIGTERM');
  await rm(data, { recursive: true, force: true });
}
