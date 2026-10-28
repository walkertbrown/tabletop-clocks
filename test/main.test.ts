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
