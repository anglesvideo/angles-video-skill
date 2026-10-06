// What an episode rests on, for the closing scene to list: the sources under
// the facts its lines and its screen name, in the order the facts file gives
// them, and the credit each picture's licence asks for. scripts/handover.mjs
// writes the same list into the description, so the two cannot disagree.

export type Source = {
  id: string;
  title: string;
  author?: string;
  /** When the work was published. A page with no year of its own has none — never the year it was read. */
  year?: number;
  edition?: string;
  url?: string;
  kind?: string;
};

type Facts = {
  sources?: Source[];
  facts?: { id: string; sources?: string[] | string }[];
  images?: { credit?: string }[];
  // Each entry names the fact it rests on; the rest of an entry is the episode's own.
  screen?: Record<string, unknown>;
};

type Script = { lines: { facts?: string[] }[] };

const list = (value?: string[] | string) => (Array.isArray(value) ? value : value ? [value] : []);

/** The sources this episode's spoken lines and on-screen figures actually rest on. */
export const cited = (script: Script, facts: Facts): Source[] => {
  const shown = Object.values(facts.screen ?? {}).flatMap(entry =>
    entry && typeof entry === 'object' && 'fact' in entry ? [String((entry as { fact: unknown }).fact)] : []
  );
  const used = new Set([...script.lines.flatMap(line => line.facts ?? []), ...shown]);
  const under = new Set((facts.facts ?? []).filter(fact => used.has(fact.id)).flatMap(fact => list(fact.sources)));
  return (facts.sources ?? []).filter(source => under.has(source.id));
};

/** One source as a line of a list: who, what, where it appeared, and when — where it has a year of its own. */
export const citation = (source: Source) => [source.author, source.title, source.edition, source.year].filter(Boolean).join(', ');

/** The credit lines the pictures' licences ask for. */
export const credits = (facts: Facts) => (facts.images ?? []).flatMap(image => (image.credit ? [image.credit] : []));
