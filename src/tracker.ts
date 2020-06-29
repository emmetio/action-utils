import expand, {
    stylesheetAbbreviation, markupAbbreviation,
    UserConfig, MarkupAbbreviation, StylesheetAbbreviation, Options, CSSAbbreviationScope, SyntaxType
} from 'emmet';
import { TokenType } from '@emmetio/css-matcher';
import { getHTMLContext, getCSSContext, getEmbeddedStyleSyntax, CSSContext, getMarkupAbbreviationContext, getStylesheetAbbreviationContext } from './context';
import { pairsEnd, TextRange, pairs } from './utils';

export const JSX_PREFIX = '<';

const reJSXAbbrStart = /^[a-zA-Z.#\[\(]$/;
const reWordBound = /^[\s>;"\']?[a-zA-Z.#!@\[\(]$/;
const reStylesheetWordBound = /^[\s;"\']?[a-zA-Z!@]$/;

/**
 * Minimal editor proxy interface required by abbreviation tracker
 */
export interface EditorProxy {
    /** Unique editor instance identifier */
    id: string;

    /**
     * Return substring from underlying editor instance.
     * If both `from` and `to` are not specified, should return entire document
     * contents. If only `from` specified, should return substring starting at
     * `from` index until the end of document
     */
    substr(from?: number, to?: number): string;

    /**
     * Replaces contents in `from:to` range in editor with `value`
     */
    replace(value: string, from?: number, to?: number): void;

    /**
     * Document syntax of underlying document
     */
    syntax(): string;

    /**
     * Content size of underlying document
     */
    size(): number;

    /**
     * Return Emmet config for given character position in editor
     */
    config(pos: number): UserConfig;

    /**
     * Return output options for given location in editor
     */
    outputOptions(pos: number, inline?: boolean): Partial<Options>;

    /**
     * Creates Emmet config for displaying preview of parsed abbreviation
     */
    previewConfig(config: UserConfig): UserConfig;

    /**
     * Mark given abbreviation tracker in editor
     */
    mark(tracker: AbbreviationTracker): void;

    /**
     * Remove mark for given tracker in editor
     */
    unmark(tracker: AbbreviationTracker): void;

    /**
     * Check if it’s allowed to track abbreviation at given location in editor
     */
    allowTracking(pos: number): boolean;

    /**
     * Returns Emmet abbreviation type for given syntax
     */
    syntaxType(syntax: string): SyntaxType;

    /**
     * Check if given syntax is a CSS dialect, e.g. has similar to CSS syntax.
     * For example, SCSS has the same syntax as CSS, but Sass isn’t since it’s
     * indent-based.
     */
    isCSS(syntax: string): boolean;

    /**
     * Check if given syntax is a HTML dialect. HTML dialects also support embedded
     * stylesheets in `<style>` tga or `style=""` attribute
     */
    isHTML(syntax: string): boolean;

    /**
     * Check if given syntax is a XML dialect. Unlike HTML, XML dialects doesn’t
     * support embedded stylesheets
     */
    isXML(syntax: string): boolean;

    /**
     * Check if given syntax is a JSX dialect
     */
    isJSX(syntax: string): boolean;
}

export const enum AbbreviationTrackerType {
    Abbreviation = 'abbreviation',
    Error = 'error'
}

export interface AbbreviationError {
    message: string,
    pos: number
}

export type AbbreviationTracker = AbbreviationTrackerValid | AbbreviationTrackerError;

export interface AbbreviationTrackerBase {
    /**
     * Range in editor for abbreviation
     */
    range: TextRange;

    /** Actual abbreviation, tracked by current tracker */
    abbreviation: string;

    /**
     * Abbreviation was forced, e.g. must remain in editor even if empty or contains
     * invalid abbreviation
     */
    forced: boolean;

    /**
     * Relative offset from range start where actual abbreviation starts.
     * Used tp handle prefixes in abbreviation
     */
    offset: number;

    /** Last character location in editor */
    lastPos: number;

    /** Last editor size */
    lastLength: number;

    config: UserConfig;
}

export interface AbbreviationTrackerValid extends AbbreviationTrackerBase {
    type: AbbreviationTrackerType.Abbreviation;

    /**
     * Abbreviation is simple, e.g. contains single element.
     * It’s suggested to not display preview for simple abbreviation
     */
    simple: boolean;

    /**
     * Preview of expanded abbreviation
     */
    preview: string;
}

export interface AbbreviationTrackerError extends AbbreviationTrackerBase {
    type: AbbreviationTrackerType.Error;
    error: AbbreviationError;
}

export interface StartTrackingParams {
    config: UserConfig;
    offset?: number;
    forced?: boolean;
}

export interface StopTrackingParams {
    /** Do not remove contents of force-tracked abbreviation */
    skipRemove?: boolean;

    /** Forced tracker remove, do not add it to history */
    force?: boolean;
}

/**
 * Controller for tracking Emmet abbreviations in editor as user types.
 * Controller designed to be extended ad-hoc in editor plugins, overriding some
 * methods `mark()` to match editor behavior
 */
export class AbbreviationTrackingController<E extends EditorProxy> {
    private cache = new Map<string, AbbreviationTracker>();
    private trackers = new Map<string, AbbreviationTracker>();
    private lastPos = new Map<string, number>();

    /**
     * Returns last known location of caret in given editor
     */
    getLastPost(editor: E): number | undefined {
        return this.lastPos.get(editor.id);
    }

    /**
     * Sets last known caret location for given editor
     */
    setLastPos(editor: E, pos: number): void {
        this.lastPos.set(editor.id, pos);
    }

    /**
     * Returns abbreviation tracker for given editor, if any
     */
    getTracker(editor: E): AbbreviationTracker | undefined {
        return this.trackers.get(editor.id);
    }

    /**
     * Detects if user is typing abbreviation at given location
     */
    typingAbbreviation(editor: E, pos: number): AbbreviationTracker | undefined {
        // Start tracking only if user starts abbreviation typing: entered first
        // character at the word bound
        // NB: get last 2 characters: first should be a word bound(or empty),
        // second must be abbreviation start
        const prefix = editor.substr(Math.max(0, pos - 2), pos);
        const syntax = editor.syntax();
        let start = -1
        let end = pos;
        let offset = 0;

        if (editor.isJSX(syntax)) {
            // In JSX, abbreviations should be prefixed
            if (prefix.length === 2 && prefix[0] === JSX_PREFIX && reJSXAbbrStart.test(prefix[1])) {
                start = pos - 2;
                offset = JSX_PREFIX.length;
            }
        } else if (reWordBound.test(prefix)) {
            start = pos - 1;
        }

        if (start >= 0) {
            // Check if there’s paired character
            const lastCh = prefix[prefix.length - 1];
            if (lastCh in pairs && editor.substr(pos, pos + 1) === pairs[lastCh]) {
                end++;
            }

            const config = this.getActivationContext(editor, pos);
            if (config) {
                if (config.type === 'stylesheet' && !reStylesheetWordBound.test(prefix)) {
                    // Additional check for stylesheet abbreviation start: it’s slightly
                    // differs from markup prefix, but we need activation context
                    // to ensure that context under caret is CSS
                    return;
                }

                const tracker = this.startTracking(editor, start, end, { offset, config });
                if (tracker && tracker.type === AbbreviationTrackerType.Abbreviation && config.context?.name === CSSAbbreviationScope.Section) {
                    // Make a silly check for section context: if user start typing
                    // CSS selector at the end of file, it will be treated as property
                    // name and provide unrelated completion by default.
                    // We should check if captured abbreviation actually matched
                    // snippet to continue. Otherwise, ignore this abbreviation.
                    // By default, unresolved abbreviations are converted to CSS properties,
                    // e.g. `a` → `a: ;`. If that’s the case, stop tracking
                    const { abbreviation, preview } = tracker;
                    if (preview.startsWith(abbreviation) && /^:\s*;?$/.test(preview.slice(abbreviation.length))) {
                        this.stopTracking(editor);
                        return;
                    }
                }

                return tracker;
            }
        }
    }

    /**
     * Starts abbreviation tracking for given editor
     * @param start Location of abbreviation start
     * @param pos Current caret position, must be greater that `start`
     */
    startTracking(editor: E, start: number, pos: number, params?: Partial<StartTrackingParams>): AbbreviationTracker | undefined {
        const config = params?.config || editor.config(start);
        const tracker = this.createTracker(editor, [start, pos], { config, ...params });

        if (tracker) {
            this.trackers.set(editor.id, tracker);
            return tracker;
        }

        this.trackers.delete(editor.id);
    }

    /**
     * Stops abbreviation tracking in given editor instance
     */
    stopTracking(editor: E, params?: StopTrackingParams) {
        const tracker = this.getTracker(editor);
        if (tracker) {
            editor.unmark(tracker);
            if (tracker.forced && !params?.skipRemove) {
                // Contents of forced abbreviation must be removed
                editor.replace('', tracker.range[0], tracker.range[1]);
            }

            if (params?.force) {
                this.cache.delete(editor.id);
            } else {
                // Store tracker in history to restore it if user continues editing
                this.storeTracker(editor, tracker);
            }

            this.trackers.delete(editor.id);
        }
    }

    /**
     * Creates abbreviation tracker for given range in editor. Parses contents
     * of abbreviation in range and returns either valid abbreviation tracker,
     * error tracker or `null` if abbreviation cannot be created from given range
     */
    createTracker(editor: E, range: TextRange, params: StartTrackingParams): AbbreviationTracker | null {
        if (range[0] >= range[1]) {
            // Invalid range
            return null;
        }

        let abbreviation = editor.substr(range[0], range[1]);
        const { config } = params;
        if (params.offset) {
            abbreviation = abbreviation.slice(params.offset);
        }

        // Basic validation: do not allow empty abbreviations
        // or newlines in abbreviations
        if (!abbreviation || /[\r\n]/.test(abbreviation)) {
            return null;
        }

        const base: AbbreviationTrackerBase = {
            abbreviation,
            range,
            config,
            forced: !!params.forced,
            offset: params.offset || 0,
            lastPos: range[1],
            lastLength: editor.size(),
        }

        try {
            let parsedAbbr: MarkupAbbreviation | StylesheetAbbreviation | undefined;
            let simple = false;

            if (config.type === 'stylesheet') {
                parsedAbbr = stylesheetAbbreviation(abbreviation);
            } else {
                parsedAbbr = markupAbbreviation(abbreviation, {
                    jsx: config.syntax === 'jsx'
                });
                simple = this.isSimpleMarkupAbbreviation(parsedAbbr);
            }

            const previewConfig = editor.previewConfig(config);
            return {
                ...base,
                type: AbbreviationTrackerType.Abbreviation,
                simple,
                preview: expand(parsedAbbr as unknown as string, previewConfig),
            };
        } catch (error) {
            return {
                ...base,
                type: AbbreviationTrackerType.Error,
                error,
            };
        }
    }

    /**
     * Stores given tracker in separate cache to restore later
     */
    storeTracker(editor: E, tracker: AbbreviationTracker) {
        this.cache.set(editor.id, tracker);
    }

    /**
     * Returns stored tracker for given editor proxy, if any
     */
    getStoredTracker(editor: E): AbbreviationTracker | undefined {
        return this.cache.get(editor.id);
    }

    /**
     * Tries to restore abbreviation tracker for given editor at specified position
     */
    restoreTracker(editor: E, pos: number): AbbreviationTracker | undefined {
        const tracker = this.getStoredTracker(editor);

        if (tracker && tracker.range[0] <= pos && tracker.range[1] >= pos) {
            // Tracker can be restored at given location. Make sure it’s contents matches
            // contents of editor at the same location. If it doesn’t, reset stored tracker
            // since it’s not valid anymore
            this.cache.delete(editor.id);
            const [from, to] = tracker.range;

            if (editor.substr(from + tracker.offset, to) === tracker.abbreviation) {
                this.trackers.set(editor.id, tracker);
                return tracker;
            }
        }
    }

    /**
     * Handle content change in given editor instance
     */
    handleChange(editor: E, pos: number): AbbreviationTracker | undefined {
        const tracker = this.getTracker(editor);
        const editorLastPos = this.getLastPost(editor);
        this.setLastPos(editor, pos);

        if (!tracker) {
            // No active tracker, check if we user is actually typing it
            if (editorLastPos != null && editorLastPos === pos - 1 && editor.allowTracking(pos)) {
                return this.typingAbbreviation(editor, pos);
            }
            return;
        }

        const { lastPos } = tracker;
        let { range } = tracker;

        if (lastPos < range[0] || lastPos > range[1]) {
            // Updated content outside abbreviation: reset tracker
            this.stopTracking(editor);
            return;
        }

        const length = editor.size();
        const delta = length - tracker.lastLength;
        range = range.slice() as TextRange;

        // Modify range and validate it: if it leads to invalid abbreviation, reset tracker
        updateRange(range, delta, lastPos);

        // Handle edge case: empty forced abbreviation is allowed
        if (range[0] === range[1] && tracker.forced) {
            tracker.abbreviation = '';
            return tracker;
        }

        const nextTracker = this.createTracker(editor, range, tracker);

        if (!nextTracker || (!tracker.forced && !isValidTracker(nextTracker, range, pos))) {
            this.stopTracking(editor);
            return;
        }

        nextTracker.lastPos = pos;
        this.trackers.set(editor.id, nextTracker);
        editor.mark(nextTracker);

        return nextTracker;
    }

    /**
     * Handle selection (caret) change in given editor instance
     */
    handleSelectionChange(editor: E, pos: number): AbbreviationTracker | undefined {
        this.setLastPos(editor, pos);
        const tracker = this.getTracker(editor) || this.restoreTracker(editor, pos);
        if (tracker) {
            tracker.lastPos = pos;
            return tracker;
        }
    }

    /**
     * Detects and returns valid abbreviation activation context for given location
     * in editor which can be used for abbreviation expanding.
     * For example, in given HTML code:
     * `<div title="Sample" style="">Hello world</div>`
     * it’s not allowed to expand abbreviations inside `<div ...>` or `</div>`,
     * yet it’s allowed inside `style` attribute and between tags.
     *
     * This method ensures that given `pos` is inside location allowed for expanding
     * abbreviations and returns context data about it.
     *
     * Default implementation works for any editor since it uses own parsers for HTML
     * and CSS but might be slow: if your editor supports low-level access to document
     * parse tree or tokens, authors should override this method and provide alternative
     * based on editor native features.
     */
    getActivationContext(editor: E, pos: number): UserConfig | undefined {
        const syntax = editor.syntax();
        const content = editor.substr();

        if (editor.isCSS(syntax)) {
            return this.getCSSActivationContext(editor, pos, syntax, getCSSContext(content, pos));
        }

        if (editor.isHTML(syntax)) {
            const ctx = getHTMLContext(content, pos, { xml: editor.isXML(syntax) });

            if (ctx.css) {
                return this.getCSSActivationContext(editor, pos, getEmbeddedStyleSyntax(content, ctx) || 'css', ctx.css);
            }

            if (!ctx.current) {
                return {
                    syntax,
                    type: 'markup',
                    context: getMarkupAbbreviationContext(content, ctx),
                    options: editor.outputOptions(pos)
                };
            }
        } else {
            return {
                syntax,
                type: editor.syntaxType(syntax)
            };
        }
    }

    getCSSActivationContext(editor: E, pos: number, syntax: string, ctx: CSSContext): UserConfig | undefined {
        // CSS abbreviations can be activated only when a character is entered, e.g.
        // it should be either property name or value.
        // In come cases, a first character of selector should also be considered
        // as activation context
        if (!ctx.current) {
            return void 0;
        }

        const allowedContext = ctx.current.type === TokenType.PropertyName
            || ctx.current.type === TokenType.PropertyValue
            || this.isTypingBeforeSelector(editor, pos, ctx);

        if (allowedContext) {
            return {
                syntax,
                type: 'stylesheet',
                context: getStylesheetAbbreviationContext(ctx),
                options: editor.outputOptions(pos, ctx.inline)
            };
        }
    }

    /**
     * Handle edge case: start typing abbreviation before selector. In this case,
     * entered character becomes part of selector
     * Activate only if it’s a nested section and it’s a first character of selector
     */
    isTypingBeforeSelector(editor: E, pos: number, { current }: CSSContext): boolean {
        if (current && current.type === TokenType.Selector && current.range[0] === pos - 1) {
            // Typing abbreviation before selector is tricky one:
            // ensure it’s on its own line
            const line = editor.substr(current.range[0], current.range[1]).split(/[\n\r]/)[0];
            return line.trim().length === 1;
        }

        return false;
    }

    /**
     * Check if given parsed markup abbreviation is simple.A simple abbreviation
     * may not be displayed to user as preview to reduce distraction
     */
    isSimpleMarkupAbbreviation(abbr: MarkupAbbreviation): boolean {
        if (abbr.children.length === 1 && !abbr.children[0].children.length) {
            // Single element: might be a HTML element or text snippet
            const first = abbr.children[0];
            // XXX silly check for common snippets like `!`. Should read contents
            // of expanded abbreviation instead
            return !first.name || /^[a-z]/i.test(first.name);
        }
        return !abbr.children.length;
    }

    /**
     * Method should be called when given editor instance will be no longer
     * available to clean up cached data
     */
    disposeEditor(editor: E) {
        this.cache.delete(editor.id);
        this.trackers.delete(editor.id);
        this.lastPos.delete(editor.id);
    }
}

function updateRange(range: TextRange, delta: number, lastPos: number): TextRange {
    if (delta < 0) {
        // Content removed
        if (lastPos === range[0]) {
            // Updated content at the abbreviation edge
            range[0] += delta;
            range[1] += delta;
        } else if (range[0] < lastPos && lastPos <= range[1]) {
            range[1] += delta;
        }
    } else if (delta > 0 && range[0] <= lastPos && lastPos <= range[1]) {
        // Content inserted
        range[1] += delta;
    }

    return range;
}

/**
 * Check if given tracker is in valid state for keeping it marked
 */
function isValidTracker(tracker: AbbreviationTracker, range: TextRange, pos: number): boolean {
    if (tracker.type === AbbreviationTrackerType.Error) {
        if (range[1] === pos) {
            // Last entered character is invalid
            return false;
        }

        const { abbreviation } = tracker;
        const start = range[0];
        let targetPos = range[1];
        while (targetPos > start) {
            if (pairsEnd.includes(abbreviation[targetPos - start - 1])) {
                targetPos--;
            } else {
                break;
            }
        }

        return targetPos !== pos;
    }

    return true;
}
