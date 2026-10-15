import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const tools = resolve(process.env.WINDOWS_BUILD_TOOLS ?? '../.tools/windows-build');
const cache = resolve('.tools/windows');
const payload = resolve('release/windows-x64');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = resolve(`release/Orbita-Setup-${version}-x64.exe`);
const runtimeArchive = 'node-v24.18.0-win-x64.zip';
const expected = '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821';
await mkdir(cache, { recursive: true });
const archivePath = join(cache, runtimeArchive);
try {
  await readFile(archivePath);
} catch {
  execFileSync(
    'curl',
    [
      '-fsSL',
      '--retry',
      '2',
      `https://nodejs.org/dist/v24.18.0/${runtimeArchive}`,
      '-o',
      archivePath,
    ],
    { stdio: 'inherit' },
  );
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (hash(await readFile(archivePath)) !== expected)
  throw new Error('Windows Node archive checksum mismatch.');
await rm(payload, { recursive: true, force: true });
await mkdir(payload, { recursive: true });
for (const [source, destination] of [
  ['node.exe', 'node.exe'],
  ['LICENSE', 'NODE-LICENSE.txt'],
]) {
  const bytes = execFileSync('unzip', ['-p', archivePath, `node-v24.18.0-win-x64/${source}`], {
    maxBuffer: 150 * 1024 * 1024,
  });
  await writeFile(join(payload, destination), bytes);
}
await cp('dist', join(payload, 'dist'), { recursive: true });
await cp('desktop/orbita.ico', join(payload, 'orbita.ico'));
await cp('desktop/LEIA-ME.txt', join(payload, 'LEIA-ME.txt'));
await build({
  entryPoints: ['desktop/runtime.ts'],
  outfile: join(payload, 'orbita.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  logLevel: 'warning',
});
execFileSync(
  process.env.WINDOWS_CC ?? join(tools, 'usr/bin/x86_64-w64-mingw32-gcc-posix'),
  [
    '-municode',
    '-mwindows',
    '-static',
    '-Os',
    '-Wall',
    '-Wextra',
    '-Werror',
    'desktop/launcher.c',
    '-o',
    join(payload, 'Orbita.exe'),
  ],
  { stdio: 'inherit' },
);

// Include installed dependency notices, even for dependencies used only during build.
const notices = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      await collect(path);
      continue;
    }
    for (const file of await readdir(path)) {
      if (/^(licen[cs]e|copying|notice)(\.|$)/i.test(file)) {
        const text = await readFile(join(path, file), 'utf8').catch(() => null);
        if (text) notices.push(`\n--- ${path}/${file} ---\n${text}`);
      }
    }
    try {
      await collect(join(path, 'node_modules'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
await collect('node_modules');
await writeFile(join(payload, 'THIRD-PARTY-NOTICES.txt'), notices.sort().join('\n'));
const files = {};
async function inventory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await inventory(join(directory, entry.name), relative + '/');
    else files[relative] = hash(await readFile(join(directory, entry.name)));
  }
}
await inventory(payload);
execFileSync(
  process.env.MAKENSIS ?? join(tools, 'usr/bin/makensis'),
  ['-WX', '-V2', `-DPAYLOAD=${payload}`, `-DOUTPUT=${output}`, 'desktop/installer.nsi'],
  {
    stdio: 'inherit',
    env: { ...process.env, NSISDIR: process.env.NSISDIR ?? join(tools, 'usr/share/nsis') },
  },
);
const checksum = hash(await readFile(output));
await writeFile(output + '.sha256', `${checksum}  ${output.split('/').at(-1)}\n`);
await writeFile(
  resolve('release/windows-manifest.json'),
  JSON.stringify(
    {
      version,
      platform: 'win32-x64',
      node: '24.18.0',
      runtimeArchiveSHA256: expected,
      installerSHA256: checksum,
      signed: false,
      builtOn: process.platform,
      windowsRuntimeValidated: false,
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Installer: ${output}\nSHA256: ${checksum}`);
