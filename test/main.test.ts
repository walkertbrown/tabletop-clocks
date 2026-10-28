// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { App, Notice, ctx, installDomHelpers } from './obsidian-shim';
import TabletopClocksPlugin from '../src/main';

beforeAll(() => installDomHelpers());

type Proc = (src: string, el: HTMLElement, c: ReturnType<typeof ctx>) => void;

async function setup(note: string, settings: Record<string, unknown> | null = null) {
	const app = new App();
	app.notes.set('Heist.md', { path: 'Heist.md', content: note });
	const plugin = new TabletopClocksPlugin(app as never, { id: 'tabletop-clocks' } as never);
	(plugin as never as { data: unknown }).data = settings;
	await plugin.onload();
	const proc = (plugin as never as { codeBlocks: Record<string, Proc> }).codeBlocks['clocks']!;
	const el = document.createElement('div');
	const render = () => {
		const lines = app.notes.get('Heist.md')!.content.split('\n');
		const lineStart = lines.findIndex((l) => /```clocks/.test(l));
		const lineEnd = lines.findIndex((l, i) => i > lineStart && l.includes('```'));
		const body = lines.slice(lineStart + 1, lineEnd).map((l) => l.replace(/^>\s?/, '')).join('\n');
		proc(body, el, ctx('Heist.md', { text: note, lineStart, lineEnd }));
	};
	render();
	const flush = () => new Promise((r) => setTimeout(r, 0));
	const content = () => app.notes.get('Heist.md')!.content;
	const click = async (sel: string, i = 0) => {
		el.querySelectorAll<Element>(sel)[i]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flush();
		render();
	};
	const text = (sel: string) => Array.from(el.querySelectorAll(sel)).map((n) => n.textContent);
	return { app, plugin, el, content, click, flush, text, render };
}

const NOTE = '# Heist\n\n```clocks\n# The job\nAlarm 1/4 red\nLoot 2/6 vs Guards 3/6\n```\n\nAfter.';

describe('clocks block', () => {
	it('draws headings, clocks and segments without editing', async () => {
		const { el, text, content } = await setup(NOTE);
		expect(text('.pc-heading')).toEqual(['The job']);
		expect(text('.pc-name')).toEqual(['Alarm', 'Loot', 'Guards']);
		expect(text('.pc-count')).toEqual(['1/4', '2/6', '3/6']);
		expect(el.querySelectorAll('.pc-clock')[0]!.querySelectorAll('.pc-seg').length).toBe(4);
		expect(el.querySelectorAll('.pc-clock')[0]!.querySelectorAll('.pc-seg.is-filled').length).toBe(1);
		expect(el.querySelectorAll('.pc-race').length).toBe(1);
		expect(el.querySelector('.pc-clock')!.classList.contains('pc-red')).toBe(true);
		expect(content()).toBe(NOTE);
	});

	it('clicking a segment fills up to it and writes the note', async () => {
		const { click, content, app } = await setup(NOTE);
		await click('.pc-seg', 2);
		expect(content()).toContain('Alarm 3/4 red');
		expect(app.events[0]).toMatchObject({ name: 'tabletop-clocks:change', data: { name: 'Alarm', filled: 3, previous: 1, size: 4, full: false } });
		await click('.pc-seg', 2);
		expect(content()).toContain('Alarm 2/4 red');
	});

	it('ticks and clears with the buttons, on either side of a race', async () => {
		const { click, content } = await setup(NOTE);
		await click('.pc-plus', 2);
		expect(content()).toContain('Loot 2/6 vs Guards 4/6');
		await click('.pc-minus', 1);
		expect(content()).toContain('Loot 1/6 vs Guards 4/6');
	});

	it('says when a clock fills and marks it full', async () => {
		const { click, content, text, el, app } = await setup(NOTE);
		Notice.last = '';
		await click('.pc-seg', 3);
		expect(content()).toContain('Alarm 4/4 red');
		expect(Notice.last).toBe('Alarm is full.');
		expect(text('.pc-count')[0]).toBe('Full');
		expect(el.querySelector('.pc-clock')!.classList.contains('is-full')).toBe(true);
		expect(app.events.at(-1)).toMatchObject({ data: { full: true } });
	});

	it('marks the winner of a race', async () => {
		const { el } = await setup('```clocks\nLoot 6/6 vs Guards 3/6\n```');
		expect(el.querySelector('.pc-race')!.classList.contains('pc-race-left')).toBe(true);
	});

	it('keeps quiet when notices are off', async () => {
		const { click } = await setup(NOTE, { notify: false });
		Notice.last = '';
		await click('.pc-seg', 3);
		expect(Notice.last).toBe('');
	});

	it('adds clocks from the box with the default size', async () => {
		const { el, flush, content } = await setup(NOTE, { size: '8' });
		const input = el.querySelector<HTMLInputElement>('.pc-add-input')!;
		input.value = 'Rival crew';
		el.querySelector<HTMLElement>('.pc-add')!.click();
		await flush();
		expect(content()).toContain('Loot 2/6 vs Guards 3/6\nRival crew 0/8\n```');
		expect(input.value).toBe('');
	});

	it('writes a size the first time a bare clock changes', async () => {
		const { click, content } = await setup('```clocks\nAlarm\n```', { size: '6' });
		await click('.pc-plus');
		expect(content()).toBe('```clocks\nAlarm 1/6\n```');
	});

	it('works inside a callout', async () => {
		const note = '> [!note] Clocks\n> ```clocks\n> Alarm 0/4\n> ```';
		const { click, content } = await setup(note);
		await click('.pc-plus');
		expect(content()).toBe('> [!note] Clocks\n> ```clocks\n> Alarm 1/4\n> ```');
	});

	it('steps with the arrow keys', async () => {
		const { el, flush, content } = await setup(NOTE);
		el.querySelector('.pc-face')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await flush();
		expect(content()).toContain('Alarm 2/4 red');
	});

	it('has one command', async () => {
		const { plugin } = await setup(NOTE);
		const cmds = (plugin as never as { commands: { id: string; name: string }[] }).commands;
		expect(cmds.map((c) => [c.id, c.name])).toEqual([['insert-block', 'Insert clocks']]);
	});
});

describe('counters and stopwatches', () => {
	const NOTE2 = '# Fight\n\n```clocks\nArrows: 2 of 3\nRitual: 0:10 of 0:30\n```\n';

	it('a counter steps with its buttons, stops at its max, and tells other plugins', async () => {
		const { click, content, app, text } = await setup(NOTE2);
		expect(text('.pc-counter .pc-value')).toEqual(['2 / 3']);
		await click('.pc-counter .pc-plus');
		expect(content()).toContain('Arrows: 3 of 3');
		expect(app.events.at(-1)).toMatchObject({ name: 'tabletop-clocks:count', data: { name: 'Arrows', value: 3, previous: 2, max: 3 } });
		const n = app.events.length;
		await click('.pc-counter .pc-plus');
		expect(content()).toContain('Arrows: 3 of 3');
		expect(app.events.length).toBe(n);
		await click('.pc-counter .pc-minus');
		expect(content()).toContain('Arrows: 2 of 3');
	});

	it('a stopwatch runs from its saved start, and pausing writes the time into the note', async () => {
		const { click, content, plugin, el, app } = await setup(NOTE2);
		expect(el.querySelector('.pc-time')!.textContent).toBe('0:10');
		await click('.pc-stopwatch .pc-go');
		const key = 'Heist.md\nRitual';
		expect(plugin.settings.running[key]).toBeTypeOf('number');
		expect(app.events.at(-1)).toMatchObject({ name: 'tabletop-clocks:stopwatch', data: { name: 'Ritual', running: true } });
		expect(el.querySelector('.pc-stopwatch')!.classList.contains('is-running')).toBe(true);
		// as if it started 7 seconds ago
		plugin.settings.running[key] = Date.now() - 7000;
		await click('.pc-stopwatch .pc-go');
		expect(content()).toContain('Ritual: 0:17 of 0:30');
		expect(plugin.settings.running[key]).toBeUndefined();
		await click('.pc-stopwatch .pc-reset');
		expect(content()).toContain('Ritual: 0:00 of 0:30');
		plugin.onunload();
	});

	it("a stopwatch stops at its limit and says time's up once", async () => {
		const { click, plugin, el, render } = await setup(NOTE2);
		await click('.pc-stopwatch .pc-go');
		plugin.settings.running['Heist.md\nRitual'] = Date.now() - 60000;
		Notice.last = '';
		render();
		expect(el.querySelector('.pc-time')!.textContent).toBe('0:30');
		expect(el.querySelector('.pc-stopwatch')!.classList.contains('is-full')).toBe(true);
		expect(Notice.last).toBe("Ritual: time's up.");
		Notice.last = '';
		render();
		expect(Notice.last).toBe('');
		plugin.onunload();
	});
});

