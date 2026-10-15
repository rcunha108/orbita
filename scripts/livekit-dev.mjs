import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const binary = process.env.LIVEKIT_BIN ?? resolve('.tools/livekit-server');
if (!existsSync(binary)) throw new Error('Run npm run media:install first, or set LIVEKIT_BIN.');
const child = spawn(binary, ['--config', resolve('.tools/livekit-dev.yaml')], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
