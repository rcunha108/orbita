import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
const root = resolve('.tools');
mkdirSync(root, { recursive: true });
const path = resolve(root, 'media-dev.json');
if (!existsSync(path))
  writeFileSync(
    path,
    JSON.stringify({
      apiKey: 'orbita-' + randomBytes(8).toString('hex'),
      apiSecret: randomBytes(32).toString('hex'),
      turnUsername: 'orbita-local',
      turnPassword: randomBytes(24).toString('hex'),
    }),
    { mode: 0o600 },
  );
chmodSync(path, 0o600);
const c = JSON.parse(readFileSync(path, 'utf8'));
for (const name of ['apiKey', 'apiSecret', 'turnUsername', 'turnPassword'])
  if (typeof c[name] !== 'string' || !c[name])
    throw new Error(
      'Invalid local media configuration. Preserve the file and inspect it securely.',
    );
const nodeIp =
  process.env.LIVEKIT_NODE_IP ??
  Object.values(networkInterfaces())
    .flat()
    .find((i) => i?.family === 'IPv4' && !i.internal)?.address ??
  '127.0.0.1';
const turn =
  [
    'listening-port=3478',
    'listening-ip=127.0.0.1',
    `relay-ip=${nodeIp}`,
    'min-port=40000',
    'max-port=40100',
    'realm=orbita.local',
    'lt-cred-mech',
    `user=${c.turnUsername}:${c.turnPassword}`,
    'no-tls',
    'no-dtls',
    'no-cli',
    'no-multicast-peers',
    'no-tcp-relay',
    'log-file=stdout',
    'simple-log',
    'allow-loopback-peers',
    'pidfile=/tmp/orbita-turn.pid',
  ].join('\n') + '\n';
const livekit = {
  port: 7880,
  bind_addresses: [...new Set(['127.0.0.1', nodeIp])],
  rtc: {
    node_ip: nodeIp,
    tcp_port: 7881,
    udp_port: 7882,
    turn_servers: [
      {
        host: '127.0.0.1',
        port: 3478,
        protocol: 'tcp',
        username: c.turnUsername,
        credential: c.turnPassword,
      },
    ],
  },
  keys: { [c.apiKey]: c.apiSecret },
  logging: { level: 'info' },
};
for (const [name, data] of [
  ['turnserver.conf', turn],
  ['livekit-dev.yaml', JSON.stringify(livekit)],
]) {
  const target = resolve(root, name);
  writeFileSync(target, data, { mode: 0o600 });
  chmodSync(target, 0o600);
}
console.log('Local media configuration prepared; credentials retained in ignored .tools files.');
