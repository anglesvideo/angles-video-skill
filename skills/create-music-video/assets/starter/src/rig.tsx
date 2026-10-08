// The stage and everything that lights it. Nothing here knows about a song:
// each fixture is told, frame by frame, where to point and how bright to be.
// What tells it is the video's own cue sheet.
import React from 'react';
import { AbsoluteFill, random } from 'remotion';

export const W = 1920;
export const H = 1080;

export type RGB = [number, number, number];
export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export const INK: RGB = [4, 5, 12];
export const WHITE: RGB = [255, 255, 255];
export const ICE: RGB = [200, 222, 255];
export const BLUE: RGB = [84, 128, 255];
export const CYAN: RGB = [52, 229, 255];
export const MAGENTA: RGB = [255, 61, 242];
export const VIOLET: RGB = [128, 92, 255];
export const GOLD: RGB = [255, 206, 74];
export const MINT: RGB = [90, 255, 176];

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)].map(Math.round) as RGB;
export const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
/** 0 before `a`, 1 after `b`, a straight line between. */
export const span = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
/** The part of a number after the point: how far through the beat it is. */
export const frac = (v: number) => v - Math.floor(v);
/** 1 at `from`, dying away after it; 0 before. `rate` is how fast, per beat. */
export const hit = (v: number, from: number, rate = 2) => (v < from ? 0 : Math.exp(-(v - from) * rate));

// -- Fixtures ------------------------------------------------------------------

export type Beam = {
  x: number;
  y: number;
  /** Degrees from straight down, clockwise leaning right; 180 points straight up. */
  angle: number;
  level: number;
  color: RGB;
  /** Half-angle of the cone, in degrees. */
  spread?: number;
  length?: number;
};

/** Where a head has to point to land on a spot. */
export const aim = (x: number, y: number, toX: number, toY: number) => (Math.atan2(toX - x, toY - y) * 180) / Math.PI;

/**
 * Moving heads. Each beam is a cone that fades along its length, drawn twice:
 * wide and blurred for the light in the haze, thin and sharp for its core.
 * All of them share one blur, which is what keeps a frame cheap to draw.
 */
export const Beams: React.FC<{ id: string; beams: Beam[] }> = ({ id, beams }) => {
  const lit = beams.map((beam, index) => ({ beam, index })).filter(({ beam }) => beam.level > 0.01);
  const shape = (beam: Beam, widen: number) => {
    const a = (beam.angle * Math.PI) / 180;
    const length = beam.length ?? 1250;
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    const nx = dy;
    const ny = -dx;
    const near = 7 * widen;
    const far = near + length * Math.tan((((beam.spread ?? 2.8) * widen) * Math.PI) / 180);
    const ex = beam.x + dx * length;
    const ey = beam.y + dy * length;
    return {
      ex,
      ey,
      points: `${beam.x + nx * near},${beam.y + ny * near} ${beam.x - nx * near},${beam.y - ny * near} ${ex - nx * far},${ey - ny * far} ${ex + nx * far},${ey + ny * far}`,
    };
  };
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}>
      <defs>
        <filter id={`${id}-haze`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        {lit.map(({ beam, index }) => {
          const { ex, ey } = shape(beam, 1);
          return (
            <linearGradient key={index} id={`${id}-${index}`} gradientUnits="userSpaceOnUse" x1={beam.x} y1={beam.y} x2={ex} y2={ey}>
              <stop offset="0" stopColor={rgba(beam.color, 1)} stopOpacity={0.9 * beam.level} />
              <stop offset="0.5" stopColor={rgba(beam.color, 1)} stopOpacity={0.34 * beam.level} />
              <stop offset="1" stopColor={rgba(beam.color, 1)} stopOpacity="0" />
            </linearGradient>
          );
        })}
      </defs>
      <g filter={`url(#${id}-haze)`}>
        {lit.map(({ beam, index }) => (
          <React.Fragment key={index}>
            <polygon points={shape(beam, 1).points} fill={`url(#${id}-${index})`} />
            <circle cx={beam.x} cy={beam.y} r={34} fill={rgba(beam.color, 0.55 * beam.level)} />
          </React.Fragment>
        ))}
      </g>
      {lit.map(({ beam, index }) => (
        <React.Fragment key={index}>
          <polygon points={shape(beam, 0.22).points} fill={`url(#${id}-${index})`} opacity={0.75} />
          <circle cx={beam.x} cy={beam.y} r={9} fill={rgba(mix(beam.color, WHITE, 0.7), beam.level)} />
        </React.Fragment>
      ))}
    </svg>
  );
};

