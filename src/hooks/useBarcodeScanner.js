import { useEffect, useRef } from 'react';
import { ScanDetector } from '../lib/scanner';
import { DEFAULT_SCANNER_SETTINGS } from '../lib/shopSettings';

function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.tagName === 'INPUT') {
        const type = (el.type || 'text').toLowerCase();
        return !el.readOnly && !el.disabled && !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(type);
    }
    return false;
}

// Put characters held back by the detector into the field the user is typing in.
function insertText(text) {
    const el = document.activeElement;
    if (!isEditable(el)) return;
    // execCommand keeps the caret position and fires the input event React listens to
    if (!document.execCommand('insertText', false, text)) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next = el.value.slice(0, start) + text + el.value.slice(end);
        if (setter) setter.call(el, next); else el.value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

async function loadScannerSettings() {
    try {
        const saved = await window.electronAPI.settings.get('scanner_settings');
        return { ...DEFAULT_SCANNER_SETTINGS, ...(saved || {}) };
    } catch {
        return { ...DEFAULT_SCANNER_SETTINGS };
    }
}

/**
 * Listen for a USB keyboard-wedge scanner (barcode or QR) anywhere on the page.
 *
 * @param {(code: string) => void} onScan called with the scanned code
 * @param {object} [options]
 * @param {() => boolean} [options.isActive] return false to ignore scans (e.g. while a dialog is open)
 * @param {object} [options.settingsOverride] use these scanner settings instead of the saved ones
 *
 * Elements (or their ancestors) marked with `data-scan-passthrough` receive
 * scanner input as normal typing, e.g. a field where a code should be typed in.
 */
export function useBarcodeScanner(onScan, { isActive, settingsOverride } = {}) {
    const onScanRef = useRef(onScan);
    const isActiveRef = useRef(isActive);
    onScanRef.current = onScan;
    isActiveRef.current = isActive;

    useEffect(() => {
        let detector = null;
        let settings = null;
        let disposed = false;

        const build = async () => {
            settings = settingsOverride || await loadScannerSettings();
            if (disposed) return;
            detector?.reset();
            detector = new ScanDetector({
                ...settings,
                onScan: (code) => onScanRef.current?.(code),
                onFlush: insertText,
            });
        };

        const handleKeyDown = (event) => {
            if (!detector || !settings?.enabled) return;
            if (event.repeat) return;
            if (isActiveRef.current && !isActiveRef.current()) return;
            if (event.target?.closest?.('[data-scan-passthrough]')) return;
            if (detector.handleKeyDown(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
        };

        const handleSettingsChanged = () => { if (!settingsOverride) build(); };

        build();
        // Capture phase: see the keys before inputs and other handlers do
        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('pos:settings-changed', handleSettingsChanged);
        return () => {
            disposed = true;
            detector?.reset();
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('pos:settings-changed', handleSettingsChanged);
        };
    }, [settingsOverride]);
}

export default useBarcodeScanner;
