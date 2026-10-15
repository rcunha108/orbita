import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const image =
  'coturn/coturn@sha256:71c3c990283385567f11794ee692e3a47b66fd9b0bb39e42afbe776e331dd888';
const name = `orbita-turn-${randomUUID()}`;
const child = spawn(
  'docker',
  [
    'run',
    '--rm',
    '--name',
    name,
    '--network',
    'host',
    '-i',
    '--entrypoint',
    '/bin/sh',
    image,
    '-c',
    'umask 077; cat > /tmp/orbita-turn.conf; exec /usr/bin/turnserver -c /tmp/orbita-turn.conf',
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
child.stdin.end(readFileSync('.tools/turnserver.conf'));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    stopping = true;
    spawnSync('docker', ['stop', '--time', '3', name], { stdio: 'ignore' });
  });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.stdin.on('error', () => {});
child.on('exit', (code) => {
  process.exitCode = stopping ? 0 : (code ?? 1);
});
