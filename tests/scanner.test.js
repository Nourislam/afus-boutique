import { describe, it, expect, beforeEach } from 'vitest';
import { ScanDetector, usCharFromCode, azertyCharFromCode, charFromEvent } from '../src/lib/scanner';

// Physical key codes a scanner in US mode sends for a string
function usKeystrokes(text) {
    const shifted = { _: 'Minus', '.': 'Period' };
    return [...text].map((ch) => {
        if (/[A-Z]/.test(ch)) return { code: `Key${ch}`, shiftKey: true };
        if (/[a-z]/.test(ch)) return { code: `Key${ch.toUpperCase()}`, shiftKey: false };
        if (/[0-9]/.test(ch)) return { code: `Digit${ch}`, shiftKey: false };
        if (ch === '-') return { code: 'Minus', shiftKey: false };
        if (shifted[ch]) return { code: shifted[ch], shiftKey: ch === '_' };
        throw new Error(`no mapping for ${ch}`);
    });
}

// What Windows produces for those physical keys under a given layout
const AZERTY = {
    KeyA: 'q', KeyQ: 'a', KeyW: 'z', KeyZ: 'w', KeyM: ',', Minus: ')',
    Digit0: 'à', Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: "'", Digit5: '(', Digit6: '-', Digit7: 'è', Digit8: '_', Digit9: 'ç',
};
const ARABIC = { KeyT: 'ف', KeyS: 'س', KeyH: 'ا', KeyB: 'ل', KeyL: 'م', KeyK: 'ن', KeyM: 'ة', Minus: '-' };

function producedKey(stroke, layout) {
    if (layout === 'azerty' && AZERTY[stroke.code]) {
        const k = AZERTY[stroke.code];
        return stroke.shiftKey && /^Key/.test(stroke.code) ? k.toUpperCase() : k;
    }
    if (layout === 'arabic' && ARABIC[stroke.code]) return ARABIC[stroke.code];
    return usCharFromCode(stroke);
}

describe('US key code table', () => {
    it('maps letters, digits and punctuation independently of the OS layout', () => {
        expect(usCharFromCode({ code: 'KeyA', shiftKey: true })).toBe('A');
        expect(usCharFromCode({ code: 'KeyA', shiftKey: false })).toBe('a');
        expect(usCharFromCode({ code: 'KeyA', shiftKey: false, capsLock: true })).toBe('A');
        expect(usCharFromCode({ code: 'Digit1', shiftKey: false })).toBe('1');
        expect(usCharFromCode({ code: 'Numpad7', shiftKey: false })).toBe('7');
        expect(usCharFromCode({ code: 'Minus', shiftKey: false })).toBe('-');
        expect(usCharFromCode({ code: 'ArrowLeft', shiftKey: false })).toBeNull();
    });

    it("'os' mode uses the produced character", () => {
        expect(charFromEvent({ code: 'Digit1', key: '&', shiftKey: false }, 'os')).toBe('&');
        expect(charFromEvent({ code: 'Digit1', key: '&', shiftKey: false }, 'us')).toBe('1');
    });

    it("'azerty' mode decodes a scanner set to French while Windows uses another layout", () => {
        // An AZERTY scanner types "TSH-BLK-M" + digits with Shift on the top row
        const keys = [
            ['KeyT', true], ['KeyS', true], ['KeyH', true], ['Digit6', false], ['KeyQ', false], ['KeyW', true],
            ['Semicolon', true], ['Digit1', true], ['Digit0', true],
        ];
        const text = keys.map(([code, shiftKey]) => azertyCharFromCode({ code, shiftKey })).join('');
        expect(text).toBe('TSH-aZM10');
        expect(charFromEvent({ code: 'Digit2', key: 'ب', shiftKey: true }, 'azerty')).toBe('2');
    });
});

