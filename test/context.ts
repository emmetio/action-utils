import fs from 'fs';
import path from 'path';
import { deepStrictEqual as deepEqual, strictEqual as equal } from 'assert';
import { ElementType } from '@emmetio/html-matcher';
import { TokenType } from '@emmetio/css-matcher';
import { getHTMLContext, getCSSContext } from '../src/context';

const html = fs.readFileSync(path.resolve(__dirname, './samples/context.html'), 'utf8');
const scss = fs.readFileSync(path.resolve(__dirname, './samples/sample.scss'), 'utf8');

describe('Context detector', () => {
    it('HTML', () => {
        // Inside <li class="nav"> tag
        let ctx = getHTMLContext(html, 457);
        deepEqual(ctx.current, {
            name: 'li',
            type: ElementType.Open,
            range: [450, 466]
        });

        deepEqual(ctx.ancestors, [
            { name: 'html', range: [16, 32] },
            { name: 'body', range: [426, 432] },
            { name: 'ul', range: [437, 441] },
        ]);
        equal(ctx.css, null);

        // Between <span> and </span>
        ctx = getHTMLContext(html, 508);
        deepEqual(ctx.current, null);
        deepEqual(ctx.css, null);
        deepEqual(ctx.ancestors, [
            { name: 'html', range: [16, 32] },
            { name: 'body', range: [426, 432] },
            { name: 'ul', range: [437, 441] },
            { name: 'li', range: [450, 466] },
            { name: 'span', range: [466, 508] }
        ]);

        // Before `text` content
        ctx = getHTMLContext(html, 558);
        deepEqual(ctx.current, null);
        deepEqual(ctx.css, null);
        deepEqual(ctx.ancestors, [
            { name: 'html', range: [16, 32] },
            { name: 'body', range: [426, 432] },
            { name: 'ul', range: [437, 441] },
            { name: 'li', range: [529, 545] },
        ]);
    });

    it('CSS in HTML', () => {
        // Right after `p` in `padding` CSS property of <style>
        let ctx = getHTMLContext(html, 221);
        deepEqual(ctx.current, null);
        deepEqual(ctx.ancestors, [
            { name: 'html', range: [16, 32] },
            { name: 'head', range: [33, 39] },
            { name: 'style', range: [185, 192] },
        ]);

        deepEqual(ctx.css!.ancestors, [
            { name: 'body', type: TokenType.Selector, range: [201, 205] },
        ]);
        deepEqual(ctx.css!.current, {
            name: 'padding',
            type: TokenType.PropertyName,
            range: [220, 227]
        });
        equal(ctx.css!.inline, false);
        deepEqual(ctx.css!.embedded, [192, 409]);

        // Before `display` CSS property of <style>
        ctx = getHTMLContext(html, 331);
        deepEqual(ctx.current, null);
        deepEqual(ctx.ancestors, [
            { name: 'html', range: [16, 32] },
            { name: 'head', range: [33, 39] },
            { name: 'style', range: [185, 192] },
        ]);

        deepEqual(ctx.css!.ancestors, [
            { name: '@media screen', type: TokenType.Selector, range: [280, 293] },
            { name: 'main', type: TokenType.Selector, range: [308, 312] },
        ]);
        deepEqual(ctx.css!.current, null);
        equal(ctx.css!.inline, false);
        deepEqual(ctx.css!.embedded, [192, 409]);

        // Before `10px` of `padding` CSS property in style=""
        ctx = getHTMLContext(html, 488);
        deepEqual(ctx.current, {
            name: 'span',
            type: ElementType.Open,
            range: [466, 508]
        });
        deepEqual(ctx.ancestors, [
            { name: 'html', range: [16, 32] },
            { name: 'body', range: [426, 432] },
            { name: 'ul', range: [437, 441] },
            { name: 'li', range: [450, 466] },
        ]);

        deepEqual(ctx.css!.ancestors, [
            { name: 'padding', type: TokenType.PropertyName, range: [479, 486] },
        ]);
        deepEqual(ctx.css!.current, null);
        equal(ctx.css!.inline, true);
        deepEqual(ctx.css!.embedded, [479, 506]);
    });

    it('SCSS', () => {
        const ctx = getCSSContext(scss, 283);
        deepEqual(ctx.ancestors, [
            { name: 'ul', type: TokenType.Selector, range: [0, 2] },
            { name: '> li', type: TokenType.Selector, range: [148, 152] },
            { name: '&.selected', type: TokenType.Selector, range: [257, 267] },
        ]);
        deepEqual(ctx.current, {
            name: 'border-color',
            type: TokenType.PropertyName,
            range: [282, 294]
        });
        equal(ctx.inline, false);
    });
});
