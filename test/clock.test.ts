import { describe, expect, it } from 'vitest';
import { addLines, allClocks, clickSegment, parseBlock, parseClock, setFilled, wedgePath } from '../src/clock';

describe('parseClock', () => {
	it('reads name and fill', () => {
		expect(parseClock('Alarm 2/6', 4)).toMatchObject({ name: 'Alarm', filled: 2, size: 6, written: true });
	});
	it('uses the default size when there is no fraction', () => {
		expect(parseClock('Alarm', 4)).toMatchObject({ name: 'Alarm', filled: 0, size: 4, written: false });
	});
	it('reads links, aliases and colours', () => {
		expect(parseClock('[[Red Sashes|The Sashes]] 3/8 red', 4)).toMatchObject({
			name: 'The Sashes',
			link: 'Red Sashes',
			filled: 3,
			size: 8,
			color: 'red',
		});
		expect(parseClock('[[Lampblacks#Plans]]: 1/4', 4)).toMatchObject({ name: 'Lampblacks', link: 'Lampblacks' });
	});
	it('clamps size and fill', () => {
		expect(parseClock('Big 30/40', 4)).toMatchObject({ filled: 12, size: 12 });
		expect(parseClock('Tiny 0/1', 4)).toMatchObject({ size: 2 });
	});
	it('keeps numbers in the name that are not the fill', () => {
		expect(parseClock('Floor 2 vault 1/4', 4)).toMatchObject({ name: 'Floor 2 vault', filled: 1 });
	});
	it('skips empty text', () => {
		expect(parseClock('  ', 4)).toBeNull();
		expect(parseClock('3/4', 4)).toBeNull();
	});
});

describe('parseBlock', () => {
	const src = '# Heist\nAlarm 1/4 red\n\nLoot 2/6 vs Guards 3/6\n## Factions\n[[Bluecoats]] 0/8';
	it('reads headings, single clocks and racing pairs', () => {
		const items = parseBlock(src, 4);
		expect(items.map((i) => i.kind)).toEqual(['heading', 'clocks', 'clocks', 'heading', 'clocks']);
		expect(items[2]).toMatchObject({ index: 3, clocks: [{ name: 'Loot', part: 0 }, { name: 'Guards', part: 1 }] });
		expect(allClocks(items).map((c) => c.name)).toEqual(['Alarm', 'Loot', 'Guards', 'Bluecoats']);
	});
});

describe('setFilled', () => {
	it('changes only the fraction', () => {
		expect(setFilled('  Alarm 1/4 red', 0, 0, 3, 4)).toBe('  Alarm 3/4 red');
	});
	it('changes one side of a race', () => {
		const src = 'x\nLoot 2/6 VS Guards 3/6';
		expect(setFilled(src, 1, 1, 4, 4)).toBe('x\nLoot 2/6 VS Guards 4/6');
		expect(setFilled(src, 1, 0, 6, 4)).toBe('x\nLoot 6/6 VS Guards 3/6');
	});
	it('writes a fraction where there was none, before a colour', () => {
		expect(setFilled('Alarm', 0, 0, 1, 6)).toBe('Alarm 1/6');
		expect(setFilled('Alarm blue', 0, 0, 1, 4)).toBe('Alarm 1/4 blue');
	});
	it('clamps to the size', () => {
		expect(setFilled('A 3/4', 0, 0, 9, 4)).toBe('A 4/4');
		expect(setFilled('A 3/4', 0, 0, -2, 4)).toBe('A 0/4');
	});
	it('leaves bad indexes alone', () => {
		expect(setFilled('A 3/4', 5, 0, 1, 4)).toBe('A 3/4');
		expect(setFilled('A 3/4', 0, 1, 1, 4)).toBe('A 3/4');
	});
});

describe('addLines', () => {
	it('appends, giving bare names the default size', () => {
		expect(addLines('A 1/4\n', 'Alarm; Escape 0/8 vs Guards', 6)).toBe('A 1/4\nAlarm 0/6\nEscape 0/8 vs Guards 0/6');
		expect(addLines('', 'B 2/4', 4)).toBe('B 2/4');
		expect(addLines('A 1/4', '  ', 4)).toBe('A 1/4');
	});
});

describe('clicks and geometry', () => {
	it('fills up to a segment, or clears the last one', () => {
		expect(clickSegment(0, 3)).toBe(3);
		expect(clickSegment(3, 3)).toBe(2);
		expect(clickSegment(5, 2)).toBe(2);
	});
	it('starts the first wedge at twelve o\'clock', () => {
		const d = wedgePath(0, 4, 50, 50, 40, 0);
		expect(d).toBe('M 50 50 L 50.00 10.00 A 40 40 0 0 1 90.00 50.00 Z');
		expect(wedgePath(0, 2, 50, 50, 40, 0)).toContain(' 0 0 1 ');
	});
});
