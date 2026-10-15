import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { HttpError, parseSearch } from './search.js';
import type { ChannelResult, Community } from '../src/types.js';

function usingStore(action: (store: Store) => void) {
  const store = new Store(':memory:');
  store.db
    .prepare('INSERT INTO users VALUES (?,?,?,?)')
    .run('test-user', 'Test User', 'test@example.test', 'not-used');
  try {
    action(store);
  } finally {
    store.close();
  }
}
const params = (values: Record<string, string> = {}) => new URLSearchParams(values);

test('search supports accents, prefixes, AND terms and neutralizes FTS operators', () =>
  usingStore((store) => {
    assert.equal(store.discover(params({ q: 'programacao' })).items[0].id, 'dev');
    assert.equal(store.discover(params({ q: 'PROGRA' })).items[0].id, 'dev');
    assert.equal(store.discover(params({ q: 'dev projetos' })).total, 1);
    assert.equal(store.discover(params({ q: '***' })).total, 0);
    assert.equal(store.discover(params({ q: "') OR 1=1 --" })).total, 0);
    assert.equal(store.discover(params({ q: '"' })).total, 0);
    assert.throws(() => parseSearch('x'.repeat(121)), HttpError);
    assert.throws(() => parseSearch(Array(13).fill('word').join(' ')), HttpError);
  }));

test('discovery has stable pages, validated filters, facets and member ordering', () =>
  usingStore((store) => {
    const first = store.discover(params());
    const second = store.discover(params({ page: '2' }));
    assert.equal(first.total, 12);
    assert.equal(first.items.length, 6);
    assert.equal(second.items.length, 6);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 12);
    const games = store.discover(params({ category: 'Games' }));
    assert.equal(games.total, 2);
    assert.ok((games.items as Community[]).every((item) => item.category === 'Games'));
    assert.equal(games.categories.find((c) => c.name === 'Todos')?.count, 12);
    assert.equal(store.discover(params({ sort: 'members' })).items[0].id, 'lofi');
    assert.equal(store.discover(params({ sort: 'newest' })).items[0].id, 'trilha');
    assert.equal(store.discover(params({ page: '3' })).items.length, 0);
    const invalid: Record<string, string>[] = [
      { page: '-1' },
      { page: '1.5' },
      { page: '9007199254740992' },
      { scope: 'all' },
      { category: 'fake' },
      { sort: 'name' },
    ];
    for (const value of invalid) assert.throws(() => store.discover(params(value)), HttpError);
  }));

test('channel discovery finds topics within selected community categories', () =>
  usingStore((store) => {
    const result = store.discover(
      params({ scope: 'channels', q: 'javascript', category: 'Tecnologia' }),
    );
    assert.equal(result.total, 6);
    assert.ok(
      (result.items as ChannelResult[]).some(
        (item) => item.communityId === 'dev' && item.name === 'javascript',
      ),
    );
    assert.ok((result.items as ChannelResult[]).every((item) => item.category === 'Tecnologia'));
    const games = store.discover(params({ scope: 'channels', category: 'Games' }));
    assert.equal(games.total, 10);
  }));

test('membership writes are idempotent; message access requires membership', () =>
  usingStore((store) => {
    const original = store.getCommunity('dev');
    assert.throws(() => store.createMessage('dev-1', 'Hello', 'test-user', randomUUID()), {
      status: 403,
    });
    store.setMembership('dev', true, 'test-user');
    store.setMembership('dev', true, 'test-user');
    assert.equal(store.getCommunity('dev').members, original.members + 1);
    assert.equal(store.getMemberships('test-user').length, 1);
    const message = store.createMessage(
      'dev-1',
      '  <script>alert("x")</script>  ',
      'test-user',
      randomUUID(),
    );
    assert.equal(message.body, '<script>alert("x")</script>');
    assert.equal(message.own, true);
    assert.equal(store.getMessages('dev-1', null, 'test-user').items.at(-1)?.id, message.id);
    assert.throws(() => store.createMessage('dev-1', ' ', 'test-user', randomUUID()), {
      status: 400,
    });
    assert.throws(() => store.createMessage('dev-1', 'x'.repeat(2001), 'test-user', randomUUID()), {
      status: 400,
    });
    assert.throws(() => store.createMessage('dev-1', { body: 'x' }, 'test-user', randomUUID()), {
      status: 400,
    });
    store.setMembership('dev', false, 'test-user');
    assert.equal(store.getCommunity('dev').members, original.members);
    assert.throws(() => store.createMessage('dev-1', 'blocked', 'test-user', randomUUID()), {
      status: 403,
    });
    assert.throws(() => store.getCommunity('missing'), { status: 404 });
    assert.throws(() => store.getMessages('missing', null, 'test-user'), { status: 404 });
  }));

test('message history uses an exclusive cursor with no duplicate or lost rows', () =>
  usingStore((store) => {
    store.setMembership('dev', true, 'test-user');
    for (let i = 0; i < 35; i++)
      store.createMessage('dev-1', `message ${i}`, 'test-user', randomUUID());
    const latest = store.getMessages('dev-1', null, 'test-user');
    assert.equal(latest.items.length, 30);
    assert.equal(latest.hasMore, true);
    const older = store.getMessages('dev-1', String(latest.items[0].id), 'test-user');
    assert.equal(older.items.length, 8);
    assert.equal(older.hasMore, false);
    assert.equal(new Set([...older.items, ...latest.items].map((item) => item.id)).size, 38);
    assert.ok(older.items.at(-1)!.id < latest.items[0].id);
    assert.throws(() => store.getMessages('dev-1', '-5', 'test-user'), { status: 400 });
  }));

test('memberships and messages survive database reopen without duplicate seed data', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbita-db-'));
  const path = join(root, 'test.sqlite');
  let store = new Store(path);
  store.db
    .prepare('INSERT INTO users VALUES (?,?,?,?)')
    .run('test-user', 'Test User', 'test@example.test', 'not-used');
  try {
    store.setMembership('pixel', true, 'test-user');
    const sent = store.createMessage(
      'pixel-1',
      'Persistência verificada',
      'test-user',
      randomUUID(),
    );
    store.close();
    store = new Store(path);
    assert.equal(store.getMemberships('test-user')[0].id, 'pixel');
    assert.equal(store.getMessages('pixel-1', null, 'test-user').items.at(-1)?.id, sent.id);
    assert.equal(store.discover(params()).total, 12);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
