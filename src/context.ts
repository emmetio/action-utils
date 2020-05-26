import { scan, createOptions, attributes, ElementType, AttributeToken, ScannerOptions } from '@emmetio/html-matcher';
import { scan as scanCSS, TokenType } from '@emmetio/css-matcher';
import { isQuote, last, TextRange } from './utils';

interface ScanItem {
    name: string;
    type: string | number;
    start: number;
    end: number;
}

export interface HTMLContextOptions {
    xml?: boolean;
    skipCSS?: boolean;
}

export interface HTMLAncestor {
    /** Element name */
    name: string;
    /** Range of element’s open tag in source code */
    range: TextRange;
}

export interface HTMLMatch {
    /** Element name */
    name: string;
    /** Element type */
    type: ElementType;
    /** Range of matched element in source code */
    range: TextRange;
}

export interface HTMLContext {
    type: 'html',
    /** List of ancestor elements for current context */
    ancestors: HTMLAncestor[];
    /** Tag match directly under given position */
    current: HTMLMatch | null;
    /** CSS context, if any */
    css: CSSContext | null;
}

export interface CSSMatch {
    /** CSS selector, property or section name */
    name: string;
    /** Type of ancestor element */
    type: TokenType;
    /** Range of selector or section (just name, not entire block) */
    range: TextRange;
}

export interface CSSContext {
    type: 'css',
    /** List of ancestor sections for current context */
    ancestors: CSSMatch[];
    /** CSS match directly under given position */
    current: CSSMatch | null;
    /** Whether CSS context is inline, e.g. in `style=""` HTML attribute */
    inline: boolean;
    /**
     * If current CSS context is embedded into HTML, this property contains
     * range of CSS source in original content
     */
    embedded?: TextRange;
}

/**
 * Returns HTML context for given location in source code
 */
export function getHTMLContext(code: string, pos: number, opt: HTMLContextOptions = {}): HTMLContext {
    const result: HTMLContext = {
        type: 'html',
        ancestors: [],
        current: null,
        css: null
    };

    // Since we expect large input document, we’ll use pooling technique
    // for storing tag data to reduce memory pressure and improve performance
    const pool: ScanItem[] = [];
    const stack: ScanItem[] = [];
    const options = createOptions({ xml: opt.xml, allTokens: true });

    scan(code, (name, type, start, end) => {
        if (start >= pos) {
            // Moved beyond location, stop parsing
            return false;
        }

        if (start < pos && pos < end) {
            // Direct hit on element
            result.current = { name, type, range: [start, end] };
            return false;
        }

        if (type === ElementType.Open && isSelfClose(name, options)) {
            // Found empty element in HTML mode, mark is as self-closing
            type = ElementType.SelfClose;
        }

        if (type === ElementType.Open) {
            // Allocate tag object from pool
            stack.push(allocItem(pool, name, type, start, end));
        } else if (type === ElementType.Close && stack.length && last(stack)!.name === name) {
            // Release tag object for further re-use
            releaseItem(pool, stack.pop()!);
        }
    }, options);

    // Record stack elements as ancestors
    stack.forEach(item => {
        result.ancestors.push({
            name: item.name,
            range: [item.start, item.end]
        });
    });

    if (!opt.skipCSS) {
        // Detect if position is inside CSS context
        result.css = detectCSSContextFromHTML(code, pos, result);
    }

    return result;
}

/**
 * Returns CSS context for given location in source code
 */
export function getCSSContext(code: string, pos: number, embedded?: TextRange): CSSContext {
    const result: CSSContext = {
        type: 'css',
        ancestors: [],
        current: null,
        inline: false,
        embedded
    };

    const pool: ScanItem[] = [];
    const stack: ScanItem[] = [];

    scanCSS(code, (type, start, end) => {
        if (start >= pos) {
            // Token behind specified location, stop parsing
            return false;
        }

        if (start < pos && pos <= end) {
            // Direct hit on token
            result.current = {
                name: code.slice(start, end),
                type,
                range: [start, end]
            };
            return false;
        }

        switch (type) {
            case TokenType.Selector:
                case TokenType.PropertyName:
                stack.push(allocItem(pool, code.slice(start, end), type, start, end));
                break;

            case TokenType.PropertyValue:
            case TokenType.BlockEnd:
                stack.pop();
                break;
        }
    });

    stack.forEach(item => {
        result.ancestors.push({
            name: item.name,
            type: item.type as TokenType,
            range: [item.start, item.end]
        });
    });

    return result;
}

/**
 * Tries to detect CSS context from given HTML context and returns it
 */
function detectCSSContextFromHTML(code: string, pos: number, ctx: HTMLContext): CSSContext | null {
    let cssCtx: CSSContext | null = null;

    if (ctx.current) {
        // Maybe inline CSS?
        const elem = ctx.current;
        if (elem.type === ElementType.Open || elem.type === ElementType.Close) {
            const tag = code.slice(elem.range[0], elem.range[1]);
            attributes(tag, elem.name).some(attr => {
                if (attr.name === 'style' && attr.value != null) {
                    const [valueStart, valueEnd] = attributeValueRange(tag, attr, elem.range[0]);
                    if (pos >= valueStart && pos <= valueEnd) {
                        cssCtx = getCSSContext(code.slice(valueStart, valueEnd), pos - valueStart, [valueStart, valueEnd]);
                        applyOffset(cssCtx, valueStart);
                        cssCtx.inline = true;
                        return true;
                    }
                }
            });
        }
    } else if (ctx.ancestors.length) {
        // Maybe inside `<style>` element?
        const parent = last(ctx.ancestors)!;
        if (parent.name === 'style') {
            // Find closing </style> tag
            const styleStart = parent.range[1];
            let styleEnd = code.length;
            scan(code.slice(parent.range[1]), (name, type, start) => {
                if (name === parent.name && type === ElementType.Close) {
                    styleEnd = start + styleStart;
                    return false;
                }
            });

            cssCtx = getCSSContext(code.slice(styleStart, styleEnd), pos - styleStart, [styleStart, styleEnd]);
            applyOffset(cssCtx, styleStart);
        }
    }

    return cssCtx;
}

function attributeValueRange(tag: string, attr: AttributeToken, offset = 0): [number, number] {
    let valueStart = attr.valueStart!;
    let valueEnd = attr.valueEnd!;

    if (isQuote(tag[valueStart])) {
        valueStart++;
    }

    if (isQuote(tag[valueEnd - 1]) && valueEnd > valueStart) {
        valueEnd--;
    }

    return [offset + valueStart, offset + valueEnd];
}

/**
 * Check if given tag is self-close for current parsing context
 */
function isSelfClose(name: string, options: ScannerOptions) {
    return !options.xml && options.empty.includes(name);
}

function allocItem(pool: ScanItem[], name: string, type: string | number, start: number, end: number): ScanItem {
    if (pool.length) {
        const tag = pool.pop()!;
        tag.name = name;
        tag.type = type;
        tag.start = start;
        tag.end = end;
        return tag;
    }
    return { name, type, start, end };
}

function releaseItem(pool: ScanItem[], item: ScanItem) {
    pool.push(item);
}

function applyOffset(ctx: CSSContext, offset: number) {
    ctx.ancestors.forEach(item => {
        offsetRange(item.range, offset);
    });

    if (ctx.current) {
        offsetRange(ctx.current.range, offset);
    }
}

function offsetRange(range: TextRange, offset: number) {
    range[0] += offset;
    range[1] += offset;
}