describe('ScanDetector', () => {
    let clock;
    let timers;
    let scans;
    let flushed;

    const make = (opts = {}) => new ScanDetector({
        onScan: (c) => scans.push(c),
        onFlush: (t) => flushed.push(t),
        now: () => clock,
        setTimer: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length - 1; },
        clearTimer: (id) => { if (timers[id]) timers[id].cancelled = true; },
        ...opts,
    });

    const runTimers = () => {
        for (const t of timers) {
            if (!t.cancelled && !t.done && t.at <= clock) { t.done = true; t.fn(); }
        }
    };

    function type(detector, text, { layout = 'us', interval = 8 } = {}) {
        const prevented = [];
        for (const stroke of usKeystrokes(text)) {
            clock += interval;
            runTimers();
            prevented.push(detector.handleKeyDown({ ...stroke, key: producedKey(stroke, layout) }));
        }
        return prevented;
    }

    function pressEnter(detector, delay = 8) {
        clock += delay;
        runTimers();
        return detector.handleKeyDown({ code: 'Enter', key: 'Enter' });
    }

    beforeEach(() => {
        clock = 1000;
        timers = [];
        scans = [];
        flushed = [];
    });

    it('detects a fast burst ending with Enter as one scan and swallows it', () => {
        const d = make();
        const prevented = type(d, 'TSH-BLK-M-001');
        expect(prevented.every(Boolean)).toBe(true);
        expect(pressEnter(d)).toBe(true);
        expect(scans).toEqual(['TSH-BLK-M-001']);
        expect(flushed).toEqual([]);
    });

    it('reads the code correctly while Windows uses a French AZERTY layout', () => {
        const d = make();
        type(d, 'TSH-BLK-M-001', { layout: 'azerty' });
        pressEnter(d);
        expect(scans).toEqual(['TSH-BLK-M-001']);
    });

    it('reads the code correctly while Windows uses an Arabic layout', () => {
        const d = make();
        type(d, 'TSH-BLK-M-001', { layout: 'arabic' });
        pressEnter(d);
        expect(scans).toEqual(['TSH-BLK-M-001']);
    });

    it('gives slow (human) typing back unchanged, in the typed layout', () => {
        const d = make();
        type(d, 'TSH', { layout: 'arabic', interval: 180 });
        clock += 200;
        runTimers();
        expect(scans).toEqual([]);
        expect(flushed.join('')).toBe('فسا');
    });

    it('does not treat a short fast burst as a scan', () => {
        const d = make({ minLength: 4 });
        type(d, 'ab');
        expect(pressEnter(d)).toBe(false);
        expect(scans).toEqual([]);
        expect(flushed).toEqual(['ab']);
    });

    it('supports scanners without a suffix key (end detected by a pause)', () => {
        const d = make({ suffix: 'none' });
        type(d, '6130000000017');
        clock += 200;
        runTimers();
        expect(scans).toEqual(['6130000000017']);
    });

    it('supports a Tab suffix', () => {
        const d = make({ suffix: 'tab' });
        type(d, 'ABC-123');
        clock += 5;
        expect(d.handleKeyDown({ code: 'Tab', key: 'Tab' })).toBe(true);
        expect(scans).toEqual(['ABC-123']);
    });

    it('never interferes with keyboard shortcuts or editing keys', () => {
        const d = make();
        expect(d.handleKeyDown({ code: 'KeyC', key: 'c', ctrlKey: true })).toBe(false);
        expect(d.handleKeyDown({ code: 'Backspace', key: 'Backspace' })).toBe(false);
        expect(d.handleKeyDown({ code: 'BracketLeft', key: 'Dead' })).toBe(false);
    });
    it('leaves Space to buttons when no scan is in progress', () => {
        const d = make();
        clock += 500;
        expect(d.handleKeyDown({ code: 'Space', key: ' ' })).toBe(false);
    });

    it('uses the time the key was pressed when events were queued', () => {
        const d = make();
        // The screen was busy: events are handled 200 ms late, but were pressed 8 ms apart
        let pressed = 1000;
        for (const stroke of usKeystrokes('SKU-123')) {
            clock += 200;
            pressed += 8;
            d.handleKeyDown({ ...stroke, key: producedKey(stroke, 'us'), timeStamp: pressed });
        }
        pressed += 8;
        expect(d.handleKeyDown({ code: 'Enter', key: 'Enter', timeStamp: pressed })).toBe(true);
        expect(scans).toEqual(['SKU-123']);
    });
});
