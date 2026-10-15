import { Orbit } from 'lucide-react';

export function OrbitMark({ size = 28 }: { size?: number }) {
  return <Orbit size={size} strokeWidth={1.8} aria-hidden="true" />;
}

/** Original CSS/SVG artwork: no remote images, fonts, or copied Discord assets. */
export function Artwork({ kind, compact = false }: { kind: string; compact?: boolean }) {
  return (
    <div className={`artwork artwork-${kind} ${compact ? 'compact' : ''}`} aria-hidden="true">
      <div className="art-grid" />
      {kind === 'pixel' || kind === 'arena' ? (
        <>
          <div className="pixel-platform platform-one" />
          <div className="pixel-platform platform-two" />
          <div className="pixel-platform platform-three" />
          <div className="pixel-sun" />
          <div className="pixel-spark spark-one">✧</div>
          <div className="pixel-spark spark-two">+</div>
        </>
      ) : kind === 'terminal' || kind === 'web' ? (
        <>
          <div className="code-window">
            <div className="window-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="code-line">
              <em>const</em> next = {'{'}
            </div>
            <div className="code-line indent">
              ideas: <span>Infinity</span>,
            </div>
            <div className="code-line indent">
              together: <span>true</span>
            </div>
            <div className="code-line">
              {'}'}
              <b>_</b>
            </div>
          </div>
          <div className="code-symbol">{'</>'}</div>
        </>
      ) : kind === 'studio' || kind === 'photo' ? (
        <>
          <div className="studio-circle" />
          <div className="studio-square" />
          <div className="studio-arch" />
          <div className="studio-dot" />
        </>
      ) : kind === 'music' || kind === 'sound' ? (
        <>
          <div className="record">
            <div />
            <i />
          </div>
          <div className="music-note">♪</div>
          <div className="music-bars">
            {Array.from({ length: 11 }, (_, i) => (
              <i key={i} style={{ height: `${14 + ((i * 17) % 48)}px` }} />
            ))}
          </div>
        </>
      ) : kind === 'cosmos' ? (
        <>
          <div className="space-stars">
            ✦<span>·</span>✧<span>✦</span>·
          </div>
          <div className="planet">
            <div />
          </div>
          <div className="planet-moon" />
        </>
      ) : kind === 'outdoor' ? (
        <>
          <div className="mountain mountain-one" />
          <div className="mountain mountain-two" />
          <div className="outdoor-sun" />
        </>
      ) : (
        <>
          <div className="cozy-book">
            <span>
              um mundo
              <br />
              de ideias.
            </span>
          </div>
          <div className="cozy-cup" />
          <div className="cozy-leaf" />
        </>
      )}
    </div>
  );
}
