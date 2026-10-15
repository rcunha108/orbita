import type { Category } from '../src/types.js';

export interface SeedCommunity {
  id: string;
  name: string;
  description: string;
  category: Category;
  tags: string[];
  members: number;
  online: number;
  accent: string;
  artwork: string;
  initials: string;
  verified: boolean;
}

export const communities: SeedCommunity[] = [
  {
    id: 'pixel',
    name: 'Pixel Playground',
    description:
      'Do primeiro pixel ao último boss. Um lugar para jogar junto e encontrar sua próxima aventura.',
    category: 'Games',
    tags: ['Minecraft', 'Indie', 'Multiplayer'],
    members: 24860,
    online: 1824,
    accent: '#bdccff',
    artwork: 'pixel',
    initials: 'PP',
    verified: true,
  },
  {
    id: 'dev',
    name: 'Dev sem fronteiras',
    description:
      'Código, café e boas ideias. Aprenda, compartilhe projetos e cresça com outros devs.',
    category: 'Tecnologia',
    tags: ['Programação', 'Open source', 'Carreira'],
    members: 18420,
    online: 936,
    accent: '#c8f078',
    artwork: 'terminal',
    initials: '</>',
    verified: true,
  },
  {
    id: 'studio',
    name: 'Estúdio Aberto',
    description:
      'Seu próximo projeto começa com uma conversa. Design, ilustração e inspiração sem limites.',
    category: 'Criatividade',
    tags: ['Design', 'Arte', 'Feedback'],
    members: 12750,
    online: 642,
    accent: '#ffb99c',
    artwork: 'studio',
    initials: 'EA',
    verified: true,
  },
  {
    id: 'lofi',
    name: 'Frequência Lo-fi',
    description:
      'Dê o play, encontre seu ritmo. Música boa e companhia para estudar, criar ou só ficar.',
    category: 'Música',
    tags: ['Lo-fi', 'Playlists', 'Produção'],
    members: 31680,
    online: 2348,
    accent: '#d3b9ff',
    artwork: 'music',
    initials: 'FL',
    verified: true,
  },
  {
    id: 'cosmos',
    name: 'Além da Órbita',
    description:
      'Perguntas grandes, descobertas maiores. Explore o universo com gente tão curiosa quanto você.',
    category: 'Educação',
    tags: ['Ciência', 'Astronomia', 'Espaço'],
    members: 9430,
    online: 417,
    accent: '#94d5eb',
    artwork: 'cosmos',
    initials: 'AO',
    verified: true,
  },
  {
    id: 'cozy',
    name: 'Clube do Intervalo',
    description: 'Desacelere um pouco. Livros, filmes, plantas e pequenas alegrias do dia a dia.',
    category: 'Lifestyle',
    tags: ['Livros', 'Cinema', 'Conversas'],
    members: 8260,
    online: 281,
    accent: '#f4d98f',
    artwork: 'cozy',
    initials: 'CI',
    verified: false,
  },
  {
    id: 'valorant',
    name: 'Próxima Partida',
    description:
      'Monte seu time, compartilhe os melhores momentos e encontre uma galera para subir de elo.',
    category: 'Games',
    tags: ['FPS', 'Valorant', 'Competitivo'],
    members: 15200,
    online: 1180,
    accent: '#ff9eaf',
    artwork: 'arena',
    initials: 'PC',
    verified: true,
  },
  {
    id: 'web',
    name: 'Web Lab',
    description:
      'Um laboratório de ideias para a web. JavaScript, acessibilidade e projetos que saem do papel.',
    category: 'Tecnologia',
    tags: ['JavaScript', 'React', 'Acessibilidade'],
    members: 6850,
    online: 390,
    accent: '#8ce2d0',
    artwork: 'web',
    initials: 'WL',
    verified: false,
  },
  {
    id: 'foto',
    name: 'Olhar Coletivo',
    description:
      'Encontre beleza no cotidiano. Compartilhe suas fotos e descubra novas formas de ver o mundo.',
    category: 'Criatividade',
    tags: ['Fotografia', 'Edição', 'Inspiração'],
    members: 7540,
    online: 260,
    accent: '#dfc0a4',
    artwork: 'photo',
    initials: 'OC',
    verified: false,
  },
  {
    id: 'idiomas',
    name: 'Mundo em Palavras',
    description:
      'Pratique um idioma, conheça uma cultura. Conversas que conectam pessoas de todo lugar.',
    category: 'Educação',
    tags: ['Idiomas', 'Inglês', 'Conversação'],
    members: 11470,
    online: 716,
    accent: '#b1cf9f',
    artwork: 'words',
    initials: 'MP',
    verified: true,
  },
  {
    id: 'som',
    name: 'Som de Garagem',
    description: 'Do primeiro acorde à sua próxima faixa. Um espaço para quem vive e faz música.',
    category: 'Música',
    tags: ['Instrumentos', 'Bandas', 'Composição'],
    members: 4320,
    online: 194,
    accent: '#e6a1bd',
    artwork: 'sound',
    initials: 'SG',
    verified: false,
  },
  {
    id: 'trilha',
    name: 'Pé na Trilha',
    description:
      'A próxima aventura está logo ali. Rotas, equipamentos e histórias para levar para fora.',
    category: 'Lifestyle',
    tags: ['Natureza', 'Trilhas', 'Viagens'],
    members: 5890,
    online: 243,
    accent: '#a6d8b8',
    artwork: 'outdoor',
    initials: 'PT',
    verified: false,
  },
];

export function seedChannels(community: SeedCommunity) {
  const specific: Record<string, string[]> = {
    pixel: ['minecraft', 'jogos-indie', 'encontre-seu-time'],
    dev: ['javascript', 'ajuda-com-código', 'mostre-seu-projeto'],
    studio: ['feedback-criativo', 'ilustração', 'design-de-interfaces'],
    lofi: ['playlists', 'produção-musical', 'sala-de-estudo'],
    cosmos: ['astronomia', 'descobertas', 'pergunte-à-ciência'],
    cozy: ['clube-do-livro', 'filmes-e-séries', 'plantinhas'],
    valorant: ['encontre-seu-time', 'dicas-e-estratégias', 'melhores-jogadas'],
    web: ['javascript', 'react', 'acessibilidade'],
    foto: ['suas-fotos', 'feedback-fotográfico', 'equipamentos'],
    idiomas: ['inglês', 'espanhol', 'troca-cultural'],
    som: ['composição', 'instrumentos', 'suas-músicas'],
    trilha: ['roteiros', 'equipamentos', 'fotos-da-trilha'],
  };
  return ['boas-vindas', 'geral', ...specific[community.id]].map((name, index) => ({
    id: `${community.id}-${index}`,
    communityId: community.id,
    name,
    description:
      index === 0
        ? `Comece por aqui: conheça a comunidade ${community.name} e suas boas práticas.`
        : index === 1
          ? `O ponto de encontro da comunidade ${community.name}.`
          : `Converse sobre ${name.replaceAll('-', ' ')} em ${community.name}.`,
    type: 'text' as const,
  }));
}
