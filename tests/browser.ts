/// <reference lib="dom" />
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page } from 'playwright-core';
import { createApp } from '../server/http.js';
import { Store } from '../server/store.js';

const artifacts = resolve('.test-artifacts');
await mkdir(artifacts, { recursive: true });
const store = new Store(':memory:');
const server = createApp(store, resolve('dist'));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--disable-dev-shm-usage'],
});
const errors: string[] = [];
const checks: string[] = [];

async function desktop(page: Page) {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'Criar uma conta', exact: true }).click();
  await page.getByLabel('Seu nome').fill('Explorador Teste');
  await page.getByLabel('E-mail', { exact: true }).fill('explorador@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('uma senha de teste segura');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '12 comunidades' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Explorar / }).count(), 6);
  await page.screenshot({ path: resolve(artifacts, 'desktop.png'), fullPage: true });
  checks.push('Initial discovery: six cards, twelve total communities, original artwork.');

  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Explorar Próxima Partida', exact: true }).waitFor();
  assert.equal(await page.locator('.pagination [aria-current=page]').textContent(), '2');
  const search = page.getByRole('textbox', { name: 'Buscar comunidades e canais' });
  await search.fill('programacao');
  await page.getByRole('status').filter({ hasText: '1 comunidades' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Explorar / }).count(), 1);
  await page.getByRole('button', { name: 'Explorar Dev sem fronteiras', exact: true }).waitFor();
  checks.push('Accents, prefix search and page reset after a changed query.');

  await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '12 comunidades' }).waitFor();
  assert.equal(await page.locator('.pagination [aria-current=page]').textContent(), '1');
  await page
    .locator('.category-pills')
    .getByRole('button', { name: /Tecnologia/ })
    .click();
  await page.getByRole('status').filter({ hasText: '2 comunidades' }).waitFor();
  await search.fill('javascript');
  await page.getByRole('button', { name: 'Canais', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '6 canais' }).waitFor();
  await page
    .getByRole('button', { name: 'Abrir canal javascript em Dev sem fronteiras', exact: true })
    .waitFor();
  checks.push('Category facets and separate channel search resolve real API results.');

  await page
    .locator('.category-pills')
    .getByRole('button', { name: /^Todos/ })
    .click();
  await page.getByRole('button', { name: 'Servidores', exact: true }).click();
  await search.fill('impossivelxyz');
  await page.getByText('Ainda não encontramos essa órbita.').waitFor();
  await page.getByRole('button', { name: 'Limpar busca e filtros' }).click();
  await page.getByRole('status').filter({ hasText: '12 comunidades' }).waitFor();
  await page.getByLabel('Ordenar resultados').selectOption('members');
  await page.waitForFunction(
    () => document.querySelector('.community-card h3')?.textContent === 'Frequência Lo-fi',
  );
  checks.push('Empty state recovery and sorting by member count.');

  await page.route('**/api/discover?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'minecraft') {
      await delay(500);
      try {
        await route.continue();
      } catch {
        /* The old request may already be cancelled. */
      }
    } else await route.continue();
  });
  await search.fill('minecraft');
  await page.waitForRequest((request) => request.url().includes('q=minecraft'));
  await search.fill('javascript');
  await page.getByRole('button', { name: 'Explorar Web Lab', exact: true }).waitFor();
  await delay(600);
  assert.equal(await page.getByRole('button', { name: /^Explorar / }).count(), 1);
  await page.getByRole('button', { name: 'Explorar Web Lab', exact: true }).waitFor();
  await page.unroute('**/api/discover?**');
  checks.push('An obsolete delayed response does not overwrite newer search results.');

  await page.route('**/api/discover?**', (route) => route.abort('failed'));
  await search.fill('falha');
  await page.getByRole('alert').filter({ hasText: 'Perdemos a conexão' }).waitFor();
  await page.unroute('**/api/discover?**');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await page.getByText('Ainda não encontramos essa órbita.').waitFor();
  await page.getByRole('button', { name: 'Limpar busca e filtros' }).click();
  await page.getByRole('status').filter({ hasText: '12 comunidades' }).waitFor();
  checks.push('Network error is actionable and retry recovers the interface.');

  await page.keyboard.press('Control+k');
  assert.equal(await search.evaluate((element) => document.activeElement === element), true);
  await search.fill('programacao');
  await page.getByRole('button', { name: 'Explorar Dev sem fronteiras', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar na comunidade', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: /Sua mensagem/ }).count(), 0);
  await page.getByRole('button', { name: 'Entrar na comunidade', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Sua mensagem em geral' });
  await composer.waitFor();
  const body = 'Olá, Órbita! <b>texto seguro</b> — teste de persistência.';
  await composer.fill(body);
  await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await page.getByText(body, { exact: true }).waitFor();
  assert.equal(await page.locator('.message p b').count(), 0);
  await page.reload();
  await page.getByText(body, { exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifacts, 'conversation.png'), fullPage: true });
  await page
    .getByRole('navigation', { name: 'Comunidades', exact: true })
    .getByRole('button', { name: 'Abrir Dev sem fronteiras' })
    .waitFor();
  await page.getByRole('button', { name: 'javascript', exact: true }).click();
  await page.getByRole('heading', { name: 'Bem-vindo a #javascript', exact: true }).waitFor();
  assert.equal(await page.getByText(body, { exact: true }).count(), 0);
  checks.push('Join gates message composition; persisted text is escaped and isolated by channel.');

  await page.getByRole('button', { name: 'Voltar a explorar' }).click();
  await page
    .getByRole('complementary', { name: 'Navegação principal' })
    .getByRole('button', { name: /Minhas comunidades/ })
    .click();
  await page.getByRole('button', { name: 'Explorar Dev sem fronteiras', exact: true }).click();
  await page.getByRole('button', { name: 'Sair da comunidade', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar para conversar', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: /Sua mensagem/ }).count(), 0);
  checks.push('Joined library, navigation and leaving update both sidebar and message access.');
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'pt-BR',
  });
  const page = await context.newPage();
  await desktop(page);
  // Two browser contexts model independent users and independent session cookies.
  const bobContext = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    locale: 'pt-BR',
  });
  const bob = await bobContext.newPage();
  bob.on('pageerror', (error) => errors.push(error.message));
  await bob.goto(base);
  await bob.getByRole('button', { name: 'Criar uma conta', exact: true }).click();
  await bob.getByLabel('Seu nome').fill('Beatriz Teste');
  await bob.getByLabel('E-mail', { exact: true }).fill('beatriz@example.test');
  await bob.getByLabel('Senha', { exact: true }).fill('outra senha segura de teste');
  await bob.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await bob.getByRole('status').filter({ hasText: '12 comunidades' }).waitFor();
  await page.goto(base + '/#community/dev');
  await page.getByRole('button', { name: 'Entrar na comunidade', exact: true }).click();
  await bob.goto(base + '/#community/dev');
  await bob.getByRole('button', { name: 'Entrar na comunidade', exact: true }).click();
  await page.getByText('2 online neste canal', { exact: true }).waitFor();
  await bob.getByText('2 online neste canal', { exact: true }).waitFor();
  const aliceInput = page.getByRole('textbox', { name: 'Sua mensagem em geral' });
  await aliceInput.fill('Mensagem ao vivo entre duas contas');
  await bob.getByText('Explorador Teste está digitando…', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await bob.getByText('Mensagem ao vivo entre duas contas', { exact: true }).waitFor();
  assert.equal(
    await bob
      .locator('.message')
      .filter({ hasText: 'Mensagem ao vivo entre duas contas' })
      .locator('.you-label')
      .count(),
    0,
  );
  checks.push(
    'Two independent accounts receive a live message, presence and typing without reloading.',
  );
  const bobUser = (await (await bobContext.request.get(base + '/api/auth/me')).json()) as {
    user: { id: string };
  };
  await bobContext.setOffline(true);
  for (const socket of server.realtime.io.sockets.sockets.values())
    if (socket.data.user.id === bobUser.user.id) socket.conn.close();
  await bob.getByText('Reconectando…', { exact: true }).waitFor();
  for (let i = 0; i < 35; i++) {
    const response = await context.request.post(base + '/api/channels/dev-1/messages', {
      data: { body: `Durante a desconexão ${i}`, clientId: crypto.randomUUID() },
    });
    assert.equal(response.status(), 201);
  }
  await bobContext.setOffline(false);
  await bob.getByText('Ao vivo', { exact: true }).waitFor({ timeout: 15000 });
  await bob.getByText('Durante a desconexão 0', { exact: true }).waitFor();
  await bob.getByText('Durante a desconexão 34', { exact: true }).waitFor();
  assert.equal(
    await bob.locator('.message p').filter({ hasText: 'Durante a desconexão ' }).count(),
    35,
  );
  await bob.screenshot({ path: resolve(artifacts, 'realtime.png'), fullPage: true });
  checks.push(
    'A dropped WebSocket recovers all 35 missed messages, exceeding the recent-history page.',
  );
  await bob.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await bob.getByRole('button', { name: 'Entrar', exact: true }).waitFor();
  assert.equal((await bobContext.request.get(base + '/api/channels/dev-1/messages')).status(), 401);
  await bobContext.close();
  await page.getByText('1 online neste canal', { exact: true }).waitFor();
  checks.push('Logout removes the active session and presence and blocks access to history.');
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  /* desktop context preserves the authenticated session for mobile layout verification */

  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(base);
  await mobile.getByRole('status').filter({ hasText: '12 comunidades' }).waitFor();
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await mobile.screenshot({ path: resolve(artifacts, 'mobile.png'), fullPage: true });
  await mobile.getByRole('button', { name: 'Sobre o Órbita', exact: true }).click();
  await mobile.getByRole('dialog').waitFor();
  await mobile.getByRole('button', { name: 'Fechar informações' }).click();
  assert.equal(await mobile.getByRole('dialog').isVisible(), false);
  await mobile.getByRole('button', { name: 'Explorar Pixel Playground', exact: true }).click();
  await mobile.getByRole('button', { name: 'Entrar para conversar', exact: true }).waitFor();
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  checks.push('390px mobile layout has no page overflow; information dialog and channels work.');
  assert.deepEqual(errors, []);
  const report = {
    passed: checks.length,
    failed: 0,
    browser: await browser.version(),
    checks,
    pageErrors: errors,
  };
  await writeFile(resolve(artifacts, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
  store.close();
}
