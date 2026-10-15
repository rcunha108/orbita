import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../server/store.js';
import { createApp } from '../server/http.js';

const data = resolve(
  process.env.ORBITA_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? '.', 'Orbita'),
);
mkdirSync(data, { recursive: true });
const identifier = createHash('sha256').update(data).digest('hex').slice(0, 24);
const pipe =
  process.platform === 'win32' ? `\\\\.\\pipe\\orbita-${identifier}` : join(data, 'instance.sock');
const stopping = process.argv.includes('--stop');
const noBrowser = process.argv.includes('--no-browser');
let url = '';
let shutdown: () => void = () => process.exit(0);

function openBrowser() {
  if (noBrowser) return;
  const child =
    process.platform === 'win32'
      ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
      : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', fail);
  child.unref();
}

function fail(error: unknown) {
  appendFileSync(join(data, 'startup-error.log'), `${new Date().toISOString()} ${String(error)}\n`);
  console.error(error);
  process.exit(1);
}

async function contact(command: string): Promise<boolean> {
  return new Promise((done) => {
    const client = createConnection(pipe);
    client.setTimeout(5000);
    client.once('connect', () => client.end(command));
    client.once('close', (hadError) => done(!hadError));
    client.once('error', () => done(false));
    client.once('timeout', () => {
      client.destroy();
      done(false);
    });
  });
}

async function main() {
  if (await contact(stopping ? 'stop' : 'open')) return;
  if (stopping) return;
  const configFile = join(data, 'server.json');
  if (existsSync(configFile)) {
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as { serverUrl?: string };
    if (config.serverUrl) {
      const remote = new URL(config.serverUrl);
      if (
        remote.protocol !== 'https:' ||
        remote.username ||
        remote.password ||
        remote.search ||
        remote.hash
      )
        throw new Error('serverUrl deve ser uma URL HTTPS sem credenciais, consulta ou fragmento.');
      url = remote.toString();
      openBrowser();
      return;
    }
  }
  // The installer never distributes development credentials or starts a public server.
  delete process.env.LIVEKIT_DEV_MODE;
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
  delete process.env.SECURE_COOKIES;
  const control = createServer((client) => {
    client.setTimeout(3000, () => client.destroy());
    let command = '';
    client.on('data', (chunk) => {
      command += chunk.toString();
      if (command.length > 16) client.destroy();
    });
    client.on('end', () => {
      client.end();
      if (command === 'stop') shutdown();
      else if (command === 'open' && url) openBrowser();
    });
    client.on('error', () => {});
  });
  await new Promise<void>((done, reject) => {
    control.once('error', reject);
    control.listen(pipe, done);
  });
  const store = new Store(join(data, 'orbita.sqlite'));
  const app = createApp(store, resolve(__dirname, 'dist'));
  const port = Number(process.env.ORBITA_PORT ?? 31043);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta local inválida.');
  shutdown = () => {
    control.close();
    app.realtime.io.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, shutdown);
  await new Promise<void>((done, reject) => {
    app.once('error', reject);
    app.listen(port, '127.0.0.1', done);
  });
  url = `http://127.0.0.1:${port}/`;
  console.log(`Órbita ready: ${url}`);
  openBrowser();
}

main().catch(fail);
