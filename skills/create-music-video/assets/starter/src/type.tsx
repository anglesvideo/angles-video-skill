// The faces a video is set in, and the ways it sets words: a line of display
// type, a phrase that arrives as it is sung, a line of a verse along the bottom.
import React from 'react';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { getInfo, loadFont } from '@remotion/google-fonts/ZCOOLQingKeHuangYou';
import { ICE, RGB, W, WHITE, hit, rgba, span } from './rig';

/** The faces in use. `write` sets them; until it has run, words fall back on the system's own. */
export const face = { display: '"PingFang SC", sans-serif', mono: 'monospace' };

/**
 * Fetches the faces for a video. Call it once, with everything the video will
 * write: a Chinese face comes in ninety-odd slices, and only the slices
 * holding one of those characters are fetched, which is a handful.
 */
export function write(everything: string) {
  const info = getInfo();
  const codes = [...new Set([...everything].map(char => char.codePointAt(0) as number))];
  const holds = (range: string, code: number) =>
    range.split(',').some(part => {
      const [low, high] = part.trim().replace(/^U\+/i, '').split('-');
      return code >= parseInt(low, 16) && code <= parseInt(high ?? low, 16);
    });
  const subsets = Object.entries(info.unicodeRanges as Record<string, string>)
    .filter(([, range]) => codes.some(code => holds(range, code)))
    .map(([name]) => name);
  face.display = `${loadFont('normal', { weights: ['400'], subsets: subsets as never }).fontFamily}, "PingFang SC", sans-serif`;
  face.mono = loadMono('normal', { weights: ['500'], subsets: ['latin'] }).fontFamily;
}

/** Red to one side and blue to the other, the way a lens splits a hard light. */
export const fringe = (split: number, glow: RGB, strength = 0.5) =>
  [
    `${split}px 0 0 rgba(255,40,120,0.85)`,
    `${-split}px 0 0 rgba(40,220,255,0.85)`,
    `0 8px 0 rgba(0,0,0,0.5)`,
    `0 0 46px ${rgba(glow, strength)}`,
  ].join(',');

export const Line: React.FC<{
  children: React.ReactNode;
  y: number;
  size: number;
  color?: string;
  glow?: RGB;
  split?: number;
  scale?: number;
  rotate?: number;
  skew?: number;
  opacity?: number;
  spacing?: number;
  outline?: string;
  x?: number;
  clip?: string;
  /** A face of the video's own, in place of the display face. */
  font?: string;
}> = ({ children, y, size, color = '#fff', glow = WHITE, split = 4, scale = 1, rotate = 0, skew = -6, opacity = 1, spacing = 0, outline, x = 0, clip, font }) =>
  opacity < 0.01 ? null : (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y - size * 0.62,
        width: W,
        textAlign: 'center',
        fontFamily: font ?? face.display,
        fontSize: size,
        lineHeight: 1.24,
        whiteSpace: 'nowrap',
        letterSpacing: spacing,
        color: outline ? 'transparent' : color,
        WebkitTextStroke: outline ? `${Math.max(2, size / 64)}px ${outline}` : undefined,
        textShadow: outline ? undefined : fringe(split, glow),
        opacity,
        transform: `scale(${scale}) rotate(${rotate}deg) skewX(${skew}deg)`,
        clipPath: clip,
      }}
    >
      {children}
    </div>
  );

/**
 * A phrase as it is sung: each character arrives when it is sung, and not
 * before. Given as a list of words, it is the words that arrive, one by one:
 * that is how a language written in words is sung.
 */
export const Sung: React.FC<{ text: string | string[]; at: number[]; p: number; waiting?: number }> = ({ text, at, p, waiting = 0 }) => (
  <>
    {(typeof text === 'string' ? [...text] : text).map((char, i) => (
      <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', opacity: p >= at[i] ? 1 : waiting, transform: `scale(${1 + 0.4 * hit(p, at[i], 8)})`, marginLeft: typeof text !== 'string' && i ? '0.26em' : undefined }}>
        {char}
      </span>
    ))}
  </>
);

/** A line of a verse, along the bottom: what is still to come is there, faintly, and fills in as it is sung. */
export const Sub: React.FC<{ p: number; text: string | string[]; at: number[]; until: number; font?: string; size?: number; spacing?: number }> = ({ p, text, at, until, font, size = 76, spacing = 8 }) => (
  <Line y={968} size={size} spacing={spacing} skew={0} split={1.5} glow={ICE} font={font} opacity={span(p, at[0] - 0.5, at[0] - 0.1) * (1 - span(p, until - 0.4, until))}>
    <Sung text={text} at={at} p={p} waiting={0.34} />
  </Line>
);
