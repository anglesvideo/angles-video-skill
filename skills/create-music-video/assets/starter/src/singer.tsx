// What is drawn on the singer. The singer is still pictures; these are what
// move, and each is given the point of the frame it is pinned to: a voice at
// the microphone, a halo, rings round the eyes. Use the ones the singer has.
import React from 'react';
import { CYAN, H, RGB, W, WHITE, frac, mix, rgba } from './rig';
import { Point } from './shots';
import { face } from './type';

/** The voice: rings leaving the microphone, two to a beat, as loud as the singing is. */
export const Voice: React.FC<{ at: Point; size: number; p: number; level: number }> = ({ at, size, p, level }) =>
  level < 0.03 ? null : (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen', overflow: 'visible' }}>
      {[0, 1, 2].map(i => {
        const out = frac(p * 2 + i / 3);
        return <circle key={i} cx={at[0]} cy={at[1]} r={size * (0.5 + out * 2.6)} fill="none" stroke={rgba(mix(CYAN, WHITE, 0.4), level * (1 - out) * 0.9)} strokeWidth={Math.max(1.5, size * 0.12 * (1 - out) + 1)} />;
      })}
      <circle cx={at[0]} cy={at[1]} r={size * 0.42} fill={rgba(WHITE, 0.5 * level)} />
    </svg>
  );

/** A halo, lit: it glows with the kick and throws off a ring on every beat. */
export const Halo: React.FC<{ at: Point; rx: number; ry: number; tilt: number; p: number; K: number; color: RGB }> = ({ at, rx, ry, tilt, p, K, color }) => {
  const out = frac(p);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen', overflow: 'visible' }}>
      <g transform={`rotate(${tilt} ${at[0]} ${at[1]})`}>
        <ellipse cx={at[0]} cy={at[1]} rx={rx} ry={ry} fill="none" stroke={rgba(mix(color, WHITE, 0.5), 0.3 + 0.6 * K)} strokeWidth={Math.max(3, rx * 0.09)} />
        <ellipse cx={at[0]} cy={at[1]} rx={rx * (1 + out * 1.1)} ry={ry * (1 + out * 1.1)} fill="none" stroke={rgba(color, (1 - out) * 0.75)} strokeWidth={Math.max(1.5, rx * 0.04)} />
        <ellipse cx={at[0]} cy={at[1]} rx={rx * 1.32} ry={ry * 1.32} fill="none" stroke={rgba(WHITE, 0.55)} strokeWidth={Math.max(1.2, rx * 0.02)} strokeDasharray={`${rx * 0.22} ${rx * 0.3}`} strokeDashoffset={-p * rx * 0.5} />
      </g>
    </svg>
  );
};

/** For a singer who is a machine: rings turning round each iris, locking on when the shot arrives. */
export const Irises: React.FC<{ eyes: [Point, Point]; iris: number; p: number; since: number; color: RGB }> = ({ eyes, iris, p, since, color }) => {
  const lock = 1 + 0.7 * Math.exp(-since * 5);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen', overflow: 'visible' }}>
      {eyes.map((eye, i) => {
        const r = iris * lock;
        const turn = p * 45 * (i ? -1 : 1);
        return (
          <g key={i}>
            <circle cx={eye[0]} cy={eye[1]} r={r * 1.5} fill="none" stroke={rgba(mix(color, WHITE, 0.3), 0.9)} strokeWidth={Math.max(1.5, iris * 0.07)} strokeDasharray={`${r * 1.5} ${r * 0.86}`} transform={`rotate(${turn} ${eye[0]} ${eye[1]})`} />
            <circle cx={eye[0]} cy={eye[1]} r={r * 1.92} fill="none" stroke={rgba(WHITE, 0.6)} strokeWidth={Math.max(1, iris * 0.035)} strokeDasharray={`${r * 0.1} ${r * 0.2}`} transform={`rotate(${-turn * 0.6} ${eye[0]} ${eye[1]})`} />
            {[0, 90, 180, 270].map(a => (
              <line key={a} x1={eye[0] + r * 2.15} y1={eye[1]} x2={eye[0] + r * 2.5} y2={eye[1]} stroke={rgba(WHITE, 0.8)} strokeWidth={Math.max(1.5, iris * 0.05)} transform={`rotate(${a + 45} ${eye[0]} ${eye[1]})`} />
            ))}
          </g>
        );
      })}
      {iris > 26 && (
        <text x={eyes[1][0] + iris * 2.7} y={eyes[1][1] - iris * 1.9} fill={rgba(WHITE, 0.85)} fontFamily={face.mono} fontSize={Math.max(18, iris * 0.42)} letterSpacing={2}>
          {`LOCK ${Math.min(100, Math.round(since * 220))}%`}
        </text>
      )}
    </svg>
  );
};
