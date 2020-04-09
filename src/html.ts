import { scan, attributes, createOptions, ElementType, AttributeToken, ScannerOptions } from '@emmetio/html-matcher';
import { pushRange, SelectItemModel, TextRange, tokenList } from './utils';

export interface ContextTag {
    name: string;
    type: ElementType;
    start: number;
    end: number;
    attributes?: AttributeToken[];
}

export interface TagMatch {
    /** Tag name */
    name: string;
    /** Range of open tag */
    open: TextRange;
    /** Range of close tag */
    close?: TextRange;
}

/**
 * Check if there’s open or self-closing tag under given `pos` location in source code.
 * If found, returns its name, range in source and parsed attributes
 */
export function getOpenTag(code: string, pos: number): ContextTag | void {
    let tag: ContextTag | void = void 0;
    const opt = createOptions();

    // Find open or self-closing tag, closest to given position
    scan(code, (name, type, start, end) => {
        if (start < pos && end > pos) {
            tag = { name, type, start, end };
            if (type === ElementType.Open || type === ElementType.SelfClose) {
                tag.attributes = shiftAttributeRanges(attributes(code.slice(start, end), name), start);
            }

            return false;
        }
        if (end > pos) {
            return false;
        }
    }, opt.special);

    return tag;
}

/**
 * Returns list of matched tags in given source code
 */
export function getTagMatches(code: string, options?: Partial<ScannerOptions>): TagMatch[] {
    const opt = createOptions(options);
    const stack: TagMatch[] = [];
    const result: TagMatch[] = [];

    scan(code, (name, type, start, end) => {
        if (type === ElementType.SelfClose) {
            result.push({ name, open: [start, end] });
        } else if (type === ElementType.Open) {
            const item: TagMatch = { name, open: [start, end] };
            stack.push(item);
            result.push(item);
        } else {
            // Handle closing tag
            while (stack.length) {
                const item = stack.pop()!;
                if (item.name === name) {
                    item.close = [start, end];
                    break;
                }
            }
        }
    }, opt.special);

    return result;
}

/**
 * Finds tag match for given position
 */
export function findTagMatch(source: string | TagMatch[], pos: number, options?: Partial<ScannerOptions>): TagMatch | undefined {
    if (typeof source === 'string') {
        source = getTagMatches(source, options);
    }

    let candidate: TagMatch | undefined;
    source.some(match => {
        const start = match.open[0];
        const end = match.close ? match.close[1] : match.open[1];

        if (pos < start) {
            // All the following tags will be after given position, stop searching
            return true;
        }

        if (pos > start && pos < end) {
            candidate = match;
        }
    });

    return candidate;
}

/**
 * Returns list of ranges for Select Next/Previous Item action
 */
export function selectItemHTML(code: string, pos: number, isPrev?: boolean): SelectItemModel | void {
    return isPrev ? selectPreviousItem(code, pos) : selectNextItem(code, pos);
}

/**
 * Returns list of ranges for Select Next Item action
 */
function selectNextItem(code: string, pos: number): SelectItemModel | void {
    let result: SelectItemModel | void = void 0;
    const opt = createOptions();

    // Find open or self-closing tag, closest to given position
    scan(code, (name, type, start, end) => {
        if ((type === ElementType.Open || type === ElementType.SelfClose) && end > pos) {
            // Found open or self-closing tag
            result = getTagSelectionModel(code, name, start, end);
            return false;
        }
    }, opt.special);

    return result;
}

/**
 * Returns list of ranges for Select Previous Item action
 */
function selectPreviousItem(code: string, pos: number): SelectItemModel | void {
    const opt = createOptions();
    let lastType: ElementType | null = null;
    let lastName = '';
    let lastStart = -1;
    let lastEnd = -1;

    // We should find the closest open or self-closing tag left to given `pos`.
    scan(code, (name, type, start, end) => {
        if (start >= pos) {
            return false;
        }

        if (type === ElementType.Open || type === ElementType.SelfClose) {
            // Found open or self-closing tag
            lastName = name;
            lastType = type;
            lastStart = start;
            lastEnd = end;
        }
    }, opt.special);

    if (lastType !== null) {
        return getTagSelectionModel(code, lastName, lastStart, lastEnd);
    }
}

/**
 * Parses open or self-closing tag in `start:end` range of `code` and returns its
 * model for selecting items
 * @param code Document source code
 * @param name Name of matched tag
 */
function getTagSelectionModel(code: string, name: string, start: number, end: number): SelectItemModel {
    const ranges: TextRange[] = [
        // Add tag name range
        [start + 1, start + 1 + name.length]
    ];

    // Parse and add attributes ranges
    const tagSrc = code.slice(start, end);
    for (const attr of attributes(tagSrc, name)) {
        if (attr.value != null) {
            // Attribute with value
            pushRange(ranges, [start + attr.nameStart, start + attr.valueEnd!]);

            // Add (unquoted) value range
            const val = valueRange(attr);
            if (val[0] !== val[1]) {
                pushRange(ranges, [start + val[0], start + val[1]]);

                if (attr.name === 'class') {
                    // For class names, split value into space-separated tokens
                    const tokens = tokenList(tagSrc.slice(val[0], val[1]), start + val[0]);
                    for (const token of tokens) {
                        pushRange(ranges, token);
                    }
                }
            }
        } else {
            // Attribute without value (boolean)
            pushRange(ranges, [start + attr.nameStart, start + attr.nameEnd]);
        }
    }

    return { start, end, ranges };
}

/**
 * Returns value range of given attribute. Value range is unquoted.
 */
function valueRange(attr: AttributeToken): TextRange {
    const value = attr.value!;
    const ch = value[0];
    const lastCh = value[value.length - 1];
    if (ch === '"' || ch === '\'') {
        return [
            attr.valueStart! + 1,
            attr.valueEnd! - (lastCh === ch ? 1 : 0)
        ];
    }

    if (ch === '{' && lastCh === '}') {
        return [
            attr.valueStart! + 1,
            attr.valueEnd! - 1
        ];
    }

    return [attr.valueStart!, attr.valueEnd!];
}

function shiftAttributeRanges(attrs: AttributeToken[], offset: number): AttributeToken[] {
    attrs.forEach(attr => {
        attr.nameStart += offset;
        attr.nameEnd += offset;
        if ('value' in attr) {
            attr.valueStart! += offset;
            attr.valueEnd! += offset;
        }
    });
    return attrs;
}
