import { scan, splitValue, TokenType } from '@emmetio/css-matcher';
import { pushRange, TextRange, SelectItemModel } from './utils';

type CSSTokenRange = [number, number, number];

export interface CSSSection {
    start: number;
    end: number;
    bodyStart: number;
    bodyEnd: number;
    properties?: CSSProperty[];
}

export interface CSSProperty {
    name: TextRange;
    value: TextRange;
    valueTokens: TextRange[];
    before: number;
    after: number;
}

/**
 * Returns context CSS section for given location in source code
 * @param properties Parse inner properties
 */
export function getCSSSection(code: string, pos: number, properties?: boolean): CSSSection | undefined {
    const stack: CSSTokenRange[] = [];
    const pool: CSSTokenRange[] = [];
    let result: CSSSection | undefined;

    scan(code, (type, start, end, delimiter) => {
        if (start > pos && !stack.length) {
            return false;
        }

        if (type === TokenType.Selector) {
            stack.push(allocRange(pool, start, end, delimiter));
        } else if (type === TokenType.BlockEnd) {
            const sel = stack.pop();
            if (sel && sel[0] <= pos && pos <= end) {
                result = {
                    start: sel[0],
                    end,
                    bodyStart: sel[2] + 1,
                    bodyEnd: start
                };
                return false;
            }
            releaseRange(pool, sel);
        }
    });

    if (result && properties) {
        result.properties = parseProperties(code, result.bodyStart, result.bodyEnd);
    }

    return result;
}

/**
 * Returns list of ranges for Select Next/Previous CSS Item  action
 */
export function selectItemCSS(code: string, pos: number, isPrev?: boolean): SelectItemModel | void {
    return isPrev ? selectPreviousItem(code, pos) : selectNextItem(code, pos);
}

/**
 * Returns regions for selecting next item in CSS
 */
function selectNextItem(code: string, pos: number): SelectItemModel | void {
    let result: SelectItemModel | void = void 0;
    let pendingProperty: CSSTokenRange | void = void 0;

    scan(code, (type, start, end, delimiter) => {
        if (start < pos) {
            return;
        }

        if (type === TokenType.Selector) {
            result = { start, end, ranges: [[start, end]] };
            return false;
        } else if (type === TokenType.PropertyName) {
            pendingProperty = [start, end, delimiter];
        } else if (type === TokenType.PropertyValue) {
            result = {
                start,
                end: delimiter !== -1 ? delimiter + 1 : end,
                ranges: []
            };
            if (pendingProperty) {
                // Full property range
                result.start = pendingProperty[0];
                pushRange(result.ranges, [pendingProperty[0], result.end]);
            }

            // Full value range
            pushRange(result.ranges, [start, end]);

            // Value fragments
            for (const r of splitValue(code.substring(start, end))) {
                pushRange(result.ranges, [r[0] + start, r[1] + start]);
            }
            return false;
        } else if (pendingProperty) {
            result = {
                start: pendingProperty[0],
                end: pendingProperty[1],
                ranges: [[pendingProperty[0], pendingProperty[1]]]
            };
            return false;
        }
    });

    return result;
}

/**
 * Returns regions for selecting previous item in CSS
 */
function selectPreviousItem(code: string, pos: number): SelectItemModel | void {
    interface ParseState {
        type: TokenType | null;
        start: number;
        end: number;
        valueStart: number;
        valueEnd: number;
        valueDelimiter: number;
    }

    const state: ParseState = {
        type: null,
        start: -1,
        end: -1,
        valueStart: -1,
        valueEnd: -1,
        valueDelimiter: -1,
    };

    scan(code, (type, start, end, delimiter) => {
        // Accumulate context until we reach given position
        if (start >= pos && type !== TokenType.PropertyValue) {
            return false;
        }

        if (type === TokenType.Selector || type === TokenType.PropertyName) {
            state.start = start;
            state.end = end;
            state.type = type;
            state.valueStart = state.valueEnd = state.valueDelimiter = -1;
        } else if (type === TokenType.PropertyValue) {
            state.valueStart = start;
            state.valueEnd = end;
            state.valueDelimiter = delimiter;
        }
    });

    if (state.type === TokenType.Selector) {
        return {
            start: state.start,
            end: state.end,
            ranges: [[state.start, state.end]]
        };
    }

    if (state.type === TokenType.PropertyName) {
        const result: SelectItemModel = {
            start: state.start,
            end: state.end,
            ranges: []
        };

        if (state.valueStart !== -1) {
            result.end = state.valueDelimiter !== -1 ? state.valueDelimiter + 1 : state.valueEnd;
            // Full property range
            pushRange(result.ranges, [state.start, result.end]);

            // Full value range
            pushRange(result.ranges, [state.valueStart, state.valueEnd]);

            // Value fragments
            for (const r of splitValue(code.substring(state.valueStart, state.valueEnd))) {
                pushRange(result.ranges, [r[0] + state.valueStart, r[1] + state.valueStart]);
            }
        } else {
            pushRange(result.ranges, [state.start, state.end]);
        }

        return result;
    }
}

/**
 * Parses properties in `from:to` fragment of `code`. Note that `from:to` must
 * point to CSS section content, e.g. *inside* `{` and `}` (or top-level code context),
 * all properties found in nested sections will be ignored
 */
function parseProperties(code: string, from = 0, to = code.length): CSSProperty[] {
    const fragment = code.substring(from, to);
    const result: CSSProperty[] = [];
    const pool: CSSTokenRange[] = [];
    let pendingName: CSSTokenRange | void;
    let nested = 0;
    let before = from;

    scan(fragment, (type, start, end, delimiter) => {
        if (type === TokenType.Selector) {
            nested++;
        } else if (type === TokenType.BlockEnd) {
            nested--;
            before = from + end;
        } else if (!nested) {
            if (type === TokenType.PropertyName) {
                if (pendingName) {
                    // Create property with empty value
                    const valuePos = pendingName[2];
                    result.push(createProperty(fragment, pendingName, before, valuePos, valuePos, valuePos, from));
                    releaseRange(pool, pendingName);
                    before = from + start;
                }
                pendingName = allocRange(pool, start, end, delimiter);
            } else if (type === TokenType.PropertyValue) {
                if (pendingName) {
                    result.push(createProperty(fragment, pendingName, before, start, end, delimiter, from));
                    releaseRange(pool, pendingName);
                    pendingName = void 0;
                }
                before = from + delimiter + 1;
            }
        }
    });

    return result;
}

function createProperty(code: string, name: CSSTokenRange, before: number, start: number, end: number, delimiter: number, offset = 0): CSSProperty {
    return {
        name: [offset + name[0], offset + name[1]],
        value: [offset + start, offset + end],
        valueTokens: splitValue(code.substring(start, end), offset + start),
        before,
        after: offset + delimiter + 1,
    };
}

/**
 * Allocates new token range from pool
 */
function allocRange(pool: CSSTokenRange[], start: number, end: number, delimiter: number): CSSTokenRange {
    if (pool.length) {
        const range = pool.pop()!;
        range[0] = start;
        range[1] = end;
        range[2] = delimiter;
        return range;
    }
    return [start, end, delimiter];
}

/**
 * Releases given token range and pushes it back into the pool
 */
function releaseRange(pool: CSSTokenRange[], range?: CSSTokenRange) {
    range && pool.push(range);
    return null;
}
