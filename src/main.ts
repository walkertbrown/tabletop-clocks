import {
	App,
	Editor,
	MarkdownPostProcessorContext,
	Notice,
	Plugin,
	PluginSettingTab,
	SettingDefinitionItem,
	TFile,
	setIcon,
} from 'obsidian';
import {
	Clock,
	Counter,
	MAX,
	MIN,
	Stopwatch,
	addLines,
	clickSegment,
	formatTime,
	isFull,
	parseBlock,
	setFilled,
	setValue,
	stepCounter,
	wedgePath,
} from './clock';

interface Settings {
	size: string; // segments for a clock written without n/size
	notify: boolean; // a notice when a clock fills or a stopwatch reaches its time
	running: Record<string, number>; // when each running stopwatch started, by note and name
}

const DEFAULT_SETTINGS: Settings = {
	size: '4',
	notify: true,
	running: {},
};

// What other plugins hear on each change, as `tabletop-clocks:change`.
export interface ClockChange {
	sourcePath: string;
	name: string;
	link?: string;
	filled: number;
	previous: number;
	size: number;
	full: boolean;
}

// What other plugins hear when a counter changes, as `tabletop-clocks:count`.
export interface CountChange {
	sourcePath: string;
	name: string;
	link?: string;
	value: number;
	previous: number;
	max?: number;
}

// What other plugins hear when a stopwatch starts, pauses or resets, as `tabletop-clocks:stopwatch`.
export interface StopwatchChange {
	sourcePath: string;
	name: string;
	link?: string;
	seconds: number;
	running: boolean;
	limit?: number;
}

