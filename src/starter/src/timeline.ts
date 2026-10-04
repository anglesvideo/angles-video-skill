// Timing shared by every video in this workspace. Nothing about how a video
// looks lives here: colours, type, layout and chrome belong to look.tsx, and
// each video's pictures belong to that video.
import React from 'react';
import { Easing, interpolate } from 'remotion';

/** One spoken line, as scripts/voice.mjs writes it to <video>.audio.json. */
export type Clip = {
  id: string;
  text: string;
  /** Path under public/ for staticFile(); null when the line has no sound. */
  src: string | null;
  /** 'audio', 'video' (a take recorded on camera) or 'silent'. */
  kind: string;
  /** How long the line takes to say. */
  seconds: number;
  /** When the voice starts, in seconds from the start of the video. */
  at: number;
};

/** The track under the video, as scripts/voice.mjs fitted it. */
export type Music = {
  /** Path under public/ for staticFile(). */
  src: string;
  /** Seconds into the track at which the video starts. */
  offset: number;
  bpm: number;
  /** Every beat of the music that falls inside the video, in seconds of video time. */
  beats: number[];
};

export type VoiceTrack = {
  totalSeconds: number;
  clips: Clip[];
  /** Seconds before a line is spoken that its picture takes over. */
  cutLead?: number;
  music?: Music | null;
};

export type Beat = Clip & {
  /** Frame this line's picture takes over. */
  from: number;
  /** Length in frames, until the next line's picture takes over. */
  frames: number;
  /** Frames from the start of the beat until the voice starts. */
  lead: number;
  /** Voice length in frames. */
  voice: number;
  /** Absolute frame the voice starts. */
  voiceAt: number;
};

/**
 * Turns the measured voice track into frames. Each beat owns the time from
 * just before its line is spoken until the next line takes over, so a picture
 * is already arriving when its words begin. Pauses are set in the script
 * (`pause` on a line, `tail` at the end) and applied by scripts/voice.mjs —
 * this only converts what was measured.
 *
 * A "beat" here is one spoken line. The beats of the music are returned as
 * `pulses`, in frames, to keep the two apart; when the script names a track,
 * every cut after the first already sits on one.
 */
export const buildTimeline = (track: VoiceTrack, fps: number) => {
  const total = Math.round(track.totalSeconds * fps);
  const anticipate = Math.round((track.cutLead ?? 0.2) * fps);
  const voiced = track.clips.map(clip => ({
    ...clip,
    voiceAt: Math.round(clip.at * fps),
    voice: Math.ceil(clip.seconds * fps),
  }));
  const beats: Beat[] = voiced.map((clip, i) => {
    const from = i === 0 ? 0 : clip.voiceAt - anticipate;
    const next = voiced[i + 1];
    const until = next ? next.voiceAt - anticipate : total;
    return { ...clip, from, frames: until - from, lead: clip.voiceAt - from };
  });
  const pulses = (track.music?.beats ?? []).map(seconds => Math.round(seconds * fps));
  return { beats, total, pulses };
};

/**
 * The music's pulses that fall inside a beat, counted from the beat's start.
 * For things that have no word to land on — the rows of a list, the cells of
 * a grid — bring one in on each.
 */
export const pulsesIn = (beat: Beat, pulses: number[]) =>
  pulses.filter(pulse => pulse >= beat.from && pulse < beat.from + beat.frames).map(pulse => pulse - beat.from);

/**
 * 1 on a pulse of the music, falling to 0 over `decay` frames: an accent that
 * keeps time. `frame` is counted from the start of the video, so read it
 * outside any <Sequence>, or add the sequence's start back.
 */
export const onPulse = (frame: number, pulses: number[], decay = 10) => {
  let last = -Infinity;
  for (const pulse of pulses) {
    if (pulse > frame) break;
    last = pulse;
  }
  return Math.max(0, 1 - (frame - last) / decay) ** 2;
};

/**
 * Volume for the music: `under` while someone is speaking, `open` in the gaps
 * and over the closing hold, fading in at the start and out at the end. Pass
 * it to an <Audio> placed at the top of the video, outside any <Sequence>.
 */
export const duck = (
  track: VoiceTrack,
  fps: number,
  { under = 0.1, open = 0.28, ramp = 0.35 }: { under?: number; open?: number; ramp?: number } = {}
) => {
  const spoken = track.clips.filter(clip => clip.kind !== 'silent');
  return (frame: number) => {
    const t = frame / fps;
    let speaking = 0;
    for (const clip of spoken) {
      const outside = Math.max(clip.at - t, t - (clip.at + clip.seconds), 0);
      speaking = Math.max(speaking, 1 - outside / ramp);
    }
    const level = open + (under - open) * Math.max(0, speaking);
    const fadeIn = Math.min(1, t / 0.4);
    const fadeOut = Math.min(1, Math.max(0, (track.totalSeconds - t) / 1.2));
    return level * fadeIn * fadeOut;
  };
};

/**
 * Frame, counted from the start of the beat, at which the voice reaches
 * `phrase`. An estimate from where the phrase sits in the line, good to a few
 * frames — check the rendered frame when a picture has to land on a word.
 *
 * Throws when the phrase is not in the line: a reworded script should break
 * the build, not leave a picture arriving at the wrong moment.
 */
export const phraseAt = (beat: Beat, phrase: string) => {
  const index = beat.text.indexOf(phrase);
  if (index < 0) {
    throw new Error(`"${phrase}" is not in line ${beat.id}: "${beat.text}"`);
  }
  return beat.lead + Math.round((index / beat.text.length) * beat.voice);
};

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

/** 0→1 over `dur` frames starting at `at`, eased out and clamped. */
export const enter = (frame: number, at: number, dur = 16) =>
  interpolate(frame, [at, at + dur], [0, 1], {
    easing: easeOut,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/** Opacity and upward drift for something arriving at frame `at`. */
export const rise = (frame: number, at: number, distance = 24, dur = 16): React.CSSProperties => {
  const p = enter(frame, at, dur);
  return { opacity: p, transform: `translateY(${(1 - p) * distance}px)` };
};
