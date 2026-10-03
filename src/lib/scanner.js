/**
 * Keyboard-wedge barcode / QR scanner support.
 *
 * Standard USB scanners behave like a keyboard: they "type" the code very fast
 * and usually finish with Enter. This module tells such bursts apart from a
 * person typing and turns them into a single scan event.
 *
 * Keyboard layouts: most scanners type as if a US keyboard were attached. When
 * Windows uses an Arabic, French (AZERTY) or other layout, the characters the
 * OS produces are wrong (e.g. "&é" instead of "12", or Arabic letters). In the
 * default 'us' mode we therefore read the *physical* key (KeyboardEvent.code)
 * and translate it with a US table, which recovers the code exactly whatever
 * the active Windows layout is. The 'os' mode uses the produced characters
 * (for scanners configured for the same layout as Windows).
 */

const US_SHIFTED_DIGITS = ')!@#$%^&*(';

const US_PUNCTUATION = {
    Minus: ['-', '_'],
    Equal: ['=', '+'],
    BracketLeft: ['[', '{'],
    BracketRight: [']', '}'],
    Backslash: ['\\', '|'],
    IntlBackslash: ['\\', '|'],
    Semicolon: [';', ':'],
    Quote: ["'", '"'],
    Comma: [',', '<'],
    Period: ['.', '>'],
    Slash: ['/', '?'],
    Backquote: ['`', '~'],
    Space: [' ', ' '],
    NumpadDecimal: ['.', '.'],
    NumpadSubtract: ['-', '-'],
    NumpadAdd: ['+', '+'],
    NumpadMultiply: ['*', '*'],
    NumpadDivide: ['/', '/'],
};

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'OS']);

/**
 * Character a key would produce on a US keyboard, or null for non-printing keys.
 * @param {{code: string, shiftKey: boolean, capsLock?: boolean}} event
 */
export function usCharFromCode({ code, shiftKey, capsLock = false }) {
    if (!code) return null;
    let m = /^Key([A-Z])$/.exec(code);
    if (m) {
        const upper = shiftKey !== capsLock;
        return upper ? m[1] : m[1].toLowerCase();
    }
    m = /^Digit([0-9])$/.exec(code);
    if (m) return shiftKey ? US_SHIFTED_DIGITS[Number(m[1])] : m[1];
    m = /^Numpad([0-9])$/.exec(code);
    if (m) return m[1];
    const punct = US_PUNCTUATION[code];
    if (punct) return shiftKey ? punct[1] : punct[0];
    return null;
}

/** Character for an event according to the chosen layout mode. */
export function charFromEvent(event, layoutMode = 'us') {
    if (layoutMode === 'us') {
        const capsLock = typeof event.getModifierState === 'function' ? event.getModifierState('CapsLock') : !!event.capsLock;
        const ch = usCharFromCode({ code: event.code, shiftKey: event.shiftKey, capsLock });
        if (ch !== null) return ch;
    }
    return typeof event.key === 'string' && event.key.length === 1 ? event.key : null;
}

function isSuffixKey(event, suffix) {
    if (suffix === 'enter') return event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter';
    if (suffix === 'tab') return event.key === 'Tab' || event.code === 'Tab';
    return false;
}

/**
 * State machine that receives keydown events and reports scans.
 *
 * Characters that may belong to a scan are swallowed (the caller should call
 * preventDefault) and, if the burst turns out to be normal typing, handed back
 * through onFlush so they can be inserted where the user was typing. A person
 * typing therefore never loses characters; they are only delayed by
 * maxKeyIntervalMs.
 */
export class ScanDetector {
    constructor({
        onScan,
        onFlush = () => { },
        maxKeyIntervalMs = 50,
        minLength = 3,
        suffix = 'enter',
        layoutMode = 'us',
        now = () => Date.now(),
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = (id) => clearTimeout(id),
    }) {
        this.onScan = onScan;
        this.onFlush = onFlush;
        this.maxKeyIntervalMs = Math.max(10, Number(maxKeyIntervalMs) || 50);
        this.minLength = Math.max(1, Number(minLength) || 3);
        this.suffix = suffix;
        this.layoutMode = layoutMode;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        // `buffer` is what a scanner meant (layout-corrected); `typed` is what
        // the keyboard actually produced, which is what a person meant.
        this.buffer = '';
        this.typed = '';
        this.lastTime = 0;
        this.timer = null;
    }

    reset() {
        this.buffer = '';
        this.typed = '';
        this.lastTime = 0;
        if (this.timer !== null) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
    }

    /** Give back swallowed characters (it was a person typing). */
    flush() {
        const text = this.typed;
        this.reset();
        if (text) this.onFlush(text);
    }

    complete() {
        const code = this.buffer;
        const typed = this.typed;
        this.reset();
        if (code.length >= this.minLength) {
            this.onScan(code);
            return true;
        }
        if (typed) this.onFlush(typed);
        return false;
    }

    armTimer() {
        if (this.timer !== null) this.clearTimer(this.timer);
        // Without a suffix key the end of a scan is the first pause; with a
        // suffix, a pause means it was not a scan.
        const wait = this.suffix === 'none' ? this.maxKeyIntervalMs * 2 : this.maxKeyIntervalMs + 5;
        this.timer = this.setTimer(() => {
            this.timer = null;
            if (this.suffix === 'none') this.complete();
            else this.flush();
        }, wait);
    }

    /**
     * @returns {boolean} true when the caller must preventDefault() the event
     */
    handleKeyDown(event) {
        if (MODIFIER_KEYS.has(event.key)) return false;

        // Input-method composition and dead keys (e.g. French ^ and ¨) are a
        // person typing: never interfere with them.
        if (event.isComposing || event.key === 'Dead' || event.key === 'Process') {
            this.flush();
            return false;
        }

        if (event.ctrlKey || event.altKey || event.metaKey) {
            this.flush();
            return false;
        }

        const t = this.now();

        if (isSuffixKey(event, this.suffix)) {
            if (this.buffer && t - this.lastTime <= this.maxKeyIntervalMs * 2) {
                return this.complete();
            }
            this.flush();
            return false;
        }

        const ch = charFromEvent(event, this.layoutMode);
        const typedChar = typeof event.key === 'string' && event.key.length === 1 ? event.key : null;
        if (ch === null) {
            // Arrows, Backspace, Escape...: definitely a person
            this.flush();
            return false;
        }

        if (this.buffer && t - this.lastTime > this.maxKeyIntervalMs) {
            // Too slow to be the same scan: return what we held, start again
            this.flush();
        }
        this.buffer += ch;
        this.typed += typedChar || '';
        this.lastTime = t;
        this.armTimer();
        return true;
    }
}
