// The text side of Tabletop Clocks: reading a `clocks` block, changing one clock, counter or stopwatch in it,
// and the geometry of a segmented circle. No Obsidian here, so it is easy to test.
//
//   Alarm 1/4 red                 a clock
//   Arrows: 18 of 20              a counter (the "of 20" is optional)
//   Ritual: 4:12 of 10:00         a stopwatch (the "of 10:00" is optional)

export const MIN = 2;
export const MAX = 12;

export const COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;
export type Color = (typeof COLORS)[number];

export interface Clock {
	name: string; // what is shown, without [[ ]]
	link?: string; // the note a [[link]] in the name points to
	filled: number;
	size: number;
	color?: Color;
	part: number; // 0, or 1 for the right side of a racing pair
	written: boolean; // false when the line has no n/size yet and the default size was used
}

export interface Counter {
	name: string;
	link?: string;
	value: number;
	max?: number;
	color?: Color;
}

export interface Stopwatch {
	name: string;
	link?: string;
	seconds: number; // as written; a running one adds the time since it started
	limit?: number;
	color?: Color;
}

export type Item =
	| { kind: 'heading'; index: number; text: string }
	| { kind: 'clocks'; index: number; clocks: Clock[] }
	| { kind: 'counter'; index: number; counter: Counter }
	| { kind: 'stopwatch'; index: number; stopwatch: Stopwatch };

const FRACTION = /(\d+)\s*\/\s*(\d+)/g;
const VS = /\s+vs\.?\s+/i;
const HEADING = /^#{1,6}\s+(.*)$/;
const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/;

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// The last n/size in a piece of text, if any.
function lastFraction(text: string): RegExpExecArray | null {
	let last: RegExpExecArray | null = null;
	for (const m of text.matchAll(FRACTION)) last = m;
	return last;
}

// The name part of a line, with a [[link]] read out of it.
function named(text: string): { name: string; link?: string } {
	let rest = text;
	let link: string | undefined;
	const l = LINK.exec(rest);
	if (l) {
		link = l[1]!.trim();
		rest = rest.replace(l[0], l[2]?.trim() ?? link);
	}
	return { name: rest.replace(/\s+/g, ' ').trim(), link };
}

// A trailing colour word, split off.
function colorTail(text: string): { rest: string; color?: Color; tail: string } {
	const m = /^(.*?)(\s+(\S+))?\s*$/.exec(text)!;
	const word = m[3]?.toLowerCase();
	if (m[1] && word && (COLORS as readonly string[]).includes(word)) return { rest: m[1], color: word as Color, tail: m[2]! };
	return { rest: text.trimEnd(), tail: '' };
}

const TIME = '\\d+:\\d{2}(?::\\d{2})?';
const STOPWATCH = new RegExp(`^(.+?):\\s*(${TIME})(?:\\s+of\\s+(${TIME}))?$`, 'i');
const COUNTER = /^(.+?):\s*([-−]?\d+)(?:\s+of\s+(\d+))?$/i;

/** "4:12" or "1:04:12" as seconds. */
export function readTime(t: string): number {
	return t.split(':').reduce((s, p) => s * 60 + parseInt(p, 10), 0);
}