/** Colour thrown across the whole room: two sides and the floor. */
export const Wash: React.FC<{ a: RGB; b: RGB; level: number }> = ({ a, b, level }) => (
  <AbsoluteFill
    style={{
      background: [
        `radial-gradient(1300px 820px at 14% 12%, ${rgba(a, 0.6 * level)}, transparent 70%)`,
        `radial-gradient(1300px 820px at 86% 12%, ${rgba(b, 0.6 * level)}, transparent 70%)`,
        `radial-gradient(1500px 460px at 50% 80%, ${rgba(mix(a, b, 0.5), 0.42 * level)}, transparent 72%)`,
      ].join(','),
      mixBlendMode: 'screen',
    }}
  />
);

/** Haze drifting through the room. It is what makes a beam visible at all. */
export const Haze: React.FC<{ frame: number; tint: RGB; level: number }> = ({ frame, tint, level }) => (
  <AbsoluteFill style={{ mixBlendMode: 'screen' }}>
    {[0, 1, 2, 3].map(i => {
      const drift = frame * (0.5 + i * 0.22) * (i % 2 ? -1 : 1);
      const x = ((i * 610 + drift) % (W + 900)) - 450;
      const y = 180 + i * 150 + 40 * Math.sin(frame / 50 + i * 2);
      return (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: x - 520,
            top: y - 220,
            width: 1040,
            height: 440,
            background: `radial-gradient(closest-side, ${rgba(mix(tint, WHITE, 0.4), 0.16 * level)}, transparent)`,
          }}
        />
      );
    })}
  </AbsoluteFill>
);

/** Lasers: thin, hard, and fanned from one point. */
export const Lasers: React.FC<{ x: number; y: number; angles: number[]; color: RGB; level: number }> = ({ x, y, angles, color, level }) => {
  if (level < 0.02) return null;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}>
      {angles.map((angle, i) => {
        const a = (angle * Math.PI) / 180;
        const ex = x + Math.sin(a) * 1900;
        const ey = y + Math.cos(a) * 1900;
        return (
          <React.Fragment key={i}>
            <line x1={x} y1={y} x2={ex} y2={ey} stroke={rgba(color, 0.22 * level)} strokeWidth={9} />
            <line x1={x} y1={y} x2={ex} y2={ey} stroke={rgba(mix(color, WHITE, 0.5), 0.9 * level)} strokeWidth={2.4} />
          </React.Fragment>
        );
      })}
    </svg>
  );
};

