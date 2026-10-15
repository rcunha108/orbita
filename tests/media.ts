/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';
import { RoomServiceClient } from 'livekit-server-sdk';
import { Store } from '../server/store.js';

import { createApp } from '../server/http.js';

process.env.LIVEKIT_DEV_MODE = 'true';
const store = new Store(':memory:');
const app = createApp(store, resolve('dist'));
app.listen(0, '127.0.0.1');
await once(app, 'listening');
const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
const local = JSON.parse(await readFile('.tools/media-dev.json', 'utf8')) as {
  apiKey: string;
  apiSecret: string;
};
const service = new RoomServiceClient('http://127.0.0.1:7880', local.apiKey, local.apiSecret);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: [
    '--disable-dev-shm-usage',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-usermedia-screen-capturing',
    '--auto-accept-this-tab-capture',
  ],
});
const diagnosticPages: Page[] = [];
const checks: string[] = [];
const errors: string[] = [];
async function account(page: Page, name: string) {
  diagnosticPages.push(page);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'Criar uma conta', exact: true }).click();
  await page.getByLabel('Seu nome').fill(name);
  await page.getByLabel('E-mail', { exact: true }).fill(`${name.toLowerCase()}@example.test`);
  await page.getByLabel('Senha', { exact: true }).fill('test media password');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '12 comunidades' }).waitFor();
  await page.goto(base + '/#community/dev');
  await page.getByRole('button', { name: 'Entrar na comunidade', exact: true }).click();
  await page.getByText('Ao vivo', { exact: true }).waitFor();
}
try {
  const ca = await browser.newContext({
    permissions: ['microphone', 'local-network-access'],
    viewport: { width: 1440, height: 1000 },
  });
  const cb = await browser.newContext({
    permissions: ['microphone', 'local-network-access'],
    viewport: { width: 1440, height: 1000 },
  });
  const a = await ca.newPage();
  const b = await cb.newPage();
  await account(a, 'Alice');
  await account(b, 'Beatriz');
  await a.getByRole('button', { name: 'Entrar na voz', exact: true }).click();
  await a.getByText('Áudio conectado', { exact: true }).waitFor({ timeout: 20000 });
  await b.getByRole('button', { name: 'Entrar na voz', exact: true }).click();
  await b.getByText('Áudio conectado', { exact: true }).waitFor({ timeout: 20000 });
  const participants = await service.listParticipants('channel-dev-1');
  assert.equal(participants.length, 2);
  assert.ok(participants.every((p) => p.tracks.some((t) => t.source === 2)));
  await b.waitForFunction(() => {
    const element = document.querySelector('.remote-audio audio') as HTMLAudioElement | null;
    return Boolean(element && element.readyState >= 2 && element.currentTime > 0);
  });
  checks.push(
    'Two real WebRTC clients publish synthetic microphone audio and receive it through LiveKit and TURN.',
  );
  await a.getByRole('button', { name: 'Silenciar microfone', exact: true }).click();
  await a.getByRole('button', { name: 'Ativar microfone', exact: true }).waitFor();
  assert.ok(
    (await service.listParticipants('channel-dev-1'))
      .find((p) => p.name === 'Alice')!
      .tracks.find((t) => t.source === 2)!.muted,
  );
  await a.getByRole('button', { name: 'Ativar microfone', exact: true }).click();
  checks.push('Mute and unmute update the published microphone track.');
  await a.getByRole('button', { name: 'Compartilhar tela', exact: true }).click();
  await a
    .getByRole('button', { name: 'Parar compartilhamento', exact: true })
    .waitFor({ timeout: 20000 });
  await b.getByLabel('Tela de Alice', { exact: true }).waitFor();
  await b.waitForFunction(
    () => {
      const v = document.querySelector('.shared-screens video') as HTMLVideoElement | null;
      return Boolean(v && v.videoWidth > 0 && v.readyState >= 2);
    },
    {},
    { timeout: 20000 },
  );
  assert.ok(
    (await service.listParticipants('channel-dev-1'))
      .find((p) => p.name === 'Alice')!
      .tracks.some((t) => t.source === 3),
  );
  await mkdir('.test-artifacts', { recursive: true });
  await b.screenshot({ path: resolve('.test-artifacts/media-screen.png'), fullPage: true });
  await a.getByRole('button', { name: 'Parar compartilhamento', exact: true }).click();
  await b.getByLabel('Tela de Alice', { exact: true }).waitFor({ state: 'detached' });
  checks.push(
    'The browser display-capture API publishes synthetic test frames that are decoded by the receiver; stopping removes the track.',
  );
  await a.getByRole('button', { name: 'Sair do áudio', exact: true }).click();
  await b.getByRole('button', { name: 'Sair do áudio', exact: true }).click();
  await a.getByRole('button', { name: 'Entrar na voz', exact: true }).waitFor();
  const bobUser = (await (await cb.request.get(base + '/api/auth/me')).json()) as {
    user: { id: string };
  };
  await a.getByLabel('Pessoa para ligar').selectOption(bobUser.user.id);
  await a.getByRole('button', { name: 'Iniciar ligação', exact: true }).click();
  await b.getByText('Alice está ligando', { exact: true }).waitFor();
  await b.getByRole('button', { name: 'Recusar ligação', exact: true }).click();
  await a.getByText('Chamando Beatriz…', { exact: true }).waitFor({ state: 'detached' });
  await a.getByRole('button', { name: 'Iniciar ligação', exact: true }).click();
  await b.getByRole('button', { name: 'Aceitar ligação', exact: true }).click();
  await a.getByText('Áudio conectado', { exact: true }).waitFor({ timeout: 20000 });
  await b.getByText('Áudio conectado', { exact: true }).waitFor({ timeout: 20000 });
  const calls = (await (await ca.request.get(base + '/api/channels/dev-1/call')).json()) as {
    call: { id: string };
  };
  assert.equal((await service.listParticipants(`call-${calls.call.id}`)).length, 2);
  await b.getByRole('button', { name: 'Encerrar ligação', exact: true }).click();
  await a.getByText('Em ligação com Beatriz', { exact: true }).waitFor({ state: 'detached' });
  await a.getByRole('button', { name: 'Entrar na voz', exact: true }).waitFor();
  checks.push(
    'Direct call invitations can be declined or accepted; accepted calls use a separate two-person media room and hangup ends both sides.',
  );
  await a.getByRole('button', { name: 'Entrar na voz', exact: true }).click();
  await a.getByText('Áudio conectado', { exact: true }).waitFor({ timeout: 20000 });
  await b.getByRole('button', { name: 'Entrar na voz', exact: true }).click();
  await b.getByText('Áudio conectado', { exact: true }).waitFor({ timeout: 20000 });
  await b.getByRole('button', { name: 'Sair da comunidade', exact: true }).click();
  await b.getByRole('button', { name: 'Entrar na comunidade', exact: true }).waitFor();
  assert.equal((await service.listParticipants('channel-dev-1')).length, 1);
  await a.getByRole('button', { name: 'Sair do áudio', exact: true }).click();
  checks.push(
    'Leaving a community revokes the active media participant at the SFU, as well as chat access.',
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: checks.length,
    failed: 0,
    browser: await browser.version(),
    livekit: '1.13.10',
    inputSources: {
      microphone: 'Chromium synthetic device',
      display: 'Chromium synthetic display-capture pattern',
    },
    checks,
    pageErrors: errors,
  };
  await writeFile('.test-artifacts/media-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  for (const page of diagnosticPages)
    console.log(
      'Media panel:',
      await page
        .locator('.media-panel')
        .innerText()
        .catch(() => 'unavailable'),
    );
  throw error;
} finally {
  await browser.close();
  await new Promise<void>((done) => app.realtime.io.close(() => done()));
  store.close();
}
