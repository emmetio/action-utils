import fs from 'fs';
import path from 'path';
import { deepStrictEqual as deepEqual, strictEqual as equal } from 'assert';
import { selectItemHTML, getOpenTag, findTagMatch } from '../src/html';

const sample = fs.readFileSync(path.resolve(__dirname, './samples/sample.html'), 'utf8');

describe('HTML', () => {
    it('select next item', () => {
        // `<li class="item item_1">`: select tag name, full attribute, attribute
        // value and class names
        deepEqual(selectItemHTML(sample, 9), {
            start: 9,
            end: 33,
            ranges: [
                [10, 12],
                [13, 32],
                [20, 31],
                [20, 24],
                [25, 31]
            ]
        });

        // <a href="/sample"  title={expr}>
        deepEqual(selectItemHTML(sample, 33), {
            start: 42,
            end: 74,
            ranges: [
                [43, 44],
                [45, 59],
                [51, 58],
                [61, 73],
                [68, 72]
            ]
        });
    });

    it('select previous item', () => {
        // <a href="/sample"  title={expr}>
        deepEqual(selectItemHTML(sample, 80, true), {
            start: 42,
            end: 74,
            ranges: [
                [43, 44],
                [45, 59],
                [51, 58],
                [61, 73],
                [68, 72]
            ]
        });

        // <li class="item item_1">
        deepEqual(selectItemHTML(sample, 42, true), {
            start: 9,
            end: 33,
            ranges: [
                [10, 12],
                [13, 32],
                [20, 31],
                [20, 24],
                [25, 31]
            ]
        });
    });

    it('get open tag', () => {
        deepEqual(getOpenTag(sample, 60), {
            name: 'a',
            type: 1,
            start: 42,
            end: 74,
            attributes: [{
                name: 'href',
                nameStart: 45,
                nameEnd: 49,
                value: '"/sample"',
                valueStart: 50,
                valueEnd: 59
            }, {
                name: 'title',
                nameStart: 61,
                nameEnd: 66,
                value: '{expr}',
                valueStart: 67,
                valueEnd: 73
            }]
        });

        deepEqual(getOpenTag(sample, 15), {
            name: 'li',
            type: 1,
            start: 9,
            end: 33,
            attributes: [{
                name: 'class',
                nameStart: 13,
                nameEnd: 18,
                value: '"item item_1"',
                valueStart: 19,
                valueEnd: 32
            }]
        });

        equal(getOpenTag(sample, 74), undefined);
    });

    it('tag match', () => {
        // Inside <li> open tag
        deepEqual(findTagMatch(sample, 17), {
            name: 'li',
            open: [9, 33],
            close: [94, 99],
        });

        // Inside text content
        deepEqual(findTagMatch(sample, 38), {
            name: 'li',
            open: [9, 33],
            close: [94, 99],
        });

        deepEqual(findTagMatch(sample, 78), {
            name: 'a',
            open: [42, 74],
            close: [85, 89],
        });

        // Inside close tag
        deepEqual(findTagMatch(sample, 131), {
            name: 'li',
            open: [104, 128],
            close: [128, 133],
        });
    });

});
