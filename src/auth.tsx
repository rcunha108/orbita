import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, jsonOptions } from './api';
import type { User } from './types';
import { OrbitMark } from './components/Artwork';

const AuthContext = createContext<{ user: User; logout: () => Promise<void> } | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Authentication required');
  return value;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void api<{ user: User | null }>('/auth/me')
        .then((data) => {
          if (alive) {
            setUser(data.user);
            setError('');
          }
        })
        .catch(() => {
          if (alive) setError('Não foi possível conectar ao servidor.');
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    const expire = () => setUser(null);
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('orbita:unauthorized', expire);
    document.addEventListener('visibilitychange', visibility);
    const broadcast = new BroadcastChannel('orbita-auth');
    broadcast.onmessage = refresh;
    return () => {
      alive = false;
      broadcast.close();
      window.removeEventListener('orbita:unauthorized', expire);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  async function logout() {
    await api('/auth/logout', jsonOptions('POST', {}));
    setUser(null);
    const channel = new BroadcastChannel('orbita-auth');
    channel.postMessage('changed');
    channel.close();
  }
  if (loading)
    return (
      <div className="auth-page">
        <p role="status">Abrindo sua órbita…</p>
      </div>
    );
  if (!user) return <AuthScreen initialError={error} signedIn={setUser} />;
  return (
    <AuthContext.Provider key={user.id} value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
function AuthScreen({
  signedIn,
  initialError,
}: {
  signedIn: (user: User) => void;
  initialError: string;
}) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ user: User }>(
        register ? '/auth/register' : '/auth/login',
        jsonOptions('POST', { name, email, password }),
      );
      signedIn(data.user);
      const channel = new BroadcastChannel('orbita-auth');
      channel.postMessage('changed');
      channel.close();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <OrbitMark size={38} />
          órbita
        </div>
        <span className="eyebrow">CONEXÕES QUE ACONTECEM AGORA</span>
        <h1>{register ? 'Encontre sua turma.' : 'Bom ter você de volta.'}</h1>
        <p>Uma conta sua. Um universo de conversas.</p>
        <form onSubmit={(event) => void submit(event)}>
          {register && (
            <label>
              Seu nome
              <input
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={40}
              />
            </label>
          )}
          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              maxLength={128}
            />
          </label>
          {register && <small>Use de 10 a 128 caracteres.</small>}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? 'Conectando…' : register ? 'Criar conta' : 'Entrar'}
          </button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setRegister(!register);
            setError('');
            setPassword('');
          }}
        >
          {register ? 'Já tenho conta' : 'Criar uma conta'}
        </button>
        <p className="auth-footnote">Comunidades de exemplo. Conversas reais entre suas contas.</p>
      </section>
    </main>
  );
}
