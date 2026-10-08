// What a system shows of itself: a strip of meters for the sound, and a frame
// of readings round the picture.
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { RGB, W, WHITE, frac, mix, rgba } from './rig';
import { face } from './type';

/** The song's own spectrum, as a low strip of lamps along the front of the stage. */
export const Meter: React.FC<{ levels: number[]; a: RGB; b: RGB; level: number }> = ({ levels, a, b, level }) => {
  if (level < 0.02) return null;
  const columns = [...levels].reverse().concat(levels);
  const pitch = W / columns.length;
  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen' }}>
      {columns.map((value, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: i * pitch + pitch * 0.2,
            bottom: 0,
            width: pitch * 0.6,
            height: 6 + value * 84,
            background: `linear-gradient(to top, ${rgba(mix(a, b, i / columns.length), 0.9 * level)}, ${rgba(WHITE, 0.2 * level)})`,
            WebkitMaskImage: 'repeating-linear-gradient(to top, #000 0 9px, transparent 9px 13px)',
            maskImage: 'repeating-linear-gradient(to top, #000 0 9px, transparent 9px 13px)',
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** What the system shows on its readout from a beat on. Given the beat, so that a line can count. */
export type Status = [number, (p: number) => string];

/**
 * The frame of an instrument around the picture: the show is being recorded, and
 * this is its readout. On the left a clock, a name and what `lines` say is
 * going on, typed out; on the right the tempo, the bar and how loud the voice is.
 */
export const Hud: React.FC<{ p: number; frame: number; level: number; voice: number; lines: Status[]; name: string; bpm: number; seconds: number }> = ({ p, frame, level, voice, lines, name, bpm, seconds }) => {
  if (level < 0.02) return null;
  const [from, say] = [...lines].reverse().find(([at]) => p >= at) ?? lines[0];
  const status = say(p);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${String(Math.floor((seconds % 1) * 30)).padStart(2, '0')}`;
  const text: React.CSSProperties = { fontFamily: face.mono, fontSize: 21, letterSpacing: 2.5, lineHeight: '34px', color: 'rgba(255,255,255,0.86)', textShadow: '0 0 12px rgba(52,229,255,0.7), 0 2px 0 rgba(0,0,0,0.6)', whiteSpace: 'nowrap' };
  const corner = (style: React.CSSProperties) => <div style={{ position: 'absolute', width: 38, height: 38, borderColor: 'rgba(255,255,255,0.7)', borderStyle: 'solid', borderWidth: 0, ...style }} />;
  return (
    <AbsoluteFill style={{ opacity: level }}>
      {corner({ left: 34, top: 34, borderLeftWidth: 3, borderTopWidth: 3 })}
      {corner({ right: 34, top: 34, borderRightWidth: 3, borderTopWidth: 3 })}
      {corner({ left: 34, bottom: 34, borderLeftWidth: 3, borderBottomWidth: 3 })}
      {corner({ right: 34, bottom: 34, borderRightWidth: 3, borderBottomWidth: 3 })}
      <div style={{ position: 'absolute', left: 40, top: 470, height: 112, width: 3, background: 'rgba(52,229,255,0.85)' }} />
      <div style={{ position: 'absolute', left: 58, top: 470, ...text }}>
        <div>
          <span style={{ color: '#ff4a5e', opacity: frac(p) < 0.5 ? 1 : 0.25 }}>●</span> REC {clock}
        </div>
        <div>{name}</div>
        <div style={{ fontFamily: '"PingFang SC", sans-serif', fontSize: 23, letterSpacing: 3, fontWeight: 600 }}>
          {'> '}
          {status.slice(0, 1 + Math.floor((p - from) * 9))}
          <span style={{ opacity: Math.floor(frame / 8) % 2 ? 1 : 0 }}>▍</span>
        </div>
      </div>
      <div style={{ position: 'absolute', right: 40, top: 470, height: 112, width: 3, background: 'rgba(255,61,242,0.85)' }} />
      <div style={{ position: 'absolute', right: 58, top: 470, textAlign: 'right', ...text }}>
        <div>{Math.round(bpm)} BPM</div>
        <div>
          BAR {String(Math.floor(p / 4) + 1).padStart(2, '0')} · {Math.floor(((p % 4) + 4) % 4) + 1}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 9 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} style={{ width: 9, height: 17, background: i < Math.round(voice * 12) ? (i > 9 ? '#ff4a5e' : 'rgba(255,255,255,0.9)') : 'rgba(255,255,255,0.2)' }} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
