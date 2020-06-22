import { AttributeToken } from '@emmetio/html-matcher';

export type TextRange = [number, number];

export interface SelectItemModel {
    start: number;
    end: number;
    ranges: TextRange[];
}

export const pairs = {
    '{': '}',
    '[': ']',
    '(': ')'
};

export const pairsEnd: string[] = [];
for (const key of Object.keys(pairs)) {
    pairsEnd.push(pairs[key]);
}

/**
 * Returns `true` if given character code is a space
 */
export function isSpace(code: number): boolean {
    return code === 32  /* space */
        || code === 9   /* tab */
        || code === 160 /* non-breaking space */
        || code === 10  /* LF */
        || code === 13; /* CR */
}

export function pushRange(ranges: TextRange[], range: TextRange) {
    const prev = ranges[ranges.length - 1];
    if (range && range[0] !== range[1] && (!prev || prev[0] !== range[0] || prev[1] !== range[1])) {
        ranges.push(range);
    }
}

/**
 * Returns ranges of tokens in given value. Tokens are space-separated words.
 */
export function tokenList(value: string, offset = 0): TextRange[] {
    const ranges: TextRange[] = [];
    const len = value.length;
    let pos = 0;
    let start = 0;
    let end = 0;

    while (pos < len) {
        end = pos;
        const ch = value.charCodeAt(pos++);
        if (isSpace(ch)) {
            if (start !== end) {
                ranges.push([offset + start, offset + end]);
            }

            while (isSpace(value.charCodeAt(pos))) {
                pos++;
            }

            start = pos;
        }
    }

    if (start !== pos) {
        ranges.push([offset + start, offset + pos]);
    }

    return ranges;
}

/**
 * Check if given character is a quote
 */
export function isQuote(ch: string | undefined) {
    return ch === '"' || ch === '\'';
}

/**
 * Returns value of given attribute, parsed by Emmet HTML matcher
 */
export function attributeValue(attr: AttributeToken): string | undefined {
    const { value } = attr
    return value && isQuoted(value)
        ? value.slice(1, -1)
        : value;
}

export function attributeValueRange(tag: string, attr: AttributeToken, offset = 0): TextRange {
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
 * Check if given value is either quoted or written as expression
 */
export function isQuoted(value: string | undefined): boolean {
    return !!value && (isQuotedString(value) || isExprString(value));
}

/**
 * Check if given string is quoted with single or double quotes
 */
export function isQuotedString(str: string): boolean {
    return str.length > 1 && isQuote(str[0]) && str[0] === str.slice(-1);
}

/**
 * Check if given string contains expression, e.g. wrapped with `{` and `}`
 */
function isExprString(str: string): boolean {
    return str[0] === '{' && str.slice(-1) === '}';
}

/**
 * Returns last element of given array
 */
export function last<T>(arr: T[]): T | undefined {
    return arr.length > 0 ? arr[arr.length - 1] : undefined;
}
