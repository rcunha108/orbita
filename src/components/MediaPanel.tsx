import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type Participant,
  type VideoTrack,
} from 'livekit-client';
import { Mic, MicOff, Monitor, Phone, PhoneOff, Volume2 } from 'lucide-react';
import { api, jsonOptions } from '../api';
import { useAuth } from '../auth';
import type { Call, User } from '../types';

type Screen = { identity: string; name: string; track: VideoTrack };
export function MediaPanel({ channelId, online }: { channelId: string; online: User[] }) {
  const { user } = useAuth();
  const [configured, setConfigured] = useState(false);
  const [call, setCall] = useState<Call | null>(null);
  const [target, setTarget] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [participants, setParticipants] = useState<{ id: string; name: string; muted: boolean }[]>(
    [],
  );
  const [screens, setScreens] = useState<Screen[]>([]);
  const roomRef = useRef<Room | null>(null);
  const audio = useRef<HTMLDivElement>(null);
  const callRef = useRef<Call | null>(null);
  const connected = useRef(false);
  const privateCall = call?.state === 'active' ? call : null;
  const roomKey = privateCall?.id ?? (enabled ? 'channel' : null);
  useEffect(() => {
    let alive = true;
    void api<{ configured: boolean }>('/media/status')
      .then((r) => {
        if (alive) setConfigured(r.configured);
      })
      .catch(() => {});
    void api<{ call: Call | null }>(`/channels/${channelId}/call`)
      .then((r) => {
        if (alive) {
          setCall(r.call);
          callRef.current = r.call;
        }
      })
      .catch(() => {});
    const update = (event: Event) => {
      const next = (event as CustomEvent<Call | null>).detail;
      if (next && next.channelId !== channelId) return;
      callRef.current = next;
      setCall(next);
      if (next?.state === 'active') setEnabled(false);
    };
    window.addEventListener('orbita:call', update);
    return () => {
      alive = false;
      window.removeEventListener('orbita:call', update);
      if (callRef.current)
        void api(`/calls/${callRef.current.id}/end`, jsonOptions('POST', {})).catch(() => {});
    };
  }, [channelId]);
  useEffect(() => {
    if (!roomKey) {
      setStatus('');
      return;
    }
    let disposed = false;
    let microphone: LocalAudioTrack | undefined;
    const room = new Room({ adaptiveStream: true, dynacast: true, singlePeerConnection: false });
    roomRef.current = room;
    setStatus('Conectando áudio…');
    setError('');
    setAudioBlocked(false);
    function refresh() {
      if (disposed) return;
      const list: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
      setParticipants(
        list.map((p) => ({
          id: p.identity,
          name: p.name ?? p.identity,
          muted: !p.isMicrophoneEnabled,
        })),
      );
      setMuted(!room.localParticipant.isMicrophoneEnabled);
      setSharing(room.localParticipant.isScreenShareEnabled);
      setScreens(
        list.flatMap((p) => {
          const track = p.getTrackPublication(Track.Source.ScreenShare)?.track;
          return track && track.kind === 'video'
            ? [{ identity: p.identity, name: p.name ?? 'Participante', track: track as VideoTrack }]
            : [];
        }),
      );
    }
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (!disposed) setAudioBlocked(!room.canPlaybackAudio);
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === 'audio') {
        const element = track.attach();
        element.autoplay = true;
        audio.current?.append(element);
      }
      refresh();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());
      refresh();
    });
    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
    ])
      room.on(event, refresh);
    room.on(RoomEvent.Reconnecting, () => {
      if (!disposed) setStatus('Reconectando áudio…');
    });
    room.on(RoomEvent.Reconnected, () => {
      if (!disposed) setStatus('Áudio conectado');
    });
    room.on(RoomEvent.Disconnected, () => {
      const wasConnected = connected.current;
      connected.current = false;
      if (!disposed) {
        setStatus('Áudio desconectado');
        setParticipants([]);
        setScreens([]);
        if (wasConnected) {
          setEnabled(false);
          if (privateCall)
            void api(`/calls/${privateCall.id}/end`, jsonOptions('POST', {})).catch(() => {});
        }
      }
    });
    void (async () => {
      try {
        microphone = await createLocalAudioTrack();
        if (disposed) {
          microphone.stop();
          return;
        }
        const grant = await api<{ url: string; token: string }>(
          `/channels/${channelId}/media-token`,
          jsonOptions('POST', privateCall ? { callId: privateCall.id } : {}),
        );
        if (disposed) {
          microphone.stop();
          return;
        }
        await room.connect(grant.url, grant.token);
        if (disposed) {
          await room.disconnect();
          return;
        }
        connected.current = true;
        await room.localParticipant.publishTrack(microphone);
        if (disposed) {
          await room.disconnect();
          return;
        }
        setStatus('Áudio conectado');
        refresh();
        try {
          await room.startAudio();
        } catch {
          setAudioBlocked(true);
        }
      } catch (error) {
        if (!disposed) {
          microphone?.stop();
          setError(error instanceof Error ? error.message : 'Não foi possível conectar ao áudio.');
          if (privateCall)
            void api(`/calls/${privateCall.id}/end`, jsonOptions('POST', {})).catch(() => {});
          setStatus('Falha no áudio');
          setEnabled(false);
          void room.disconnect();
        }
      }
    })();
    return () => {
      disposed = true;
      microphone?.stop();
      connected.current = false;
      void room.disconnect();
      roomRef.current = null;
      setParticipants([]);
      setScreens([]);
      setMuted(true);
      setSharing(false);
      setAudioBlocked(false);
      audio.current?.replaceChildren();
      void api(
        `/channels/${channelId}/media-leave`,
        jsonOptions('POST', privateCall ? { callId: privateCall.id } : {}),
      ).catch(() => {});
    };
  }, [roomKey, channelId]);
  async function action(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }
  async function startCall() {
    const response = await api<{ call: Call }>(
      `/channels/${channelId}/call`,
      jsonOptions('POST', { targetId: target }),
    );
    setCall(response.call);
    callRef.current = response.call;
  }
  async function endCall() {
    if (call) {
      await api(`/calls/${call.id}/end`, jsonOptions('POST', {}));
      setCall(null);
      callRef.current = null;
    }
    setEnabled(false);
  }
  const others = online.filter((p) => p.id !== user.id);
  return (
    <section className="media-panel" aria-label="Voz e chamadas">
      <div className="media-toolbar">
        <span>
          <Volume2 size={16} />
          <strong>Voz do canal</strong>
        </span>
        <span className="media-status" role="status">
          {status || (!configured ? 'Chamadas indisponíveis no momento' : 'Pronto para conversar')}
        </span>
        {!roomKey ? (
          <button
            className="secondary-button"
            disabled={!configured || busy || Boolean(call)}
            onClick={() => setEnabled(true)}
          >
            <Mic size={15} />
            Entrar na voz
          </button>
        ) : (
          <>
            <button
              className="media-control"
              disabled={busy || !connected.current}
              aria-label={muted ? 'Ativar microfone' : 'Silenciar microfone'}
              onClick={() =>
                void action(async () => {
                  await roomRef.current!.localParticipant.setMicrophoneEnabled(muted);
                  setMuted(!muted);
                })
              }
            >
              {muted ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
            <button
              className={`media-control ${sharing ? 'sharing' : ''}`}
              disabled={busy || !connected.current}
              onClick={() =>
                void action(async () => {
                  await roomRef.current!.localParticipant.setScreenShareEnabled(!sharing, {
                    audio: true,
                  });
                  setSharing(roomRef.current!.localParticipant.isScreenShareEnabled);
                })
              }
            >
              {<Monitor size={17} />} {sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
            </button>
            <button
              className="media-control hangup"
              onClick={() => void action(endCall)}
              disabled={busy}
            >
              <PhoneOff size={17} />
              Sair do áudio
            </button>
          </>
        )}
        {!call && (
          <div className="call-controls">
            <label className="sr-only" htmlFor="call-target">
              Pessoa para ligar
            </label>
            <select id="call-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Ligar para…</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="media-control"
              aria-label="Iniciar ligação"
              disabled={!configured || !others.some((p) => p.id === target) || busy}
              onClick={() => void action(startCall)}
            >
              <Phone size={16} />
            </button>
          </div>
        )}
      </div>
      {call && (
        <div className="call-banner" role="status">
          <Phone size={16} />
          <span>
            {call.state === 'active'
              ? `Em ligação com ${call.caller.id === user.id ? call.callee.name : call.caller.name}`
              : call.caller.id === user.id
                ? `Chamando ${call.callee.name}…`
                : `${call.caller.name} está ligando`}
          </span>
          {call.state === 'ringing' && call.callee.id === user.id && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api<{ call: Call }>(
                    `/calls/${call.id}/accept`,
                    jsonOptions('POST', {}),
                  );
                  setCall(result.call);
                  callRef.current = result.call;
                  setEnabled(false);
                })
              }
            >
              Aceitar ligação
            </button>
          )}
          <button
            className="media-control hangup"
            disabled={busy}
            onClick={() => void action(endCall)}
          >
            {call.state === 'active'
              ? 'Encerrar ligação'
              : call.caller.id === user.id
                ? 'Cancelar ligação'
                : 'Recusar ligação'}
          </button>
        </div>
      )}
      {participants.length > 0 && (
        <div className="voice-participants">
          {participants.map((p) => (
            <span key={p.id}>
              {p.muted ? <MicOff size={12} /> : <Mic size={12} />} {p.name}
            </span>
          ))}
        </div>
      )}
      {screens.length > 0 && (
        <div className="shared-screens">
          {screens.map((screen) => (
            <Screen key={screen.identity} screen={screen} />
          ))}
        </div>
      )}
      {error && (
        <div className="media-error" role="alert">
          {error}
        </div>
      )}
      {audioBlocked && (
        <div className="media-error" role="alert">
          Toque em Ativar áudio para ouvir a conversa.
          <button
            onClick={() =>
              void action(async () => {
                const room = roomRef.current;
                if (room) {
                  await room.startAudio();
                  setAudioBlocked(!room.canPlaybackAudio);
                }
              })
            }
          >
            Ativar áudio
          </button>
        </div>
      )}
      <div ref={audio} className="remote-audio" />
    </section>
  );
}
function Screen({ screen }: { screen: Screen }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element) screen.track.attach(element);
    return () => {
      if (element) screen.track.detach(element);
    };
  }, [screen.track]);
  return (
    <figure>
      <figcaption>
        <Monitor size={14} />
        {screen.name} está compartilhando
      </figcaption>
      <video ref={ref} autoPlay playsInline muted aria-label={`Tela de ${screen.name}`} />
    </figure>
  );
}
