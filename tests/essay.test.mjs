import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The two scripts only the video essay Skill ships: reading a source into a
// copy that can be checked, and checking an episode against those copies.
const script = name =>
  fileURLToPath(new URL(`../skills/create-video-essay/assets/starter/scripts/${name}.mjs`, import.meta.url));

async function run(name, directory, args) {
  const child = spawn(process.execPath, [script(name), ...args], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

async function withServer(handler, runWith) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await runWith(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const workspace = () => mkdtemp(join(tmpdir(), 'angles-essay-'));

// A page as an older Chinese site serves it: GBK bytes, declared as gb2312 in
// a <meta> and not in the header, with a script and a comment to leave out.
//   <title>论持久战</title><script>var x="不要";</script><!-- 注释 -->
//   <p>很多人都说持久战&nbsp;&amp;&#8220;为什么&#8221;</p><div>第二段　有全角空格</div>
const GBK_PAGE = Buffer.from(
  '3c68746d6c3e3c686561643e3c6d65746120636861727365743d22676232333132223e3c7469746c653ec2dbb3d6bec3d5bd3c2f7469746c653e3c7363726970743e76617220783d22b2bbd2aa223b3c2f7363726970743e3c2f686561643e3c626f64793e3c212d2d20d7a2cacd202d2d3e3c703ebadcb6e0c8cbb6bccbb5b3d6bec3d5bd266e6273703b26616d703b2623383232303bceaacab2c3b42623383232313b3c2f703e3c6469763eb5dab6feb6cea1a1d3d0c8abbdc7bfd5b8f13c2f6469763e3c2f626f64793e3c2f68746d6c3e',
  'hex'
);

test('read.mjs keeps a text copy of a page in the encoding the page declares', async () => {
  const directory = await workspace();
  try {
    await withServer(
      (request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(GBK_PAGE);
      },
      async base => {
        const result = await run('read', directory, [`${base}/page`, '--as', 's01']);
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /^research\/s01\.txt — 论持久战 — \d+ characters, gb18030\n/);

        const copy = await readFile(join(directory, 'research', 's01.txt'), 'utf8');
        const [title, source, read, charset, hash, blank, ...text] = copy.trimEnd().split('\n');
        assert.equal(title, '# 论持久战');
        assert.equal(source, `# source: ${base}/page`);
        assert.match(read, /^# read: \d{4}-\d{2}-\d{2}$/);
        assert.equal(charset, '# charset: gb18030');
        assert.match(hash, /^# sha256: [0-9a-f]{64}$/);
        assert.equal(blank, '');
        // Entities decoded, the script and the comment gone, one block a line.
        assert.deepEqual(text, ['论持久战', '很多人都说持久战 &“为什么”', '第二段 有全角空格']);
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('read.mjs reads a file the user gave, and refuses what is not text', async () => {
  const directory = await workspace();
  try {
    // A `>` inside an attribute does not end its tag: none of the attribute is left in the text.
    await writeFile(join(directory, 'page.html'), '<p>Before <span data-note=\'{"html":"<i>x</i> > y"}\' title="a > b">kept</span> after.</p>');
    const tagged = await run('read', directory, ['page.html', '--as', 'page']);
    assert.equal(tagged.code, 0, tagged.stderr);
    assert.ok((await readFile(join(directory, 'research', 'page.txt'), 'utf8')).endsWith('\nBefore kept after.\n'));

    await writeFile(join(directory, 'notes.txt'), 'First line.\r\nSecond line.\r\n');
    const local = await run('read', directory, ['notes.txt', '--as', 'notes']);
    assert.equal(local.code, 0, local.stderr);
    const copy = await readFile(join(directory, 'research', 'notes.txt'), 'utf8');
    assert.match(copy, /^# \(no title\)\n# source: notes\.txt\n/);
    assert.ok(copy.endsWith('\nFirst line.\nSecond line.\n'));

    await withServer(
      (request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/pdf' });
        response.end('%PDF-1.7');
      },
      async base => {
        const pdf = await run('read', directory, [`${base}/paper.pdf`, '--as', 's02']);
        assert.equal(pdf.code, 1);
        assert.match(pdf.stderr, /is application\/pdf, not a page of text/);
      }
    );

    const scheme = await run('read', directory, ['ftp://example.org/file', '--as', 's03']);
    assert.equal(scheme.code, 1);
    assert.match(scheme.stderr, /Only http and https addresses are read/);

    const unnamed = await run('read', directory, ['notes.txt']);
    assert.equal(unnamed.code, 1);
    assert.match(unnamed.stderr, /usage: node scripts\/read\.mjs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A small episode that holds together; each test breaks one thing in it. */
async function episode(directory, change = () => {}) {
  const facts = {
    question: 'Why?',
    sources: [
      { id: 's01', title: 'The text itself', kind: 'primary' },
      { id: 's02', title: 'A history', kind: 'scholarly' },
    ],
    facts: [
      { id: 'f01', kind: 'date', text: 'It was published on 1 July 1938.', sources: ['s01', 's02'], standing: 'documented' },
      { id: 'f02', kind: 'quote', text: 'Many people speak of a long war…few say why.', sources: ['s01'], standing: 'documented' },
      { id: 'f03', kind: 'claim', text: 'It took ten years of losing to learn.', sources: ['s02'], standing: 'interpretation' },
    ],
    screen: {
      published: { value: '1938-07-01', fact: 'f01' },
      question: { value: 'few say why.', fact: 'f02' },
    },
  };
  const script = {
    title: 'Why',
    chapters: [{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }],
    lines: [
      { id: 'a01', text: 'In July 1938 it was published.', facts: ['f01'] },
      { id: 'a02', text: 'But why then?', facts: [] },
      { id: 'b01', text: 'Many spoke of a long war; few said why.', facts: ['f02'], pause: 1.6 },
      { id: 'b02', text: 'One historian puts it down to ten years of losing.', facts: ['f03'] },
    ],
  };
  const research = {
    s01: '# The text itself\n# source: https://example.org\n\nMany people speak of a long war.\nBut how long? And few\nsay why.\n',
  };
  change({ facts, script, research });
  await mkdir(join(directory, 'src'), { recursive: true });
  await mkdir(join(directory, 'research'), { recursive: true });
  await writeFile(join(directory, 'src', 'ep01.facts.json'), JSON.stringify(facts));
  await writeFile(join(directory, 'src', 'ep01.script.json'), JSON.stringify(script));
  for (const [id, text] of Object.entries(research)) await writeFile(join(directory, 'research', `${id}.txt`), text);
}

test('check.mjs passes an episode that holds together, and says what to look at', async () => {
  const directory = await workspace();
  try {
    await episode(directory);
    const result = await run('check', directory, ['src/ep01.script.json']);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^ep01: 4 lines, 3 facts, 2 sources\n/);
    assert.doesNotMatch(result.stdout, /Must fix/);
    // The quotation is found across a line break, and past the words its ellipsis skips.
    assert.match(result.stdout, /No facts under — transitions, or inventions\? a02 "But why then\?"/);
    assert.match(result.stdout, /Rest on one source — tell the user: f02 \(b01, screen\.question\) · f03 \(b02\)/);
    assert.match(result.stdout, /Readings, not records — is each worded as one\? f03 interpretation \(b02\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('check.mjs refuses a quotation that is not in the copy of its source', async () => {
  const directory = await workspace();
  try {
    await episode(directory, ({ facts }) => {
      facts.facts[1].text = 'Many people speak of a short war…few say why.';
    });
    const result = await run('check', directory, ['src/ep01.script.json']);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /Must fix \(1\):\n  f02 is a quotation, and its words are not in research\/s01\.txt as written/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('check.mjs refuses what points at nothing, and what is printed but was never said', async () => {
  const directory = await workspace();
  try {
    await episode(directory, ({ facts, script }) => {
      script.lines[0].facts = ['f09'];
      script.lines.push({ id: 'c01', text: 'x'.repeat(401), facts: ['f01'] });
      facts.facts[2].sources = ['s07'];
      facts.screen.question.value = 'nobody says why.';
      facts.screen.orphan = { value: 3 };
      facts.images = [
        { file: 'images/portrait.jpg', shows: 'A portrait' },
        { file: 'images/night.jpg', shows: 'The harbour that night, as an illustration', generated: true },
      ];
    });
    const result = await run('check', directory, ['src/ep01.script.json']);
    assert.equal(result.code, 1);
    for (const expected of [
      /a01 names fact f09, which is not in src\/ep01\.facts\.json/,
      /c01 is 401 characters; a voiced line may be 400 at most/,
      /c01 belongs to no chapter: its id starts with none of a, b/,
      /f03 names source s07, which is not in src\/ep01\.facts\.json/,
      /screen\.question shows words that are not in the quotation f02: "nobody says why\."/,
      /screen\.orphan names no fact/,
      /Image images\/portrait\.jpg has no licence recorded/,
      /Image images\/portrait\.jpg is not in public\//,
      /Image images\/night\.jpg was made, and has no credit that says so/,
    ]) {
      assert.match(result.stdout, expected);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('check.mjs asks for a look at what it cannot settle', async () => {
  const directory = await workspace();
  try {
    await episode(directory, ({ facts, script, research }) => {
      delete research.s01;
      delete script.lines[2].pause;
      Object.assign(facts.sources[0], { url: 'https://example.org/text', year: 1938, read: '2026-10-06' });
      Object.assign(facts.sources[1], { url: 'https://example.org/wiki/A_history', kind: 'reference', year: 2026, read: '2026-10-06' });
      script.lines[3].text = '一'.repeat(41);
      script.lines[3].say = '短';
      facts.images = [{ file: 'images/night.jpg', shows: 'The harbour that night', generated: true, credit: 'Illustration: generated image' }];
    });
    await mkdir(join(directory, 'public', 'images'), { recursive: true });
    await writeFile(join(directory, 'public', 'images', 'night.jpg'), 'jpeg');
    const result = await run('check', directory, ['src/ep01.script.json']);
    assert.equal(result.code, 0, result.stdout);
    assert.match(result.stdout, /b01 opens a chapter with no room for its card/);
    assert.match(result.stdout, /Quotations with no copy of their source under research\/ to check against: f02/);
    assert.match(result.stdout, /Long for one line: b02/);
    // A made picture needs no licence, and cannot be checked from here: it is put in front of a person.
    assert.doesNotMatch(result.stdout, /night\.jpg has no licence/);
    assert.match(result.stdout, /Made pictures — does each say "illustration" on screen.*images\/night\.jpg/);
    assert.match(result.stdout, /Dated the year they were read .* takes no "year": s02\n/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('check.mjs needs the facts file to be there first', async () => {
  const directory = await workspace();
  try {
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'src', 'ep01.script.json'), '{"lines":[]}');
    const result = await run('check', directory, ['src/ep01.script.json']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No facts at src\/ep01\.facts\.json\. The facts file comes before the script\./);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('handover.mjs writes the subtitles, the chapters and the sources the episode rests on', async () => {
  const directory = await workspace();
  try {
    await episode(directory, ({ facts }) => {
      facts.sources.push({ id: 's03', title: 'Never used', kind: 'press' });
      facts.sources[0] = { id: 's01', title: 'The text itself', author: 'A. Writer', year: 1938, edition: 'Collected Works, vol. 2', url: 'https://example.org/text', kind: 'primary' };
      facts.images = [{ file: 'images/desk.jpg', licence: 'CC BY 4.0', credit: 'Desk, 1938 — J. Doe, CC BY 4.0' }];
    });
    await writeFile(
      join(directory, 'src', 'ep01.audio.json'),
      JSON.stringify({
        totalSeconds: 3725,
        clips: [
          { id: 'a01', text: 'In July 1938 it was published.', at: 0.35, seconds: 3 },
          { id: 'a02', text: 'But why then?', at: 3.7, seconds: 1.2 },
          { id: 'b01', text: 'Many spoke of a long war; few said why.', at: 83.5, seconds: 4 },
          { id: 'b02', text: 'One historian puts it down to ten years of losing.', at: 3700, seconds: 5 },
        ],
      })
    );
    const result = await run('handover', directory, ['src/ep01.script.json']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /note: no cover — out\/ep01\.final\.mp4 is not there yet/);

    const read = file => readFile(join(directory, 'out', 'ep01', file), 'utf8');
    const srt = await read('ep01.srt');
    // A subtitle stays until just before the next line is said, or a moment after its own voice ends.
    assert.ok(srt.startsWith('1\n00:00:00,350 --> 00:00:03,650\nIn July 1938 it was published.\n\n2\n00:00:03,700 --> 00:00:05,200\nBut why then?\n'));
    assert.match(srt, /4\n01:01:40,000 --> 01:01:45,300\nOne historian/);

    // The first chapter is at 0:00 whatever its first line's pause; the second where its first line is said.
    assert.equal(await read('chapters.txt'), '0:00 One\n1:23 Two\n');

    const sources = await read('sources.md');
    assert.match(sources, /^## Sources\n\n- A\. Writer, The text itself, Collected Works, vol\. 2, 1938 — https:\/\/example\.org\/text\n- A history\n/);
    assert.doesNotMatch(sources, /Never used/);
    assert.match(sources, /## Pictures\n\n- Desk, 1938 — J\. Doe, CC BY 4\.0\n$/);

    const description = await read('description.md');
    assert.ok(description.startsWith('Why?\n\n0:00 One\n1:23 Two\n\n## Sources\n'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('handover.mjs takes the cover from the finished video', { skip: hasFfmpeg ? false : 'needs a system ffmpeg' }, async () => {
  const directory = await workspace();
  try {
    await episode(directory);
    await writeFile(join(directory, 'src', 'ep01.audio.json'), JSON.stringify({ totalSeconds: 4, clips: [{ id: 'a01', text: 'One.', at: 0.3, seconds: 1 }] }));
    await mkdir(join(directory, 'out'));
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=4', '-pix_fmt', 'yuv420p', join(directory, 'out', 'ep01.final.mp4')]);
    assert.equal(made.status, 0);
    const result = await run('handover', directory, ['src/ep01.script.json', '--cover', '2']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /out\/ep01\/cover\.jpg\n/);
    assert.equal(existsSync(join(directory, 'out', 'ep01', 'cover.jpg')), true);

    const before = await run('handover', directory, ['src/ep02.script.json']);
    assert.equal(before.code, 1);
    assert.match(before.stderr, /No src\/ep02\.script\.json/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

