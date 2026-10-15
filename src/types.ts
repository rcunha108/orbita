export const CATEGORIES = [
  'Todos',
  'Games',
  'Tecnologia',
  'Criatividade',
  'Música',
  'Educação',
  'Lifestyle',
] as const;
export type Category = (typeof CATEGORIES)[number];
export type Scope = 'communities' | 'channels';
export type Sort = 'recommended' | 'members' | 'newest';

export interface Community {
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
  joined: boolean;
}

export interface Channel {
  id: string;
  communityId: string;
  name: string;
  description: string;
  type: 'text' | 'voice';
}

export interface ChannelResult extends Channel {
  communityName: string;
  category: Category;
  accent: string;
  members: number;
}

export interface DiscoveryResult {
  items: Community[] | ChannelResult[];
  total: number;
  page: number;
  pageSize: number;
  categories: { name: Category; count: number }[];
}

export interface User {
  id: string;
  name: string;
}

export interface Message {
  authorId: string;
  id: number;
  author: string;
  initials: string;
  color: string;
  body: string;
  createdAt: string;
  own: boolean;
}

export interface MessagesResult {
  items: Message[];
  hasMore: boolean;
}

export interface Call {
  id: string;
  channelId: string;
  caller: User;
  callee: User;
  state: 'ringing' | 'active';
  expiresAt: number;
}
