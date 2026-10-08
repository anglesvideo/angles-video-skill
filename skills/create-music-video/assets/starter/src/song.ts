// A measured song, as scripts/beats.py wrote it, and the two questions a video
// asks of it: where is the music at this frame, and how loud is each part of
// it right now.

export type Measured = {
  fps: number;
  frames: number;
  bpm: number;
  /** Seconds into the song at which the measured stretch starts. */
  start: number;
  /** The frame each beat falls on; fractions kept, a beat rarely lands on a frame. */
  beats: number[];
  kick: number[];
  body: number[];
  top: number[];
  bands: string[];
};

export function readSong(data: Measured) {
  const beats = data.beats;
  const gap = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);

  /**
   * Where the music is at a frame, in beats from the start of the stretch.
   * Whole numbers are beats; every fourth one, from 0, starts a bar.
   */
  const beatAt = (frame: number): number => {
    if (frame <= beats[0]) return (frame - beats[0]) / gap;
    for (let i = 1; i < beats.length; i++) {
      if (frame < beats[i]) return i - 1 + (frame - beats[i - 1]) / (beats[i] - beats[i - 1]);
    }
    return beats.length - 1 + (frame - beats[beats.length - 1]) / gap;
  };

  /** The frame a beat falls on; fractions of a beat fall in between. */
  const frameOf = (beat: number): number => {
    const i = Math.min(beats.length - 2, Math.max(0, Math.floor(beat)));
    return beats[i] + (beat - i) * (beats[i + 1] - beats[i]);
  };

  /**
   * A level that jumps up with the sound and falls away after it, the way a
   * lamp does: the raw measure flickers too fast to light anything with.
   */
  const follow = (track: number[], release: number) => {
    const out: number[] = [];
    let held = 0;
    for (const value of track) {
      held = Math.max(value, held * release);
      out.push(held);
    }
    return (frame: number) => out[Math.min(out.length - 1, Math.max(0, Math.round(frame)))] ?? 0;
  };

  // A song rarely starts on its first whole bar: there is a count-in, or the
  // voice comes in early. The video starts where the song does, so everything
  // in it is `lead` frames later than the measurement says.
  const lead = Math.round(data.start * data.fps);

  return {
    /** Frames of song before the first measured beat. A video takes `useCurrentFrame() - lead` as its frame. */
    lead,
    /** How long the video is: the whole song. */
    length: data.frames + lead,
    beatAt,
    frameOf,
    /** The kick and the bass: what the big lights move to. */
    kick: follow(data.kick, 0.8),
    /** The voice and the chords. */
    body: follow(data.body, 0.88),
    /** Hats and air: what the small, fast lights flicker to. */
    top: follow(data.top, 0.7),
    /** Twenty-four meters across the range of the ear, low to high, each 0–1. */
    bands: (frame: number): number[] => [...data.bands[Math.min(data.bands.length - 1, Math.max(0, Math.round(frame)))]].map(digit => Number(digit) / 9),
  };
}
