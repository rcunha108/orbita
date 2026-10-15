import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api';
import type { Message, MessagesResult, User } from '../types';

export function mergeMessages(old: Message[], incoming: Message[]) {
  return [...new Map([...old, ...incoming].map((m) => [m.id, m])).values()].sort(
    (a, b) => a.id - b.id,
  );
}
export function useRealtimeChannel(channelId: string, joined: boolean) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(joined);
  const [status, setStatus] = useState('Conectando…');
  const [presence, setPresence] = useState<User[]>([]);
  const [typists, setTypists] = useState<Record<string, { name: string; until: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    if (!joined) {
      setMessages([]);
      latest.current = 0;
      setPresence([]);
      setTypists({});
      setLoading(false);
      return;
    }
    let alive = true;
    let generation = 0;
    const controller = new AbortController();
    const socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    setLoading(true);
    socket.on('message', (message: Message) => {
      if (alive) {
        latest.current = Math.max(latest.current, message.id);
        setMessages((old) => mergeMessages(old, [message]));
      }
    });
    socket.on('call', (call) =>
      window.dispatchEvent(new CustomEvent('orbita:call', { detail: call })),
    );
    socket.on('presence', (users: User[]) => {
      if (alive) setPresence(users);
    });
    socket.on('typing', (item: { userId: string; name: string; until: number }) => {
      if (alive)
        setTypists((old) => ({ ...old, [item.userId]: { name: item.name, until: item.until } }));
    });
    socket.on('connect', () => {
      const attempt = ++generation;
      const after = latest.current;
      socket
        .timeout(8000)
        .emit(
          'channel:join',
          { channelId },
          async (
            timeout: Error | null,
            result: { ok: boolean; error?: string; history: MessagesResult },
          ) => {
            if (!alive || attempt !== generation) return;
            if (timeout || !result?.ok) {
              setError(result?.error ?? 'Não foi possível conectar ao canal.');
              setLoading(false);
              setStatus('Sem conexão');
              return;
            }
            try {
              if (after) {
                let cursor = after;
                let more = true;
                while (more && alive && attempt === generation) {
                  const page = await api<MessagesResult>(
                    `/channels/${channelId}/messages?after=${cursor}`,
                    { signal: controller.signal },
                  );
                  if (!alive || attempt !== generation) return;
                  setMessages((old) => mergeMessages(old, page.items));
                  if (page.items.length) {
                    cursor = page.items.at(-1)!.id;
                    latest.current = Math.max(latest.current, cursor);
                  }
                  more = page.hasMore;
                }
              } else {
                latest.current = Math.max(latest.current, ...result.history.items.map((m) => m.id));
                setMessages((old) => mergeMessages(old, result.history.items));
                setHasMore(result.history.hasMore);
              }
              if (alive && attempt === generation) {
                setLoading(false);
                setError(null);
                setStatus('Ao vivo');
              }
            } catch (error) {
              if (alive) {
                setError(error instanceof Error ? error.message : 'Erro ao recuperar mensagens.');
                setLoading(false);
                setStatus('Falha na sincronização');
              }
            }
          },
        );
    });
    socket.on('membership:revoked', () =>
      window.dispatchEvent(new Event('orbita:memberships-changed')),
    );
    socket.on('disconnect', () => {
      generation++;
      if (alive) {
        setStatus('Reconectando…');
        setPresence([]);
        setTypists({});
        void api<{ user: User | null }>('/auth/me')
          .then((result) => {
            if (!result.user) window.dispatchEvent(new Event('orbita:unauthorized'));
          })
          .catch(() => {});
      }
    });
    socket.on('connect_error', () => {
      if (alive) {
        setStatus('Reconectando…');
        setLoading(false);
        void api<{ user: User | null }>('/auth/me')
          .then((result) => {
            if (!result.user) window.dispatchEvent(new Event('orbita:unauthorized'));
          })
          .catch(() => {});
      }
    });
    socket.connect();
    const timer = setInterval(
      () =>
        setTypists((old) =>
          Object.fromEntries(Object.entries(old).filter(([, v]) => v.until > Date.now())),
        ),
      1000,
    );
    return () => {
      alive = false;
      generation++;
      controller.abort();
      clearInterval(timer);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [channelId, joined]);
  return {
    messages,
    setMessages,
    hasMore,
    setHasMore,
    loading,
    status,
    presence,
    error,
    setError,
    typingNames: Object.values(typists)
      .filter((v) => v.until > Date.now())
      .map((v) => v.name),
    typing: (active: boolean) => {
      if (socketRef.current?.connected) socketRef.current.emit('typing', active);
    },
  };
}
