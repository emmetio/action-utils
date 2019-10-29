import fs from 'fs';
import path from 'path';
import { deepStrictEqual as deepEqual } from 'assert';
import { selectItemCSS, getCSSSection } from '../src/css';

const sample = fs.readFileSync(path.resolve(__dirname, './samples/sample.scss'), 'utf8');

describe('CSS', () => {
    it('select next item', () => {
        deepEqual(selectItemCSS(sample, 0), {
            start: 0,
            end: 2,
            ranges: [[0, 2]]
        });

        // `flex: 1 1;`: parse value tokens as well
        deepEqual(selectItemCSS(sample, 2), {
            start: 9,
            end: 19,
            ranges: [[9, 19], [15, 18], [15, 16], [17, 18]]
        });

        // `> li` nested selector
        deepEqual(selectItemCSS(sample, 143), {
            start: 148,
            end: 152,
            ranges: [[148, 152]]
        });

        // `slot[name="controls"]:empty` top-level selector
        deepEqual(selectItemCSS(sample, 385), {
            start: 387,
            end: 414,
            ranges: [[387, 414]]
        });

    });

    it('select previous item', () => {
        // list-style-type: none;
        deepEqual(selectItemCSS(sample, 70, true), {
            start: 43,
            end: 65,
            ranges: [[43, 65], [60, 64]]
        });

        // border-top: 2px solid transparent;
        deepEqual(selectItemCSS(sample, 206, true), {
            start: 163,
            end: 197,
            ranges: [
                [163, 197],
                [175, 196],
                [175, 178],
                [179, 184],
                [185, 196]
            ]
        });

        // > li
        deepEqual(selectItemCSS(sample, 163, true), {
            start: 148,
            end: 152,
            ranges: [[148, 152]]
        });
    });

    it('get section', () => {
        deepEqual(getCSSSection(sample, 260), {
            start: 257,
            end: 377,
            bodyStart: 269,
            bodyEnd: 376
        }, '&.selected');

        deepEqual(getCSSSection(sample, 207), {
            start: 148,
            end: 383,
            bodyStart: 154,
            bodyEnd: 382
        }, '> li');
    });
});
