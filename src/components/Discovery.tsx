import { useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Gamepad2,
  Code2,
  Palette,
  AudioLines,
  GraduationCap,
  Leaf,
  Hash,
  HelpCircle,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { OrbitMark } from './Artwork';
import { ChannelCard, CommunityCard } from './CommunityCard';
import { useDiscovery } from '../hooks/useDiscovery';
import {
  CATEGORIES,
  type Category,
  type ChannelResult,
  type Community,
  type Scope,
  type Sort,
} from '../types';
const categoryIcons = [Compass, Gamepad2, Code2, Palette, AudioLines, GraduationCap, Leaf];

export function Discovery({
  category,
  setCategory,
  open,
  refresh,
  searchInput,
}: {
  category: Category;
  setCategory: (value: Category) => void;
  open: (id: string, channel?: string) => void;
  refresh: number;
  searchInput: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('communities');
  const [sort, setSort] = useState<Sort>('recommended');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  // A changed filter must never issue a request with an obsolete page number.
  const filterKey = `${query}\0${scope}\0${category}\0${sort}`;
  const [pageFilter, setPageFilter] = useState(filterKey);
  const effectivePage = pageFilter === filterKey ? page : 1;
  if (pageFilter !== filterKey) {
    setPageFilter(filterKey);
    setPage(1);
  }
  const { data, loading, error } = useDiscovery(
    query,
    scope,
    category,
    sort,
    effectivePage,
    refresh + retry,
  );
  const resultsTop = useRef<HTMLDivElement>(null);

  function goToPage(next: number) {
    setPageFilter(filterKey);
    setPage(next);
    resultsTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function resetFilters() {
    setQuery('');
    setCategory('Todos');
    setSort('recommended');
  }
  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div className="page-content">
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-badge">
            <Sparkles size={13} /> CONEXÕES FORA DO ÓBVIO
          </span>
          <h1>
            O próximo papo
            <br />
            começa <span>por aqui.</span>
          </h1>
          <p>
            Encontre pessoas que compartilham suas ideias.
            <br className="desktop-break" /> E descubra um universo de novas possibilidades.
          </p>
          <div className="hero-social">
            <div className="tiny-avatars">
              <span>☺</span>
              <span>✿</span>
              <span>✦</span>
              <span>☻</span>
            </div>
            <span>
              Seu próximo lugar favorito está aqui <span>↗</span>
            </span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hero-planet">
            <span>✳</span>
          </div>
          <div className="mini-planet" />
          <span className="hero-star star-one">✦</span>
          <span className="hero-star star-two">✧</span>
          <span className="hero-star star-three">+</span>
          <div className="floating-tag tag-one">
            <Gamepad2 size={16} />
            mais uma partida?
          </div>
          <div className="floating-tag tag-two">
            <span>✺</span> ideias que conectam
          </div>
        </div>
      </section>

      <section
        className="discovery-section"
        aria-label="Descobrir comunidades e canais"
        ref={resultsTop}
      >
        <div className="section-heading">
          <div>
            <h2>
              Encontre sua comunidade<span>.</span>
            </h2>
            <p>Um interesse em comum. Mil conversas possíveis.</p>
          </div>
          <span className="section-mark">
            <OrbitMark size={23} />
          </span>
        </div>
        <form className="search-box" onSubmit={(event) => event.preventDefault()} role="search">
          <Search size={21} />
          <label htmlFor="discovery-search" className="sr-only">
            Buscar comunidades e canais
          </label>
          <input
            ref={searchInput}
            id="discovery-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
            placeholder="Explore comunidades, assuntos ou interesses…"
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                searchInput.current?.focus();
              }}
              aria-label="Limpar busca"
            >
              <X size={18} />
            </button>
          ) : (
            <kbd>Ctrl K</kbd>
          )}
        </form>
        <div className="category-pills" aria-label="Filtrar por categoria">
          {CATEGORIES.map((name, i) => {
            const Icon = categoryIcons[i];
            return (
              <button
                key={name}
                className={category === name ? 'active' : ''}
                onClick={() => setCategory(name)}
                aria-pressed={category === name}
              >
                <Icon size={15} />
                {name}
                {data && <span>{data.categories.find((c) => c.name === name)?.count ?? 0}</span>}
              </button>
            );
          })}
        </div>
        <div className="results-toolbar">
          <div className="scope-tabs" role="group" aria-label="Tipo de resultado">
            <button
              className={scope === 'communities' ? 'active' : ''}
              onClick={() => setScope('communities')}
              aria-pressed={scope === 'communities'}
            >
              <Users size={16} />
              Servidores
            </button>
            <button
              className={scope === 'channels' ? 'active' : ''}
              onClick={() => setScope('channels')}
              aria-pressed={scope === 'channels'}
            >
              <Hash size={16} />
              Canais
            </button>
          </div>
          <div className="sort-control">
            <ArrowDownWideNarrow size={15} />
            <label htmlFor="sort" className="sr-only">
              Ordenar resultados
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="recommended">Recomendados</option>
              <option value="members">Mais membros</option>
              <option value="newest">Adicionados recentemente</option>
            </select>
          </div>
        </div>
        <div className="results-caption" role="status" aria-live="polite">
          {loading ? (
            'Buscando conexões…'
          ) : error ? (
            'Não foi possível carregar os resultados.'
          ) : (
            <>
              {data?.total ?? 0} {scope === 'communities' ? 'comunidades' : 'canais'}{' '}
              {query ? (
                <>
                  para <strong>“{query}”</strong>
                </>
              ) : category === 'Todos' ? (
                'para você explorar'
              ) : (
                <>
                  em <strong>{category}</strong>
                </>
              )}
            </>
          )}
          {!loading && !error && (
            <span>
              <Check size={12} /> Dados de demonstração
            </span>
          )}
        </div>
        {loading ? (
          <div className="community-grid loading-grid" aria-label="Carregando resultados">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="card-skeleton" key={i}>
                <div />
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="empty-state" role="alert">
            <HelpCircle size={36} />
            <h3>Perdemos a conexão por um instante.</h3>
            <p>{error}</p>
            <button className="primary-button" onClick={() => setRetry((value) => value + 1)}>
              Tentar novamente
            </button>
          </div>
        ) : data?.items.length ? (
          <div className={scope === 'communities' ? 'community-grid' : 'channel-grid'}>
            {scope === 'communities'
              ? (data.items as Community[]).map((community) => (
                  <CommunityCard key={community.id} community={community} open={open} />
                ))
              : (data.items as ChannelResult[]).map((channel) => (
                  <ChannelCard key={channel.id} channel={channel} open={open} />
                ))}
          </div>
        ) : (
          <div className="empty-state">
            <Search size={38} />
            <h3>Ainda não encontramos essa órbita.</h3>
            <p>Tente outro termo ou amplie as categorias. Uma nova conexão pode estar bem perto.</p>
            <button className="secondary-button" onClick={resetFilters}>
              Limpar busca e filtros
            </button>
          </div>
        )}
        {data && totalPages > 1 && (
          <nav className="pagination" aria-label="Páginas de resultados">
            <button
              onClick={() => goToPage(effectivePage - 1)}
              disabled={effectivePage === 1}
              aria-label="Página anterior"
            >
              <ArrowLeft size={16} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((number) => (
              <button
                key={number}
                onClick={() => goToPage(number)}
                className={number === effectivePage ? 'active' : ''}
                aria-current={number === effectivePage ? 'page' : undefined}
              >
                {number}
              </button>
            ))}
            <button
              onClick={() => goToPage(effectivePage + 1)}
              disabled={effectivePage === totalPages}
              aria-label="Próxima página"
            >
              <ArrowRight size={16} />
            </button>
          </nav>
        )}
      </section>
      <footer className="page-footer">
        <span>
          <OrbitMark size={16} />
          Feito para encontrar o seu lugar.
        </span>
        <span>
          ÓRBITA <i /> CONEXÕES HUMANAS
        </span>
      </footer>
    </div>
  );
}
