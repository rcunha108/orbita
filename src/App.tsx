import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  ChevronRight,
  Code2,
  Compass,
  Gamepad2,
  GraduationCap,
  HelpCircle,
  Leaf,
  Palette,
  Plus,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { api } from './api';
import { useAuth } from './auth';
import { OrbitMark } from './components/Artwork';
import { CommunityCard } from './components/CommunityCard';
import { Discovery } from './components/Discovery';
import { CommunityView } from './components/CommunityView';
import { CATEGORIES, type Category, type Community } from './types';

const categoryIcons = [Compass, Gamepad2, Code2, Palette, AudioLines, GraduationCap, Leaf];
type Route = { view: 'discover' | 'joined' } | { view: 'community'; id: string; channel?: string };

function readRoute(): Route {
  const match = /^#community\/([a-z0-9-]+)(?:\/channel\/([a-z0-9-]+))?$/.exec(window.location.hash);
  if (match) return { view: 'community', id: match[1], channel: match[2] };
  return { view: window.location.hash === '#joined' ? 'joined' : 'discover' };
}

export default function App() {
  const { user, logout } = useAuth();
  const [route, setRoute] = useState<Route>(readRoute);
  const [memberships, setMemberships] = useState<Community[]>([]);
  const [membershipError, setMembershipError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [category, setCategory] = useState<Category>('Todos');
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api<Community[]>('/memberships', { signal: controller.signal })
      .then((items) => {
        setMemberships(items);
        setMembershipError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMembershipError(true);
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        window.location.hash = '#discover';
        if (searchInput.current) searchInput.current.focus();
        else setTimeout(() => searchInput.current?.focus(), 50);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    const update = () => setRefresh((value) => value + 1);
    window.addEventListener('orbita:memberships-changed', update);
    return () => window.removeEventListener('orbita:memberships-changed', update);
  }, []);

  function openCommunity(id: string, channel?: string) {
    window.location.hash = `#community/${id}${channel ? `/channel/${channel}` : ''}`;
  }
  function discover() {
    window.location.hash = '#discover';
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>
      <nav className="server-rail" aria-label="Comunidades">
        <button
          className="rail-brand"
          onClick={discover}
          aria-label="Órbita — início"
          title="Órbita"
        >
          <OrbitMark size={32} />
        </button>
        <span className="rail-divider" />
        <button
          className={`rail-button discovery-button ${route.view === 'discover' ? 'active' : ''}`}
          onClick={discover}
          aria-label="Descobrir comunidades"
          title="Descobrir comunidades"
        >
          <Compass size={24} />
        </button>
        <button
          className={`rail-button mobile-library ${route.view === 'joined' ? 'active' : ''}`}
          onClick={() => {
            window.location.hash = '#joined';
          }}
          aria-label="Minhas comunidades"
          title="Minhas comunidades"
        >
          <Users size={22} />
        </button>
        {memberships.map((community) => (
          <button
            key={community.id}
            className={`rail-button server-button ${route.view === 'community' && route.id === community.id ? 'active' : ''}`}
            style={{ '--server-accent': community.accent } as React.CSSProperties}
            onClick={() => openCommunity(community.id)}
            aria-label={`Abrir ${community.name}`}
            title={community.name}
          >
            {community.initials}
          </button>
        ))}
        <button
          className="rail-button add-community"
          onClick={() => {
            setCategory('Todos');
            discover();
          }}
          aria-label="Encontrar mais comunidades"
          title="Encontrar mais comunidades"
        >
          <Plus size={23} />
        </button>
        <span className="rail-spacer" />
        <button
          className="rail-help"
          onClick={() =>
            void logout().catch(() => alert('Não foi possível sair. Tente novamente.'))
          }
          aria-label="Sair da conta"
          title="Sair da conta"
        >
          Sair
        </button>
        <button
          className="rail-help"
          onClick={() => dialog.current?.showModal()}
          aria-label="Sobre o Órbita"
          title="Sobre o Órbita"
        >
          <HelpCircle size={21} />
        </button>
      </nav>

      {route.view !== 'community' && (
        <aside className="discovery-sidebar" aria-label="Navegação principal">
          <a className="wordmark" href="#discover">
            órbita
          </a>
          <div className="sidebar-heading">SEU UNIVERSO, MAIS PERTO</div>
          <button
            className={`sidebar-link ${route.view === 'discover' ? 'active' : ''}`}
            onClick={discover}
          >
            <Compass size={19} />
            Descobrir
            <ChevronRight size={15} />
          </button>
          <button
            className={`sidebar-link ${route.view === 'joined' ? 'active' : ''}`}
            onClick={() => {
              window.location.hash = '#joined';
            }}
          >
            <Users size={19} />
            Minhas comunidades<span className="small-count">{memberships.length}</span>
          </button>
          <div className="sidebar-rule" />
          <div className="sidebar-heading category-heading">EXPLORE SEUS INTERESSES</div>
          {CATEGORIES.map((name, index) => {
            const Icon = categoryIcons[index];
            return (
              <button
                key={name}
                className={`category-link ${route.view === 'discover' && category === name ? 'selected' : ''}`}
                onClick={() => {
                  setCategory(name);
                  discover();
                }}
              >
                <Icon size={18} />
                {name === 'Todos' ? 'Todas as categorias' : name}
                {name === 'Todos' && <span className="category-dot" />}
              </button>
            );
          })}
          <div className="sidebar-note">
            <span className="note-stars">
              ✧ <Sparkles size={18} />
            </span>
            <h3>Melhor quando é junto.</h3>
            <p>Há uma comunidade esperando pelo que só você tem.</p>
            <button onClick={() => dialog.current?.showModal()}>
              Conheça o Órbita <ArrowRight size={14} />
            </button>
          </div>
          <div className="profile">
            <div className="profile-avatar">
              VC
              <i />
            </div>
            <div>
              <strong>{user.name}</strong>
              <span>Conta conectada</span>
            </div>
            <button onClick={() => dialog.current?.showModal()} aria-label="Informações do perfil">
              <HelpCircle size={17} />
            </button>
          </div>
        </aside>
      )}

      <main
        id="main-content"
        className={route.view === 'community' ? 'main-area is-community' : 'main-area'}
      >
        {route.view === 'community' ? (
          <CommunityView
            key={`${route.id}:${route.channel ?? ''}`}
            id={route.id}
            initialChannel={route.channel}
            back={discover}
            membershipChanged={() => setRefresh((value) => value + 1)}
          />
        ) : (
          <>
            <header className="topbar">
              <div>
                <Compass size={20} />
                <span>{route.view === 'discover' ? 'Descobrir' : 'Minhas comunidades'}</span>
                <span className="topbar-separator">/</span>
                <span className="topbar-subtitle">Encontre sua turma</span>
              </div>
              <div className="topbar-right">
                <span className="demo-indicator">
                  <i />
                  DEMONSTRAÇÃO
                </span>
                <button onClick={() => dialog.current?.showModal()} aria-label="Ajuda">
                  <HelpCircle size={18} />
                </button>
              </div>
            </header>
            {route.view === 'discover' ? (
              <Discovery
                category={category}
                setCategory={setCategory}
                open={openCommunity}
                refresh={refresh}
                searchInput={searchInput}
              />
            ) : (
              <section className="page-content joined-page">
                <span className="eyebrow">AS SUAS CONEXÕES</span>
                <h1>Seu canto no universo.</h1>
                <p className="section-description">Continue de onde a conversa parou.</p>
                {membershipError ? (
                  <div className="empty-state" role="alert">
                    <p>Não foi possível carregar suas comunidades.</p>
                    <button
                      className="primary-button"
                      onClick={() => setRefresh((value) => value + 1)}
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : memberships.length ? (
                  <div className="community-grid">
                    {memberships.map((c) => (
                      <CommunityCard key={c.id} community={c} open={openCommunity} />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Users size={38} />
                    <h2>Sua próxima conexão está lá fora.</h2>
                    <p>Explore as comunidades e entre nas que combinam com você.</p>
                    <button className="primary-button" onClick={discover}>
                      Descobrir comunidades <ArrowRight size={16} />
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <dialog
        ref={dialog}
        className="about-dialog"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <button
          className="dialog-close"
          onClick={() => dialog.current?.close()}
          aria-label="Fechar informações"
        >
          <X size={20} />
        </button>
        <span className="about-logo">
          <OrbitMark size={36} />
        </span>
        <span className="eyebrow">UM NOVO LUGAR PARA SE CONECTAR</span>
        <h2>Bem-vindo ao Órbita.</h2>
        <p>Explore comunidades, encontre canais sobre seus interesses e faça parte da conversa.</p>
        <div className="about-detail">
          <BookOpen size={20} />
          <div>
            <strong>Um projeto independente</strong>
            <p>
              Comunidades e membros são exemplos fictícios. Participações e mensagens ficam salvas
              neste servidor. Contas individuais e chat em tempo real estão disponíveis. Não há
              vínculo com o Discord.
            </p>
          </div>
        </div>
        <div className="about-detail">
          <Search size={20} />
          <div>
            <strong>Busque do seu jeito</strong>
            <p>
              Digite um nome, assunto ou tag. A busca ignora acentos, aceita o início de palavras e
              combina todas as palavras digitadas. Use as abas para encontrar servidores ou canais.
            </p>
          </div>
        </div>
        <button className="primary-button" onClick={() => dialog.current?.close()}>
          Vamos explorar <ArrowRight size={16} />
        </button>
      </dialog>
    </div>
  );
}
