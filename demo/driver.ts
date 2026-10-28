// Browser demo: runs the real Tabletop Clocks plugin against the test shim, over a sample
// heist note, and shows the note's text changing as the clocks are ticked.
import { App, installDomHelpers } from '../test/obsidian-shim';
import TabletopClocksPlugin from '../src/main';

installDomHelpers();

const ICONS: Record<string, string> = {
	clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
	play: '<polygon points="6 3 20 12 6 21 6 3"/>',
	pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
	'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
};
(globalThis as unknown as { __iconHook: (el: HTMLElement, name: string) => void }).__iconHook = (el, name) => {
	const body = ICONS[name];
	if (!body) return;
	el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
};

const START = `# The salt merchant's vault

In through the canal gate, up to the reliquary, out before the bells.

\`\`\`clocks
# The score
Alarm 1/4 red
Crack the reliquary 2/6 blue
Get out 0/4 vs The watch closes in 1/6
Lockpicks: 3 of 5
Until the bells: 0:00 of 10:00 purple
# Downtime
[[Red Hand gang]] wants revenge 3/8 orange
Heal Cass 2/4 green
\`\`\``;

type Ctx = { sourcePath: string; addChild: () => void; getSectionInfo: () => { text: string; lineStart: number; lineEnd: number } };
type Proc = (src: string, el: HTMLElement, c: Ctx) => void;

async function main() {
	const app = new App();
	app.notes.set('Heist.md', { path: 'Heist.md', content: START });
	app.active = 'Heist.md';

	const pc = new TabletopClocksPlugin(app as never, { id: 'tabletop-clocks' } as never);
	await pc.onload();
	const proc = (pc as never as { codeBlocks: Record<string, Proc> }).codeBlocks.clocks!;

	const note = () => app.notes.get('Heist.md')!.content;
	const ctx: Ctx = {
		sourcePath: 'Heist.md',
		addChild: () => {},
		getSectionInfo: () => {
			const lines = note().split('\n');
			const lineStart = lines.findIndex((l) => l.startsWith('```clocks'));
			const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
			return { text: note(), lineStart, lineEnd };
		},
	};
	const body = () => {
		const info = ctx.getSectionInfo();
		return note().split('\n').slice(info.lineStart + 1, info.lineEnd).join('\n');
	};

	const source = document.querySelector<HTMLElement>('#source');
	const board = document.querySelector<HTMLElement>('#board');
	const log = document.querySelector<HTMLElement>('#events');

	const draw = () => {
		if (board) {
			const typing = board.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT';
			const focused = board.contains(document.activeElement) && document.activeElement?.classList.contains('pc-face')
				? [...board.querySelectorAll('.pc-face')].indexOf(document.activeElement as Element)
				: -1;
			proc(body(), board, ctx);
			if (typing) board.querySelector<HTMLInputElement>('.pc-add-input')?.focus();
			if (focused >= 0) (board.querySelectorAll('.pc-face')[focused] as SVGElement | undefined)?.focus();
		}
		if (source) source.textContent = note();
	};
	const flash = () => {
		if (!source) return;
		source.classList.remove('flash');
		void source.offsetWidth;
		source.classList.add('flash');
	};

	const process = app.vault.process;
	app.vault.process = async (f, fn) => {
		const out = await process(f, fn);
		draw();
		flash();
		return out;
	};
	app.workspace.on('tabletop-clocks:change', (e: { name: string; filled: number; size: number; full: boolean }) => {
		if (log) log.textContent = `tabletop-clocks:change  ${e.name} ${e.filled}/${e.size}${e.full ? '  (full)' : ''}`;
	});
	app.workspace.on('tabletop-clocks:count', (e: { name: string; value: number; max?: number }) => {
		if (log) log.textContent = `tabletop-clocks:count  ${e.name} ${e.value}${e.max !== undefined ? ` of ${e.max}` : ''}`;
	});
	app.workspace.on('tabletop-clocks:stopwatch', (e: { name: string; seconds: number; running: boolean }) => {
		if (log) log.textContent = `tabletop-clocks:stopwatch  ${e.name} ${e.running ? 'started' : 'stopped'} at ${e.seconds}s`;
	});
	draw();

	document.querySelector('#reset')?.addEventListener('click', () => {
		app.notes.get('Heist.md')!.content = START;
		if (log) log.textContent = '';
		draw();
	});
	const opened = document.querySelector<HTMLElement>('#opened');
	app.workspace.openLinkText = async (link: string) => {
		if (opened) opened.textContent = `In Obsidian this opens the "${link}" note.`;
	};
}

void main();
