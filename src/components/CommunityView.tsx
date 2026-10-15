import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronDown,
  Hash,
  LoaderCircle,
  Send,
  Users,
} from 'lucide-react';
import { api, jsonOptions } from '../api';
import type { Channel, Community, Message, MessagesResult } from '../types';
import { Artwork } from './Artwork';
import { formatNumber } from './CommunityCard';
const MediaPanel = lazy(() =>
  import('./MediaPanel').then((module) => ({ default: module.MediaPanel })),
);
import { useRealtimeChannel, mergeMessages } from '../hooks/useRealtimeChannel';

interface Props {
  id: string;
  initialChannel?: string;
  back: () => void;
  membershipChanged: () => void;
}

export function CommunityView({ id, initialChannel, back, membershipChanged }: Props) {
  const [community, setCommunity] = useState<Community | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setCommunity(null);
    setChannels([]);
    setChannelId(null);
    void Promise.all([
      api<Community>(`/communities/${id}`, { signal: controller.signal }),
      api<Channel[]>(`/communities/${id}/channels`, { signal: controller.signal }),
    ])
      .then(([c, list]) => {
        if (controller.signal.aborted) return;
        setCommunity(c);
        setChannels(list);
        setChannelId(
          list.find((ch) => ch.id === initialChannel)?.id ??
            list.find((ch) => ch.name === 'geral')?.id ??
            list[0]?.id ??
            null,
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Não foi possível abrir a comunidade.');
      });
    return () => controller.abort();
  }, [id, initialChannel]);

  async function toggleMembership() {
    if (!community) return;
    setJoining(true);
    setError(null);
    try {
      const updated = await api<Community>(
        `/communities/${id}/membership`,
        jsonOptions('PUT', { joined: !community.joined }),
      );
      setCommunity(updated);
      membershipChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível atualizar.');
    } finally {
      setJoining(false);
    }
  }

  useEffect(() => {
    const update = () => {
      void api<Community>(`/communities/${id}`)
        .then(setCommunity)
        .catch(() => {});
    };
    window.addEventListener('orbita:memberships-changed', update);
    return () => window.removeEventListener('orbita:memberships-changed', update);
  }, [id]);

  const activeChannel = channels.find((ch) => ch.id === channelId);
  return (
    <div className="community-layout">
      <aside className="channel-sidebar" aria-label="Canais da comunidade">
        <button className="back-discovery" onClick={back}>
          <ArrowLeft size={16} />
          Voltar a explorar
        </button>
        {community && (
          <>
            <div className="mini-cover">
              <Artwork kind={community.artwork} compact />
            </div>
            <h2>{community.name}</h2>
            <div className="sidebar-online">
              <i className="online-dot" />
              {formatNumber(community.online)} online
            </div>
            <div className="channel-section">
              CANAIS DE TEXTO <ChevronDown size={14} />
            </div>
            {channels.map((channel) => (
              <button
                key={channel.id}
                className={`channel-nav ${channelId === channel.id ? 'active' : ''}`}
                onClick={() => setChannelId(channel.id)}
              >
                <Hash size={18} />
                <span>{channel.name}</span>
              </button>
            ))}
          </>
        )}
      </aside>
      <section className="conversation-area">
        {!community && !error && (
          <div className="center-state">
            <LoaderCircle className="spin" />
            <p>Abrindo comunidade…</p>
          </div>
        )}
        {!community && error && (
          <div className="center-state" role="alert">
            <p>{error}</p>
            <button className="primary-button" onClick={back}>
              Voltar a explorar
            </button>
          </div>
        )}
        {community && (
          <>
            <header className="conversation-header">
              <div>
                <Hash size={24} />
                <h1>{activeChannel?.name ?? community.name}</h1>
                <span className="header-divider" />
                <p>{activeChannel?.description}</p>
              </div>
              <span className="member-total">
                <Users size={17} />
                {formatNumber(community.members)}
              </span>
            </header>
            <div className="community-welcome">
              <span className="welcome-icon" style={{ background: community.accent }}>
                {community.initials}
              </span>
              <div>
                <span className="eyebrow">ESSE TAMBÉM PODE SER O SEU LUGAR</span>
                <h2>
                  {community.name}
                  {community.verified && <BadgeCheck size={21} />}
                </h2>
                <p>{community.description}</p>
              </div>
              <button
                className={community.joined ? 'secondary-button' : 'primary-button'}
                onClick={() => void toggleMembership()}
                disabled={joining}
              >
                {joining ? (
                  <LoaderCircle size={16} className="spin" />
                ) : community.joined ? (
                  <Check size={16} />
                ) : (
                  <Users size={16} />
                )}
                {community.joined ? 'Sair da comunidade' : 'Entrar na comunidade'}
              </button>
            </div>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            {activeChannel && (
              <Conversation
                key={`${id}:${activeChannel.id}`}
                channel={activeChannel}
                joined={community.joined}
                join={() => void toggleMembership()}
                joining={joining}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Conversation({
  channel,
  joined,
  join,
  joining,
}: {
  channel: Channel;
  joined: boolean;
  join: () => void;
  joining: boolean;
}) {
  const {
    messages,
    setMessages,
    hasMore,
    setHasMore,
    loading,
    status,
    presence,
    error,
    setError,
    typingNames,
    typing,
  } = useRealtimeChannel(channel.id, joined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const pending = useRef<{ body: string; id: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const result = await api<MessagesResult>(
        `/channels/${channel.id}/messages?before=${messages[0]?.id}`,
      );
      if (alive.current) {
        setMessages((previous) => mergeMessages(previous, result.items));
        setHasMore(result.hasMore);
      }
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'Erro ao carregar histórico.');
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    setError(null);
    if (pending.current?.body !== body) pending.current = { body, id: crypto.randomUUID() };
    try {
      const message = await api<Message>(
        `/channels/${channel.id}/messages`,
        jsonOptions('POST', { body, clientId: pending.current!.id }),
      );
      if (alive.current) {
        setMessages((previous) => mergeMessages(previous, [message]));
        pending.current = null;
        typing(false);
        setBody('');
        requestAnimationFrame(() =>
          bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
        );
      }
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : 'Erro ao enviar.');
    } finally {
      if (alive.current) setSending(false);
    }
  }

  return (
    <>
      {joined && (
        <Suspense fallback={<div className="media-panel">Preparando áudio…</div>}>
          <MediaPanel channelId={channel.id} online={presence} />
        </Suspense>
      )}
      {joined && (
        <div className="live-status" role="status">
          <span>{status}</span>
          <span>{presence.length} online neste canal</span>
        </div>
      )}
      <div className="message-list" aria-label={`Mensagens em ${channel.name}`}>
        {hasMore && (
          <button className="history-button" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        )}
        <div className="channel-intro">
          <span>
            <Hash size={34} />
          </span>
          <h2>Bem-vindo a #{channel.name}</h2>
          <p>{channel.description}</p>
        </div>
        <div className="date-divider">
          <span>Início da conversa</span>
        </div>
        {loading && <p role="status">Carregando mensagens…</p>}
        {messages.map((message) => (
          <article className="message" key={message.id}>
            <span className="message-avatar" style={{ background: message.color }}>
              {message.initials}
            </span>
            <div>
              <header>
                <strong>{message.author}</strong>
                {message.own && <span className="you-label">VOCÊ</span>}
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </header>
              <p>{message.body}</p>
            </div>
          </article>
        ))}
        <div ref={bottom} />
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {joined && (
        <div className="typing-status" aria-live="polite">
          {typingNames.length ? `${typingNames.slice(0, 3).join(', ')} está digitando…` : ''}
        </div>
      )}
      {joined ? (
        <form className="composer" onSubmit={(event) => void send(event)}>
          <label className="sr-only" htmlFor="message-input">
            Sua mensagem em {channel.name}
          </label>
          <input
            id="message-input"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              typing(Boolean(event.target.value.trim()));
            }}
            onBlur={() => typing(false)}
            placeholder={`Converse em #${channel.name}`}
            maxLength={2000}
            disabled={sending}
            autoComplete="off"
          />
          <span className="message-length">{body.length ? `${body.length}/2000` : ''}</span>
          <button
            type="submit"
            aria-label="Enviar mensagem"
            disabled={!body.trim() || sending || status !== 'Ao vivo'}
          >
            {sending ? <LoaderCircle size={19} className="spin" /> : <Send size={19} />}
          </button>
        </form>
      ) : (
        <div className="join-prompt">
          <p>Gostou da conversa? Tem espaço para você aqui.</p>
          <button className="primary-button" onClick={join} disabled={joining}>
            Entrar para conversar
          </button>
        </div>
      )}
    </>
  );
}
