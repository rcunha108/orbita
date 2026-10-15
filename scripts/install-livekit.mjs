import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const image =
  'livekit/livekit-server@sha256:89ca9ce0791e18d6e03bf6e2c49ceb27e1c754eae8bd50c989386c1a5963791a';
const checksum = '5153d7ce95fb2f2ffb455a0e4ac464be2c94a38c77c99fd728f9c61748a11381';
const destination = resolve('.tools/livekit-server');
function verified() {
  return (
    existsSync(destination) &&
    createHash('sha256').update(readFileSync(destination)).digest('hex') === checksum
  );
}
function run(args) {
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed`);
}
if (!verified()) {
  if (existsSync(destination))
    throw new Error(
      'Existing LiveKit binary has a different checksum; preserve and inspect it before replacing.',
    );
  mkdirSync(resolve('.tools'), { recursive: true });
  run(['pull', image]);
  const name = `orbita-livekit-extract-${randomUUID()}`;
  let created = false;
  try {
    run(['create', '--name', name, image]);
    created = true;
    run(['cp', `${name}:/livekit-server`, destination]);
  } finally {
    if (created) run(['rm', name]);
  }
  if (!verified()) throw new Error('LiveKit checksum verification failed.');
  chmodSync(destination, 0o755);
}
console.log('Verified LiveKit 1.13.10 for Linux amd64.');

run([
  'pull',
  'coturn/coturn@sha256:71c3c990283385567f11794ee692e3a47b66fd9b0bb39e42afbe776e331dd888',
]);
await import('./prepare-media.mjs');