/** Seconds as "4:12", or "1:04:12" from an hour up. */
export function formatTime(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const pad = (n: number) => String(n).padStart(2, '0');
	return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// A counter or stopwatch line, with the raw text before its colon kept for writing it back.
function readLine(t: string): { head: string; tail: string; counter?: Counter; stopwatch?: Stopwatch } | null {
	const { rest, color, tail } = colorTail(t.trim());
	let m = STOPWATCH.exec(rest);
	if (m) {
		const n = named(m[1]!);
		if (!n.name) return null;
		const w: Stopwatch = { ...n, seconds: readTime(m[2]!) };
		if (m[3]) w.limit = readTime(m[3]);
		if (color) w.color = color;
		return { head: m[1]!, tail, stopwatch: w };
	}
	m = COUNTER.exec(rest);
	if (m) {
		const n = named(m[1]!);
		if (!n.name) return null;
		const c: Counter = { ...n, value: parseInt(m[2]!.replace('−', '-'), 10) };
		if (m[3]) c.max = parseInt(m[3], 10);
		if (color) c.color = color;
		return { head: m[1]!, tail, counter: c };
	}
	return null;
}

/** A counter's next value: kept between 0 and its max when it has one. */
export function stepCounter(c: Counter, value: number): number {
	return c.max === undefined ? value : clamp(value, 0, c.max);
}

// Writes a new value into a counter's line, or a new time into a stopwatch's.
export function setValue(src: string, index: number, value: number): string {
	const lines = src.split('\n');
	const line = lines[index];
	const r = line === undefined ? null : readLine(line);
	if (!r) return src;
	const lead = /^\s*/.exec(line!)![0];
	const v = r.counter
		? `${value}${r.counter.max !== undefined ? ` of ${r.counter.max}` : ''}`
		: `${formatTime(value)}${r.stopwatch!.limit !== undefined ? ` of ${formatTime(r.stopwatch!.limit)}` : ''}`;
	lines[index] = `${lead}${r.head.trim()}: ${v}${r.tail}`;
	return lines.join('\n');
}

// One clock: "Alarm 2/6", "[[Rival gang]] 1/8 red", or just "Alarm" (the default size, empty).
export function parseClock(text: string, defaultSize: number, part = 0): Clock | null {
	let rest = text.trim();
	if (!rest) return null;
	let color: Color | undefined;
	const words = rest.split(/\s+/);
	const tail = words[words.length - 1]!.toLowerCase();
	if (words.length > 1 && (COLORS as readonly string[]).includes(tail)) {
		color = tail as Color;
		rest = words.slice(0, -1).join(' ');
	}
	const f = lastFraction(rest);
	let size = defaultSize;
	let filled = 0;
	if (f) {
		size = clamp(parseInt(f[2]!, 10), MIN, MAX);
		filled = clamp(parseInt(f[1]!, 10), 0, size);
		rest = (rest.slice(0, f.index) + rest.slice(f.index + f[0].length)).trim();
	}
	let link: string | undefined;
	const l = LINK.exec(rest);
	if (l) {
		link = l[1]!.trim();
		rest = rest.replace(l[0], l[2]?.trim() ?? link);
	}
	const name = rest.replace(/\s+/g, ' ').replace(/[:\-–—]\s*$/, '').trim();
	if (!name) return null;
	return { name, link, filled, size, color, part, written: !!f };
}

export function parseBlock(src: string, defaultSize: number): Item[] {
	const items: Item[] = [];
	src.split('\n').forEach((line, index) => {
		const t = line.trim();
		if (!t) return;
		const h = HEADING.exec(t);
		if (h) {
			items.push({ kind: 'heading', index, text: h[1]!.trim() });
			return;
		}
		const r = readLine(t);
		if (r?.counter) {
			items.push({ kind: 'counter', index, counter: r.counter });
			return;
		}
		if (r?.stopwatch) {
			items.push({ kind: 'stopwatch', index, stopwatch: r.stopwatch });
			return;
		}
		const clocks = t
			.split(VS)
			.slice(0, 2)
			.map((p, i) => parseClock(p, defaultSize, i))
			.filter((c): c is Clock => c !== null);
		if (clocks.length) items.push({ kind: 'clocks', index, clocks });
	});
	return items;
}

export function allClocks(items: Item[]): Clock[] {
	return items.flatMap((i) => (i.kind === 'clocks' ? i.clocks : []));
}

// Writes a new fill into one clock of one line, keeping the rest of the line as it was.
export function setFilled(src: string, index: number, part: number, filled: number, defaultSize: number): string {
	const lines = src.split('\n');
	const line = lines[index];
	if (line === undefined) return src;
	const lead = /^\s*/.exec(line)![0];
	const parts = line.trim().split(VS);
	const seps = line.trim().match(new RegExp(VS.source, 'gi')) ?? [];
	const piece = parts[part];
	if (piece === undefined) return src;
	const c = parseClock(piece, defaultSize, part);
	if (!c) return src;
	const n = clamp(filled, 0, c.size);
	const f = lastFraction(piece);
	if (f) {
		parts[part] = piece.slice(0, f.index) + `${n}/${c.size}` + piece.slice(f.index + f[0].length);
	} else {
		// no n/size yet: put it before a trailing colour word, or at the end
		const m = /^(.*?)(\s+(?:red|orange|yellow|green|cyan|blue|purple|pink))?\s*$/i.exec(piece)!;
		parts[part] = `${m[1]} ${n}/${c.size}${m[2] ?? ''}`;
	}
	lines[index] = lead + parts.map((p, i) => (i ? (seps[i - 1] ?? ' vs ') : '') + p).join('');
	return lines.join('\n');
}

// Adds clocks typed in the add box; a line without n/size gets the default size.
export function addLines(src: string, text: string, defaultSize: number): string {
	const add = text
		.split(/\n|;/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) =>
			readLine(s)
				? s
				: s
						.split(VS)
						.map((p) => (parseClock(p, defaultSize)?.written === false ? setFilled(p, 0, 0, 0, defaultSize) : p))
						.join(' vs '),
		);
	if (!add.length) return src;
	const body = src.replace(/\s+$/, '');
	return (body ? body + '\n' : '') + add.join('\n');
}

// Clicking segment k (1-based) fills up to it; clicking the last filled one empties it.
export function clickSegment(filled: number, k: number): number {
	return filled === k ? k - 1 : k;
}

export function isFull(c: Pick<Clock, 'filled' | 'size'>): boolean {
	return c.filled >= c.size;
}

// One wedge of an n-segment clock, as an SVG path. Segment 0 starts at twelve o'clock and
// they run clockwise. `gap` is the space between wedges in degrees.
export function wedgePath(i: number, n: number, cx: number, cy: number, r: number, gap = 4): string {
	const step = 360 / n;
	const a0 = -90 + i * step + gap / 2;
	const a1 = -90 + (i + 1) * step - gap / 2;
	const pt = (deg: number) => {
		const rad = (deg * Math.PI) / 180;
		return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`;
	};
	const large = a1 - a0 > 180 ? 1 : 0;
	return `M ${cx} ${cy} L ${pt(a0)} A ${r} ${r} 0 ${large} 1 ${pt(a1)} Z`;
}
