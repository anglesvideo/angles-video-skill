// A singer who is still pictures, made to move by cutting. Each picture can be
// framed any number of ways; a cut names a picture and a framing and lands on a
// beat, and arrives with a push, a whip, a flash or a tear. Within a cut the
// singer drifts a little apart from what is behind them. Anything drawn on
// them is given `pin`, so that it stays where it belongs through all of it.
import React from 'react';
import { AbsoluteFill, Img, random, staticFile } from 'remotion';
import { H, INK, RGB, W, WHITE, clamp, lerp, mix, rgba, span } from './rig';

/** A picture as scripts/image.mjs records it in src/images.json. */
export type Picture = { src: string; width: number; height: number };
/** A point of a picture, as parts of its width and height. */
export type Point = [number, number];

/** Where things are in a picture. `subject` is the middle of the singer: what drifts apart from the background. */
export type Marks = {
  subject: Point;
  mic?: Point;
  halo?: { at: Point; rx: number; ry: number; tilt?: number };
  eyes?: [Point, Point];
  /** The radius of an iris, as a part of the picture's width. */
  iris?: number;
};

/** `zoom` is how far in; `at` is the point of the picture that sits at the centre of the frame. */
export type Crop = { zoom: number; at: Point };
export type Cut<Name extends string = string> = {
  /** The beat the cut lands on. */
  from: number;
  /** The picture, or null for nothing at all: black. */
  pic: Name | null;
  a: Crop;
  /** Where the framing has drifted to by the next cut; left out, it pushes in a little. */
  b?: Crop;
  /** A lean, in degrees: the frame is tilted the way a hand-held camera tilts. */
  roll?: number;
  tint: RGB;
  tintLevel: number;
  how?: 'punch' | 'whip' | 'flash' | 'tear';
  /** Barely lit: a shape in the dark. */
  dim?: boolean;
};

export const cut = <Name extends string>(from: number, pic: Name, zoom: number, at: Point, tint: RGB, tintLevel: number, rest: Partial<Cut<Name>> = {}): Cut<Name> => ({ from, pic, a: { zoom, at }, tint, tintLevel, ...rest });

type Box = { width: number; height: number; left: number; top: number };

/** Everything about how the cut that is up sits in the frame. */
export type Stage<Name extends string = string> = {
  now: Cut<Name>;
  index: number;
  /** Beats since the cut landed. */
  since: number;
  picture: Picture;
  pic: Name;
  mark: Marks;
  /** The two layers the picture is drawn in: all of it, and the singer again in front. */
  back: Box;
  front: Box;
  /** Pixels of frame to one unit of the picture's width. */
  scale: number;
  transform: string;
  filter: string;
  flash: number;
  /** Where a point of the picture has ended up in the frame. */
  pin: (point: Point) => Point;
};

/** Where a picture's box sits in the frame for a framing, never showing past the picture's own edge. */
const boxOf = (picture: Picture, crop: Crop, shift: Point = [0, 0], held = true): Box => {
  const cover = Math.max(W / picture.width, H / picture.height) * crop.zoom;
  const width = picture.width * cover;
  const height = picture.height * cover;
  const left = W / 2 - crop.at[0] * width + shift[0];
  const top = H / 2 - crop.at[1] * height + shift[1];
  return { width, height, left: held ? clamp(left, W - width, 0) : left, top: held ? clamp(top, H - height, 0) : top };
};

/**
 * A video's shot list, read. Given the cuts in order, the pictures that have
 * been made and where things are in each, it answers, for any beat and frame,
 * what is on screen and how — or null when the cut is black or its picture
 * does not exist yet.
 */
export function shotList<Name extends string>(cuts: Cut<Name>[], pictures: Partial<Record<Name, Picture>>, marks: Record<Name, Marks>) {
  return (p: number, frame: number): Stage<Name> | null => {
    let index = 0;
    while (index + 1 < cuts.length && cuts[index + 1].from <= p) index++;
    const now = cuts[index];
    const until = cuts[index + 1]?.from ?? now.from + 6;
    const since = p - now.from;
    const through = span(p, now.from, until);
    const picture = now.pic ? pictures[now.pic] : undefined;
    if (!now.pic || !picture) return null;

    const to = now.b ?? { zoom: now.a.zoom * 1.035, at: now.a.at };
    const push = now.how === 'punch' ? 1 + 0.15 * Math.exp(-since * 5) : 1;
    const roll = (now.roll ?? 0) * (0.55 + 0.45 * Math.exp(-since * 2)) + 0.35 * Math.sin(frame / 37);
    // A tilted frame shows its corners unless it is drawn a little larger.
    const crop: Crop = {
      zoom: lerp(now.a.zoom, to.zoom, through) * push * (1 + Math.abs(roll) * 0.034),
      at: [lerp(now.a.at[0], to.at[0], through), lerp(now.a.at[1], to.at[1], through)],
    };
    const drift: Point = [9 * Math.sin(frame / 43 + index), 6 * Math.cos(frame / 36 + index * 2)];
    const back = boxOf(picture, crop, drift);
    // The singer is drawn again a touch larger and drifting further: nearer things move more.
    const front = boxOf(picture, { zoom: crop.zoom * 1.018, at: crop.at }, [drift[0] * 2.4, drift[1] * 2.4], false);

    const whip = now.how === 'whip' ? Math.exp(-since * 8) : 0;
    const side = index % 2 ? 1 : -1;
    // A tear lasts about a quarter of a beat.
    const tearing = now.how === 'tear' && since < 0.28;
    return {
      now,
      index,
      since,
      picture,
      pic: now.pic,
      mark: marks[now.pic],
      back,
      front,
      scale: front.width,
      transform: `translateX(${side * 320 * whip + (tearing ? (random(`tear-shot-${frame}`) - 0.5) * 70 : 0)}px) scaleX(${1 + 0.26 * whip}) rotate(${roll}deg)`,
      filter: tearing ? `saturate(2.4) hue-rotate(${Math.round((random(`tear-hue-${frame}`) - 0.5) * 90)}deg) contrast(1.3)` : '',
      flash: now.how === 'flash' ? 0.4 * Math.exp(-since * 6) : 0,
      pin: (point: Point): Point => [front.left + point[0] * front.width, front.top + point[1] * front.height],
    };
  };
}