const TEMPLATE = '```clocks\n# Heist\nAlarm 0/4 red\nGet the loot 0/6 vs Guards arrive 0/6\n```\n';
const OPEN = /^((?:\s*>)*\s*)(`{3,}|~{3,})\s*clocks\b/;

export default class TabletopClocksPlugin extends Plugin {
	settings: Settings = DEFAULT_SETTINGS;
	// redraws of running stopwatches; each says false once its block has gone
	private tickers = new Set<() => boolean>();
	private done = new Set<string>(); // stopwatches whose time-up notice has shown

	async onload() {
		await this.loadSettings();
		this.registerInterval(
			window.setInterval(() => {
				for (const t of this.tickers) if (!t()) this.tickers.delete(t);
			}, 500),
		);
		this.registerMarkdownCodeBlockProcessor('clocks', (src, el, ctx) => {
			new Board(this, el, ctx, src).draw();
		});
		this.addCommand({
			id: 'insert-block',
			name: 'Insert clocks',
			editorCallback: (editor: Editor) => editor.replaceSelection(TEMPLATE),
		});
		this.addSettingTab(new SettingTab(this.app, this));
	}

	get size(): number {
		const n = parseInt(this.settings.size, 10);
		return Number.isFinite(n) ? Math.max(MIN, Math.min(MAX, n)) : 4;
	}

	// Rewrites the body of one rendered block. False when the block can't be found.
	async edit(el: HTMLElement, ctx: MarkdownPostProcessorContext, edit: (body: string) => string): Promise<boolean> {
		const info = ctx.getSectionInfo(el);
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!info || !(file instanceof TFile)) return false;
		let ok = false;
		await this.app.vault.process(file, (data) => {
			const lines = data.split('\n');
			const open = OPEN.exec(lines[info.lineStart] ?? '');
			const close = lines[info.lineEnd] ?? '';
			if (!open || !close.includes(open[2]!)) return data; // the note changed under us; leave it alone
			const prefix = open[1]!;
			const body = lines
				.slice(info.lineStart + 1, info.lineEnd)
				.map((l) => l.slice(prefix.length))
				.join('\n');
			const next = edit(body)
				.split('\n')
				.filter((l, i, a) => l.trim() || i < a.length - 1)
				.map((l) => prefix + l);
			lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...next);
			ok = true;
			return lines.join('\n');
		});
		return ok;
	}

	ticker(t: () => boolean) {
		this.tickers.add(t);
	}

	// A stopwatch's key in `running`: the note and the name, so it survives lines moving and Obsidian restarting.
	static key(sourcePath: string, name: string) {
		return `${sourcePath}\n${name}`;
	}

	// The notice for a stopwatch reaching its time, once per run.
	timeUp(key: string, name: string) {
		if (this.done.has(key)) return;
		this.done.add(key);
		if (this.settings.notify) new Notice(`${name}: time's up.`);
	}

	async setRunning(key: string, since: number | null) {
		const running = { ...this.settings.running };
		if (since === null) delete running[key];
		else running[key] = since;
		this.done.delete(key);
		this.settings.running = running;
		await this.saveSettings();
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<Settings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
		this.settings.running = { ...(this.settings.running ?? {}) };
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// One rendered `clocks` block.
class Board {
	constructor(
		private plugin: TabletopClocksPlugin,
		private el: HTMLElement,
		private ctx: MarkdownPostProcessorContext,
		private src: string,
	) {}

	private async change(edit: (body: string) => string) {
		const ok = await this.plugin.edit(this.el, this.ctx, edit);
		if (!ok) new Notice('Could not find these clocks in the note. Switch views and try again.');
		return ok;
	}

	private async fill(index: number, c: Clock, filled: number) {
		const n = Math.max(0, Math.min(c.size, filled));
		if (n === c.filled && c.written) return;
		const size = this.plugin.size;
		const ok = await this.change((b) => setFilled(b, index, c.part, n, size));
		if (!ok) return;
		const e: ClockChange = {
			sourcePath: this.ctx.sourcePath,
			name: c.name,
			link: c.link,
			filled: n,
			previous: c.filled,
			size: c.size,
			full: n >= c.size,
		};
		this.plugin.app.workspace.trigger('tabletop-clocks:change', e);
		if (e.full && c.filled < c.size && this.plugin.settings.notify) new Notice(`${c.name} is full.`);
	}

	draw() {
		const items = parseBlock(this.src, this.plugin.size);
		this.el.empty();
		const box = this.el.createDiv({ cls: 'pc' });
		let grid: HTMLElement | null = null;
		for (const item of items) {
			if (item.kind === 'counter' || item.kind === 'stopwatch') {
				grid ??= box.createDiv({ cls: 'pc-grid' });
				if (item.kind === 'counter') this.drawCounter(grid, item.index, item.counter);
				else this.drawStopwatch(grid, item.index, item.stopwatch);
				continue;
			}
			if (item.kind === 'heading') {
				const h = box.createDiv({ cls: 'pc-heading' });
				setIcon(h.createSpan({ cls: 'pc-heading-icon' }), 'clock');
				h.createSpan({ text: item.text });
				grid = null;
				continue;
			}
			grid ??= box.createDiv({ cls: 'pc-grid' });
			if (item.clocks.length === 2) {
				const race = grid.createDiv({ cls: 'pc-race' });
				this.drawClock(race, item.index, item.clocks[0]!);
				race.createDiv({ cls: 'pc-vs', text: 'vs' });
				this.drawClock(race, item.index, item.clocks[1]!);
				const [a, b] = item.clocks as [Clock, Clock];
				if (isFull(a) !== isFull(b)) race.addClass(isFull(a) ? 'pc-race-left' : 'pc-race-right');
			} else this.drawClock(grid, item.index, item.clocks[0]!);
		}
		if (!items.some((i) => i.kind !== 'heading')) box.createDiv({ cls: 'pc-empty', text: 'No clocks yet. Add one below.' });

		const foot = box.createDiv({ cls: 'pc-foot' });
		const input = foot.createEl('input', {
			cls: 'pc-add-input',
			type: 'text',
			placeholder: 'Alarm 0/6, Torches: 6, or Ritual: 0:00',
		});
		const add = foot.createEl('button', { cls: 'pc-btn pc-add', text: 'Add clock' });
		const submit = () => {
			const text = input.value;
			if (!text.trim()) return;
			const size = this.plugin.size;
			void this.change((b) => addLines(b, text, size)).then((ok) => {
				if (ok) input.value = '';
			});
		};
		input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' && !ev.isComposing) {
				ev.preventDefault();
				submit();
			}
		});
		add.addEventListener('click', submit);
	}

	private drawName(card: HTMLElement, c: { name: string; link?: string }) {
		const name = card.createDiv({ cls: 'pc-name' });
		if (c.link) {
			const link = name.createEl('a', { cls: 'internal-link', text: c.name });
			link.setAttr('data-href', c.link);
			link.setAttr('href', c.link);
			link.addEventListener('click', (ev) => {
				ev.preventDefault();
				void this.plugin.app.workspace.openLinkText(c.link!, this.ctx.sourcePath);
			});
		} else name.setText(c.name);
	}

	private async count(index: number, c: Counter, to: number) {
		const value = stepCounter(c, to);
		if (value === c.value) return;
		if (!(await this.change((b) => setValue(b, index, value)))) return;
		const e: CountChange = { sourcePath: this.ctx.sourcePath, name: c.name, link: c.link, value, previous: c.value, max: c.max };
		this.plugin.app.workspace.trigger('tabletop-clocks:count', e);
	}

	private drawCounter(parent: HTMLElement, index: number, c: Counter) {
		const card = parent.createDiv({ cls: 'pc-clock pc-counter' });
		if (c.color) card.addClass(`pc-${c.color}`);
		const value = card.createDiv({
			cls: 'pc-value',
			attr: { role: 'spinbutton', tabindex: 0, 'aria-label': c.name, 'aria-valuenow': c.value },
		});
		value.createSpan({ cls: 'pc-value-n', text: String(c.value) });
		if (c.max !== undefined) {
			value.createSpan({ cls: 'pc-value-of', text: ` / ${c.max}` });
			const bar = card.createDiv({ cls: 'pc-meter' });
			bar.createDiv({ cls: 'pc-meter-fill' }).setCssProps({ width: `${c.max ? (Math.max(0, c.value) / c.max) * 100 : 0}%` });
		}
		value.addEventListener('keydown', (ev) => {
			const d = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : 0;
			if (!d) return;
			ev.preventDefault();
			void this.count(index, c, c.value + d);
		});
		this.drawName(card, c);
		const row = card.createDiv({ cls: 'pc-row' });
		const minus = row.createEl('button', { cls: 'pc-btn pc-minus', text: '−' });
		minus.setAttr('aria-label', `One less ${c.name}`);
		const plus = row.createEl('button', { cls: 'pc-btn pc-plus', text: '+' });
		plus.setAttr('aria-label', `One more ${c.name}`);
		minus.addEventListener('click', () => void this.count(index, c, c.value - 1));
		plus.addEventListener('click', () => void this.count(index, c, c.value + 1));
	}

	private async stopwatch(index: number, w: Stopwatch, seconds: number, run: boolean) {
		const key = TabletopClocksPlugin.key(this.ctx.sourcePath, w.name);
		const at = Math.floor(seconds);
		// the running mark goes first, so the redraw that follows the note's edit counts from the new start
		await this.plugin.setRunning(key, run ? Date.now() : null);
		if (at !== w.seconds && !(await this.change((b) => setValue(b, index, at)))) return;
		const e: StopwatchChange = { sourcePath: this.ctx.sourcePath, name: w.name, link: w.link, seconds: at, running: run, limit: w.limit };
		this.plugin.app.workspace.trigger('tabletop-clocks:stopwatch', e);
		// a stopwatch that only started or paused leaves the note's text alone, so draw it again here
		if (at === w.seconds) this.draw();
	}

	private drawStopwatch(parent: HTMLElement, index: number, w: Stopwatch) {
		const key = TabletopClocksPlugin.key(this.ctx.sourcePath, w.name);
		const card = parent.createDiv({ cls: 'pc-clock pc-stopwatch' });
		if (w.color) card.addClass(`pc-${w.color}`);
		const time = card.createDiv({ cls: 'pc-value pc-time', attr: { role: 'timer', 'aria-label': w.name } });
		const bar = w.limit ? card.createDiv({ cls: 'pc-meter' }).createDiv({ cls: 'pc-meter-fill' }) : null;
		this.drawName(card, w);
		const row = card.createDiv({ cls: 'pc-row' });
		const go = row.createEl('button', { cls: 'pc-btn pc-go' });
		const reset = row.createEl('button', { cls: 'pc-btn pc-reset' });
		setIcon(reset, 'rotate-ccw');
		reset.setAttr('aria-label', `Reset ${w.name}`);

		const since = () => this.plugin.settings.running[key];
		const now = () => {
			const s = since();
			const t = w.seconds + (s === undefined ? 0 : Math.max(0, Date.now() - s) / 1000);
			return w.limit !== undefined ? Math.min(t, w.limit) : t;
		};
		const show = () => {
			const t = now();
			time.setText(formatTime(t));
			if (bar && w.limit) bar.setCssProps({ width: `${(t / w.limit) * 100}%` });
			const up = w.limit !== undefined && t >= w.limit;
			card.toggleClass('is-full', up);
			card.toggleClass('is-running', since() !== undefined && !up);
			if (up && since() !== undefined) this.plugin.timeUp(key, w.name);
		};
		const running = since() !== undefined;
		setIcon(go, running ? 'pause' : 'play');
		go.setAttr('aria-label', `${running ? 'Pause' : 'Start'} ${w.name}`);
		go.addEventListener('click', () => {
			if (since() !== undefined) void this.stopwatch(index, w, now(), false);
			else if (w.limit === undefined || w.seconds < w.limit) void this.stopwatch(index, w, w.seconds, true);
		});
		reset.addEventListener('click', () => void this.stopwatch(index, w, 0, false));
		show();
		if (running) this.plugin.ticker(() => {
			if (!time.isConnected || since() === undefined) return false;
			show();
			return true;
		});
	}

	private drawClock(parent: HTMLElement, index: number, c: Clock) {
		const card = parent.createDiv({ cls: 'pc-clock' });
		if (c.color) card.addClass(`pc-${c.color}`);
		if (isFull(c)) card.addClass('is-full');

		const svg = card.createSvg('svg', {
			cls: 'pc-face',
			attr: {
				viewBox: '0 0 100 100',
				role: 'slider',
				tabindex: 0,
				'aria-label': c.name,
				'aria-valuemin': 0,
				'aria-valuemax': c.size,
				'aria-valuenow': c.filled,
				'aria-valuetext': `${c.filled} of ${c.size}`,
			},
		});
		svg.createSvg('circle', { cls: 'pc-rim', attr: { cx: 50, cy: 50, r: 48 } });
		for (let i = 0; i < c.size; i++) {
			const seg = svg.createSvg('path', {
				cls: i < c.filled ? 'pc-seg is-filled' : 'pc-seg',
				attr: { d: wedgePath(i, c.size, 50, 50, 44, c.size > 8 ? 3 : 4) },
			});
			seg.addEventListener('click', () => void this.fill(index, c, clickSegment(c.filled, i + 1)));
		}
		svg.createSvg('circle', { cls: 'pc-hub', attr: { cx: 50, cy: 50, r: 7 } });
		svg.addEventListener('keydown', (ev) => {
			const d = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : 0;
			if (!d) return;
			ev.preventDefault();
			void this.fill(index, c, c.filled + d);
		});

		this.drawName(card, c);

		const row = card.createDiv({ cls: 'pc-row' });
		const minus = row.createEl('button', { cls: 'pc-btn pc-minus', text: '−' });
		minus.setAttr('aria-label', `Clear a segment of ${c.name}`);
		row.createSpan({ cls: 'pc-count', text: isFull(c) ? 'Full' : `${c.filled}/${c.size}` });
		const plus = row.createEl('button', { cls: 'pc-btn pc-plus', text: '+' });
		plus.setAttr('aria-label', `Tick ${c.name}`);
		minus.addEventListener('click', () => void this.fill(index, c, c.filled - 1));
		plus.addEventListener('click', () => void this.fill(index, c, c.filled + 1));
	}
}

class SettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: TabletopClocksPlugin) {
		super(app, plugin);
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		const sizes: Record<string, string> = {};
		for (const n of [4, 6, 8, 10, 12]) sizes[String(n)] = `${n} segments`;
		return [
			{
				name: 'Default size',
				desc: 'Segments for a clock written without a size, like "Alarm" on its own line.',
				control: { type: 'dropdown', key: 'size', defaultValue: DEFAULT_SETTINGS.size, options: sizes },
			},
			{
				name: 'Notice when a clock fills',
				desc: 'Show a short notice the moment the last segment is ticked, or a stopwatch reaches its time.',
				control: { type: 'toggle', key: 'notify', defaultValue: true },
			},
		];
	}
	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof Settings];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
	}
}
