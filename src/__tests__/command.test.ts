import {describe, expect, it} from 'vitest';
import {parseAction} from '../command.js';

describe('parseAction', () => {
	it('maps each subcommand', () => {
		expect(parseAction('')).toEqual({kind: 'show'});
		expect(parseAction('  help ')).toEqual({kind: 'help'});
		expect(parseAction('new')).toEqual({kind: 'new', player: 'w'});
		expect(parseAction('new Black')).toEqual({kind: 'new', player: 'b'});
		expect(parseAction('undo')).toEqual({kind: 'undo'});
		expect(parseAction('resign')).toEqual({kind: 'resign'});
		expect(parseAction('level 5')).toEqual({kind: 'level', level: 5});
		expect(parseAction('Nf3')).toEqual({kind: 'move', text: 'Nf3'});
	});

	it('refuses a bad level or side', () => {
		expect(parseAction('level 9').kind).toBe('invalid');
		expect(parseAction('level').kind).toBe('invalid');
		expect(parseAction('new purple').kind).toBe('invalid');
	});
});
