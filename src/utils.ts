export type TextRange = [number, number];

export interface SelectItemModel {
    start: number;
    end: number;
    ranges: TextRange[];
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
