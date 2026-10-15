import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { communities, seedChannels } from './seed.js';
import { HttpError, integerParam, parseSearch } from './search.js';
import {
  CATEGORIES,
  type Community,
  type DiscoveryResult,
  type ChannelResult,
  type Channel,
  type Message,
} from '../src/types.js';

type Row = Record<string, unknown>;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS message_receipts (user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL, message_id INTEGER NOT NULL REFERENCES messages(id), PRIMARY KEY(user_id,client_id));
      CREATE TABLE IF NOT EXISTS communities (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
        tags TEXT NOT NULL, members INTEGER NOT NULL, online INTEGER NOT NULL,
        accent TEXT NOT NULL, artwork TEXT NOT NULL, initials TEXT NOT NULL, verified INTEGER NOT NULL, position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id), name TEXT NOT NULL,
        description TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('text', 'voice')), position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memberships (
        user_id TEXT NOT NULL, community_id TEXT NOT NULL REFERENCES communities(id), PRIMARY KEY(user_id, community_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL REFERENCES channels(id),
        author_id TEXT NOT NULL, author TEXT NOT NULL, initials TEXT NOT NULL, color TEXT NOT NULL,
        body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_channel_id ON messages(channel_id, id);
      CREATE VIRTUAL TABLE IF NOT EXISTS discovery_index USING fts5(
        entity_id UNINDEXED, kind UNINDEXED, name, description, tags, community_name,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
    if (Number(this.db.prepare('SELECT count(*) AS n FROM communities').get()?.n) === 0)
      this.seed();
  }

  close() {
    this.db.close();
  }

  private seed() {
    this.db.exec('BEGIN');
    try {
      const insertCommunity = this.db.prepare(
        'INSERT INTO communities(id,name,description,category,tags,members,online,accent,artwork,initials,verified,position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      const index = this.db.prepare(
        'INSERT INTO discovery_index(entity_id,kind,name,description,tags,community_name) VALUES (?,?,?,?,?,?)',
      );
      const insertChannel = this.db.prepare('INSERT INTO channels VALUES (?,?,?,?,?,?)');
      const insertMessage = this.db.prepare(
        'INSERT INTO messages(channel_id, author_id, author, initials, color, body, created_at) VALUES (?,?,?,?,?,?,?)',
      );
      for (const [position, community] of communities.entries()) {
        const c = community;
        insertCommunity.run(
          c.id,
          c.name,
          c.description,
          c.category,
          JSON.stringify(c.tags),
          c.members,
          c.online,
          c.accent,
          c.artwork,
          c.initials,
          Number(c.verified),
          position,
        );
        index.run(c.id, 'community', c.name, c.description, c.tags.join(' '), c.name);
        for (const [channelPosition, channel] of seedChannels(c).entries()) {
          insertChannel.run(
            channel.id,
            c.id,
            channel.name,
            channel.description,
            channel.type,
            channelPosition,
          );
          index.run(
            channel.id,
            'channel',
            channel.name,
            channel.description,
            c.tags.join(' '),
            c.name,
          );
          const messages = [
            [
              'ana',
              'Ana Lima',
              'AL',
              '#d3b9ff',
              `Boas-vindas ao #${channel.name}! Que bom ter você por aqui. ✨`,
            ],
            [
              'leo',
              'Léo Costa',
              'LC',
              '#8ce2d0',
              `Esse é o nosso espaço para ${channelPosition > 1 ? channel.name.replaceAll('-', ' ') : 'trocar ideias'}. Fique à vontade para participar!`,
            ],
            [
              'bia',
              'Bia Santos',
              'BS',
              '#ffb99c',
              'Adoro encontrar gente que compartilha os mesmos interesses. O que vocês estão criando hoje?',
            ],
          ];
          for (const [i, m] of messages.entries())
            insertMessage.run(
              channel.id,
              ...m,
              new Date(Date.UTC(2026, 0, 15, 14, 30 + i * 4)).toISOString(),
            );
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private mapCommunity(row: Row): Community {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      category: row.category as Community['category'],
      tags: JSON.parse(String(row.tags)) as string[],
      members: Number(row.members) + Number(row.member_count ?? 0),
      online: Number(row.online),
      accent: String(row.accent),
      artwork: String(row.artwork),
      initials: String(row.initials),
      verified: Boolean(row.verified),
      joined: Boolean(row.joined),
    };
  }

  getCommunity(id: string, userId: string | null = null) {
    const row = this.db
      .prepare(
        'SELECT c.*, (SELECT count(*) FROM memberships mc JOIN users u ON u.id=mc.user_id WHERE mc.community_id=c.id) AS member_count, EXISTS(SELECT 1 FROM memberships m WHERE m.community_id=c.id AND m.user_id=?) AS joined FROM communities c WHERE c.id=?',
      )
      .get(userId, id);
    if (!row) throw new HttpError(404, 'Comunidade não encontrada.');
    return this.mapCommunity(row);
  }

  getMemberships(userId: string) {
    const rows = this.db
      .prepare(
        'SELECT c.*, (SELECT count(*) FROM memberships mc JOIN users u ON u.id=mc.user_id WHERE mc.community_id=c.id) AS member_count, 1 AS joined FROM communities c JOIN memberships m ON m.community_id=c.id WHERE m.user_id=? ORDER BY c.position',
      )
      .all(userId);
    return rows.map((row) => this.mapCommunity(row));
  }

  setMembership(id: string, joined: boolean, userId: string) {
    this.getCommunity(id, userId);
    if (joined) this.db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?)').run(userId, id);
    else
      this.db.prepare('DELETE FROM memberships WHERE user_id=? AND community_id=?').run(userId, id);
    return this.getCommunity(id, userId);
  }

  discover(params: URLSearchParams, userId: string | null = null): DiscoveryResult {
    const scope = params.get('scope') ?? 'communities';
    if (!['communities', 'channels'].includes(scope))
      throw new HttpError(400, 'Tipo de busca inválido.');
    const category = params.get('category') ?? 'Todos';
    if (!(CATEGORIES as readonly string[]).includes(category))
      throw new HttpError(400, 'Categoria inválida.');
    const sort = params.get('sort') ?? 'recommended';
    if (!['recommended', 'members', 'newest'].includes(sort))
      throw new HttpError(400, 'Ordenação inválida.');
    const page = integerParam(params.get('page'), 1, 10000, 'Página');
    const pageSize = 6;
    const search = parseSearch(params.get('q') ?? '');
    const isChannel = scope === 'channels';
    const from = isChannel
      ? `FROM channels ch JOIN communities c ON c.id=ch.community_id JOIN discovery_index d ON d.entity_id=ch.id AND d.kind='channel'`
      : `FROM communities c JOIN discovery_index d ON d.entity_id=c.id AND d.kind='community'`;
    const conditions: string[] = [];
    const args: SQLInputValue[] = [];
    if (search.query) {
      if (search.hasTokens) {
        conditions.push('discovery_index MATCH ?');
        args.push(search.match);
      } else conditions.push('0=1');
    }
    const baseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const facetRows = this.db
      .prepare(`SELECT c.category, count(*) AS n ${from} ${baseWhere} GROUP BY c.category`)
      .all(...args);
    const categories = CATEGORIES.map((name) => ({
      name,
      count:
        name === 'Todos'
          ? facetRows.reduce((n, r) => n + Number(r.n), 0)
          : Number(facetRows.find((r) => r.category === name)?.n ?? 0),
    }));
    if (category !== 'Todos') {
      conditions.push('c.category=?');
      args.push(category);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(
      this.db.prepare(`SELECT count(*) AS n ${from} ${where}`).get(...args)?.n ?? 0,
    );
    const order =
      sort === 'members'
        ? 'c.members DESC, c.id'
        : sort === 'newest'
          ? 'c.position DESC, c.id'
          : search.hasTokens
            ? 'bm25(discovery_index,0,0,8,2,5,3), c.position'
            : 'c.position';
    const fields = isChannel
      ? 'ch.*, c.name AS community_name, c.category, c.accent, c.members'
      : 'c.*, (SELECT count(*) FROM memberships mc JOIN users u ON u.id=mc.user_id WHERE mc.community_id=c.id) AS member_count, EXISTS(SELECT 1 FROM memberships m WHERE m.community_id=c.id AND m.user_id=?) AS joined';
    const rows = this.db
      .prepare(
        `SELECT ${fields} ${from} ${where} ORDER BY ${order}${isChannel ? ', ch.position' : ''} LIMIT ? OFFSET ?`,
      )
      .all(...(isChannel ? [] : [userId]), ...args, pageSize, (page - 1) * pageSize);
    const items = isChannel
      ? rows.map((row) => ({
          ...this.mapChannel(row),
          communityName: String(row.community_name),
          category: row.category as ChannelResult['category'],
          accent: String(row.accent),
          members: Number(row.members),
        }))
      : rows.map((row) => this.mapCommunity(row));
    return { items, total, page, pageSize, categories };
  }

  private mapChannel(row: Row): Channel {
    return {
      id: String(row.id),
      communityId: String(row.community_id),
      name: String(row.name),
      description: String(row.description),
      type: row.type as Channel['type'],
    };
  }

  getChannels(communityId: string) {
    this.getCommunity(communityId);
    return this.db
      .prepare('SELECT * FROM channels WHERE community_id=? ORDER BY position')
      .all(communityId)
      .map((row) => this.mapChannel(row));
  }

  private requireChannel(id: string) {
    const channel = this.db.prepare('SELECT * FROM channels WHERE id=?').get(id);
    if (!channel) throw new HttpError(404, 'Canal não encontrado.');
    return this.mapChannel(channel);
  }

  private mapMessage(row: Row, userId: string): Message {
    return {
      id: Number(row.id),
      author: String(row.author),
      initials: String(row.initials),
      color: String(row.color),
      body: String(row.body),
      createdAt: String(row.created_at),
      authorId: String(row.author_id),
      own: row.author_id === userId,
    };
  }

  getMessages(channelId: string, before: string | null | undefined, userId: string) {
    this.requireMembership(channelId, userId);
    const beforeId = integerParam(
      before ?? null,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      'Cursor',
    );
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE channel_id=? AND id<? ORDER BY id DESC LIMIT 31')
      .all(channelId, beforeId);
    return {
      hasMore: rows.length > 30,
      items: rows
        .slice(0, 30)
        .reverse()
        .map((row) => this.mapMessage(row, userId)),
    };
  }

  requireMembership(channelId: string, userId: string) {
    const channel = this.requireChannel(channelId);
    if (!this.getCommunity(channel.communityId, userId).joined)
      throw new HttpError(403, 'Entre na comunidade para acessar as mensagens.');
    return channel;
  }

  getMessagesAfter(channelId: string, after: string, userId: string) {
    this.requireMembership(channelId, userId);
    const cursor = integerParam(after, 1, Number.MAX_SAFE_INTEGER, 'Cursor');
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE channel_id=? AND id>? ORDER BY id LIMIT 101')
      .all(channelId, cursor);
    return {
      hasMore: rows.length > 100,
      items: rows.slice(0, 100).map((row) => this.mapMessage(row, userId)),
    };
  }

  createMessage(channelId: string, body: unknown, userId: string, clientId: unknown) {
    this.requireMembership(channelId, userId);
    if (typeof body !== 'string' || !body.trim() || body.trim().length > 2000)
      throw new HttpError(400, 'A mensagem deve ter entre 1 e 2.000 caracteres.');
    if (typeof clientId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(clientId))
      throw new HttpError(400, 'Identificador de envio inválido.');
    const existing = this.db
      .prepare(
        'SELECT m.* FROM messages m JOIN message_receipts r ON r.message_id=m.id WHERE r.user_id=? AND r.client_id=?',
      )
      .get(userId, clientId);
    if (existing) {
      if (existing.channel_id !== channelId || existing.body !== body.trim())
        throw new HttpError(409, 'Identificador de envio já utilizado.');
      return this.mapMessage(existing, userId);
    }
    const user = this.db.prepare('SELECT name FROM users WHERE id=?').get(userId);
    if (!user) throw new HttpError(401, 'Entre novamente.');
    const name = String(user.name);
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toUpperCase();
    this.db.exec('BEGIN');
    try {
      const result = this.db
        .prepare(
          'INSERT INTO messages(channel_id,author_id,author,initials,color,body,created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(channelId, userId, name, initials, '#c8f078', body.trim(), new Date().toISOString());
      this.db
        .prepare('INSERT INTO message_receipts VALUES (?,?,?)')
        .run(userId, clientId, result.lastInsertRowid);
      const message = this.mapMessage(
        this.db.prepare('SELECT * FROM messages WHERE id=?').get(result.lastInsertRowid)!,
        userId,
      );
      this.db.exec('COMMIT');
      return message;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