/** A burst of sparks thrown up from one point, falling back under their own weight. */
export const Sparks: React.FC<{ frame: number; from: number; x: number; y: number; seed: string; color: RGB; count?: number; power?: number; fps: number }> = ({ frame, from, x, y, seed, color, count = 56, power = 1150, fps }) => {
  const t = (frame - from) / fps;
  if (t < 0 || t > 1.5) return null;
  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen' }}>
      {Array.from({ length: count }, (_, i) => {
        const angle = ((-90 + (random(`${seed}-a-${i}`) - 0.5) * 46) * Math.PI) / 180;
        const speed = power * (0.45 + random(`${seed}-v-${i}`) * 0.55);
        const life = 0.6 + random(`${seed}-l-${i}`) * 0.9;
        const alpha = clamp(1 - t / life);
        if (alpha <= 0) return null;
        const size = 3 + random(`${seed}-s-${i}`) * 5;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x + Math.cos(angle) * speed * t - size / 2,
              top: y + Math.sin(angle) * speed * t + 620 * t * t - size / 2,
              width: size,
              height: size * 2.2,
              borderRadius: size,
              background: rgba(mix(color, WHITE, 0.6), alpha),
              boxShadow: `0 0 ${10 * alpha + 4}px ${rgba(color, alpha)}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0"/></filter><rect width="260" height="260" filter="url(#n)"/></svg>'
)}")`;

/** Film grain. It breaks up the bands a soft gradient turns into once a platform recompresses it. */
export const Grain: React.FC<{ frame: number }> = ({ frame }) => (
  <AbsoluteFill
    style={{
      backgroundImage: GRAIN,
      backgroundPosition: `${Math.round(random(`grain-x-${frame}`) * 260)}px ${Math.round(random(`grain-y-${frame}`) * 260)}px`,
      opacity: 0.09,
      mixBlendMode: 'overlay',
    }}
  />
);

/** Every lamp on at once, straight at the audience. One per song, or it stops meaning anything. */
export const Blinder: React.FC<{ level: number; color?: RGB }> = ({ level, color = WHITE }) =>
  level < 0.01 ? null : <AbsoluteFill style={{ background: rgba(color, level) }} />;

/**
 * Speed lines: thin wedges flying out from a point, the way a drawn frame
 * shows an impact. `inner` is how far from the point they start, so that what
 * is at the centre stays clear.
 */
export const Burst: React.FC<{ x: number; y: number; level: number; seed: string; color?: RGB; inner?: number; count?: number }> = ({ x, y, level, seed, color = WHITE, inner = 380, count = 54 }) => {
  if (level < 0.02) return null;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}>
      {Array.from({ length: count }, (_, i) => {
        const angle = ((i + random(`${seed}-a-${i}`)) / count) * Math.PI * 2;
        const half = ((0.25 + random(`${seed}-w-${i}`) * 0.75) * Math.PI) / 180;
        const near = inner * (0.75 + random(`${seed}-n-${i}`) * 0.7);
        const far = 1500;
        const at = (a: number, r: number) => `${x + Math.cos(a) * r},${y + Math.sin(a) * r}`;
        return <polygon key={i} points={`${at(angle, near)} ${at(angle - half, far)} ${at(angle + half, far)}`} fill={rgba(mix(color, WHITE, 0.5), level * (0.25 + random(`${seed}-o-${i}`) * 0.75))} />;
      })}
    </svg>
  );
};

/** Paper falling through the lights: each piece turns as it drops and drifts from side to side. */
export const Confetti: React.FC<{ frame: number; fps: number; level: number; colors: RGB[]; count?: number }> = ({ frame, fps, level, colors, count = 90 }) => {
  if (level < 0.02) return null;
  const t = frame / fps;
  return (
    <AbsoluteFill>
      {Array.from({ length: count }, (_, i) => {
        const speed = 240 + random(`paper-v-${i}`) * 300;
        const y = ((t * speed + random(`paper-y-${i}`) * (H + 240)) % (H + 240)) - 120;
        const x = random(`paper-x-${i}`) * W + 46 * Math.sin(t * (1.2 + random(`paper-s-${i}`) * 1.6) + i);
        const turn = t * (140 + random(`paper-r-${i}`) * 360) + i * 40;
        const size = 9 + random(`paper-z-${i}`) * 9;
        // A piece seen edge-on almost disappears: that flicker is what makes it read as paper.
        const face = Math.abs(Math.cos((turn * Math.PI) / 180));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: size,
              height: size * 1.7,
              background: rgba(colors[i % colors.length], level * (0.35 + 0.65 * face)),
              transform: `rotate(${turn * 0.6}deg) scaleY(${0.15 + 0.85 * face})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
