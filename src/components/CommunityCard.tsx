import { ArrowUpRight, BadgeCheck, Hash, Users } from 'lucide-react';
import type { ChannelResult, Community } from '../types';
import { Artwork } from './Artwork';

export const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value);

export function CommunityCard({
  community,
  open,
}: {
  community: Community;
  open: (id: string) => void;
}) {
  return (
    <button
      className="community-card"
      onClick={() => open(community.id)}
      aria-label={`Explorar ${community.name}`}
    >
      <div className="card-art">
        <Artwork kind={community.artwork} />
        <span className="category-label">{community.category}</span>
        <span className="card-arrow">
          <ArrowUpRight size={18} />
        </span>
      </div>
      <div className="card-body">
        <span className="community-avatar" style={{ background: community.accent }}>
          {community.initials}
        </span>
        <div className="card-title">
          <h3>{community.name}</h3>
          {community.verified && (
            <BadgeCheck size={17} className="verified" aria-label="Comunidade em destaque" />
          )}
        </div>
        <p>{community.description}</p>
        <div className="tags">
          {community.tags.slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <div className="card-stats">
          <span>
            <i className="online-dot" />
            {formatNumber(community.online)} online
          </span>
          <span>
            <Users size={13} />
            {formatNumber(community.members)} membros
          </span>
          {community.joined && <span className="joined-badge">Participando</span>}
        </div>
      </div>
    </button>
  );
}

export function ChannelCard({
  channel,
  open,
}: {
  channel: ChannelResult;
  open: (communityId: string, channelId: string) => void;
}) {
  return (
    <button
      className="channel-card"
      onClick={() => open(channel.communityId, channel.id)}
      aria-label={`Abrir canal ${channel.name} em ${channel.communityName}`}
    >
      <span className="channel-symbol" style={{ color: channel.accent }}>
        <Hash size={30} />
      </span>
      <div>
        <span className="channel-community">
          {channel.communityName} <span>· {channel.category}</span>
        </span>
        <h3>{channel.name}</h3>
        <p>{channel.description}</p>
        <span className="channel-members">
          <Users size={13} />
          {formatNumber(channel.members)} membros na comunidade
        </span>
      </div>
      <ArrowUpRight size={18} className="channel-arrow" />
    </button>
  );
}