/**
 * The shot itself. `light` is how brightly the room's lights fall on the
 * singer, who would otherwise stand under the beams unlit. Anything pinned to
 * them goes inside, so that it leans and whips with the shot.
 */
export const Shot: React.FC<{ shot: Stage; light: number; children?: React.ReactNode }> = ({ shot, light, children }) => {
  const { back, front, picture, now, mark } = shot;
  const filter = `brightness(${light.toFixed(3)}) contrast(1.06) saturate(1.08) ${shot.filter}`;
  const centre = shot.pin(mark.subject);
  const mask = `radial-gradient(ellipse ${Math.round(front.width * 0.3)}px ${Math.round(front.height * 0.5)}px at ${Math.round(centre[0])}px ${Math.round(centre[1])}px, #000 45%, transparent 100%)`;
  return (
    <AbsoluteFill style={{ transform: shot.transform }}>
      <Img src={staticFile(picture.src)} style={{ position: 'absolute', left: back.left, top: back.top, width: back.width, height: back.height, filter }} />
      <AbsoluteFill style={{ WebkitMaskImage: mask, maskImage: mask }}>
        <Img src={staticFile(picture.src)} style={{ position: 'absolute', left: front.left, top: front.top, width: front.width, height: front.height, filter }} />
      </AbsoluteFill>
      {now.tintLevel > 0.01 && <AbsoluteFill style={{ background: rgba(now.tint, 0.5 * now.tintLevel), mixBlendMode: 'soft-light' }} />}
      {now.tintLevel > 0.01 && <AbsoluteFill style={{ background: `radial-gradient(1300px 900px at 50% 40%, ${rgba(now.tint, 0.2 * now.tintLevel)}, transparent 70%)`, mixBlendMode: 'screen' }} />}
      {children}
      {shot.flash > 0.01 && <AbsoluteFill style={{ background: rgba(mix(now.tint, WHITE, 0.6), shot.flash), mixBlendMode: 'screen' }} />}
    </AbsoluteFill>
  );
};

/** The stage with nobody on it: what a shot looks like before its picture exists. */
export const EmptyStage: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(900px 520px at 50% 74%, rgba(40,50,90,0.5), transparent 70%), linear-gradient(to bottom, ${rgba(INK, 1)} 0%, #070a18 70%, #0b0f22 71%, ${rgba(INK, 1)} 100%)` }} />
);

/**
 * The two screens either side of a stage, showing the back rows a close-up:
 * one point of a picture on each, usually the singer's two eyes.
 */
export const Screens: React.FC<{ picture?: Picture; points: Point[]; K: number; tint: RGB }> = ({ picture, points, K, tint }) => {
  if (!picture) return null;
  const width = 430;
  const height = 250;
  const shown = width * (2.5 + 0.12 * K);
  return (
    <>
      {points.slice(0, 2).map((point, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 330,
            left: i ? W - 120 - width : 120,
            width,
            height,
            overflow: 'hidden',
            background: '#000',
            border: `3px solid ${rgba(mix(tint, WHITE, 0.4), 0.95)}`,
            boxShadow: `0 0 40px ${rgba(tint, 0.7)}`,
            transform: `perspective(1100px) rotateY(${i ? -22 : 22}deg)`,
          }}
        >
          <Img src={staticFile(picture.src)} style={{ position: 'absolute', width: shown, height: (shown * picture.height) / picture.width, left: width / 2 - point[0] * shown, top: height / 2 - (point[1] * shown * picture.height) / picture.width }} />
          <AbsoluteFill style={{ background: rgba(tint, 0.35), mixBlendMode: 'soft-light' }} />
          <AbsoluteFill style={{ background: 'repeating-linear-gradient(to bottom, rgba(0,0,0,0.38) 0 2px, transparent 2px 5px)' }} />
        </div>
      ))}
    </>
  );
};
