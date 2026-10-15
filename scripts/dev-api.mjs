import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const child = spawn(
  process.execPath,
  [resolve('node_modules/tsx/dist/cli.mjs'), 'watch', 'server/main.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, LIVEKIT_DEV_MODE: process.env.LIVEKIT_DEV_MODE ?? 'true' },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
