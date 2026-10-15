import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { HttpError } from './search.js';
import type { Store } from './store.js';
import type { User } from '../src/types.js';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))),
  );
}
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function sessionToken(cookie: string | undefined) {
  return (
    cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('orbita_session='))
      ?.slice('orbita_session='.length) ?? ''
  );
}
function credentials(email: unknown, password: unknown) {
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' ||
    password.length < 10 ||
    password.length > 128
  )
    throw new HttpError(400, 'Informe um e-mail válido e uma senha de 10 a 128 caracteres.');
  return { email: email.trim().toLowerCase(), password };
}
export class Auth {
  constructor(private store: Store) {}
  async register(name: unknown, email: unknown, password: unknown) {
    const c = credentials(email, password);
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 40)
      throw new HttpError(400, 'Use um nome entre 2 e 40 caracteres.');
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(c.password, salt)).toString('hex');
    const id = randomUUID();
    try {
      this.store.db
        .prepare('INSERT INTO users(id,name,email,password_hash) VALUES (?,?,?,?)')
        .run(id, name.trim(), c.email, `${salt}:${hash}`);
    } catch (error) {
      if (this.store.db.prepare('SELECT id FROM users WHERE email=?').get(c.email))
        throw new HttpError(409, 'Não foi possível criar a conta com este e-mail. Tente entrar.');
      throw error;
    }
    return this.createSession(id);
  }
  async login(email: unknown, password: unknown) {
    const c = credentials(email, password);
    const row = this.store.db
      .prepare('SELECT id,password_hash FROM users WHERE email=?')
      .get(c.email);
    const [salt, hash] = String(row?.password_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(
      ':',
    );
    const key = await derive(c.password, salt);
    if (!row || !timingSafeEqual(key, Buffer.from(hash, 'hex')))
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    return this.createSession(String(row.id));
  }
  private createSession(userId: string) {
    this.store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    this.store.db
      .prepare('INSERT INTO sessions VALUES (?,?,?)')
      .run(digest(token), userId, Date.now() + SESSION_MS);
    return { token, user: this.userForToken(token)! };
  }
  userForToken(token: string): User | null {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.store.db
      .prepare(
        'SELECT u.id,u.name FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
      )
      .get(digest(token), Date.now());
    return row ? { id: String(row.id), name: String(row.name) } : null;
  }
  require(token: string) {
    const user = this.userForToken(token);
    if (!user) throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
    return user;
  }
  logout(token: string) {
    this.store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
  }
}
