import { useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';

/**
 * USB scanner settings with a live test area. Works with standard
 * keyboard-wedge (HID keyboard) barcode/QR scanners; no vendor SDK needed.
 */
export function ScannerSettingsForm({ value, onChange }) {
    const [lastScan, setLastScan] = useState(null);
    const set = (key, v) => onChange({ ...value, [key]: v });

    // Test with the settings being edited (not yet saved)
    useBarcodeScanner((code) => setLastScan({ code, at: new Date() }), { settingsOverride: value });

    return (
        <div className="space-y-6">
            <label className="flex items-center gap-3 cursor-pointer">
                <input
                    type="checkbox"
                    checked={!!value.enabled}
                    onChange={(e) => set('enabled', e.target.checked)}
                    className="w-4 h-4 rounded bg-dark-tertiary border-dark-border"
                />
                <span className="text-sm">Enable USB barcode / QR scanner</span>
            </label>

            <div className="grid grid-cols-2 gap-4">
                <Select
                    label="Key sent after each code (suffix)"
                    value={value.suffix}
                    onChange={(v) => set('suffix', v)}
                    options={[
                        { value: 'enter', label: 'Enter (most scanners)' },
                        { value: 'tab', label: 'Tab' },
                        { value: 'none', label: 'Nothing (detect end by pause)' },
                    ]}
                />
                <Select
                    label="Keyboard layout handling"
                    value={value.layoutMode}
                    onChange={(v) => set('layoutMode', v)}
                    options={[
                        { value: 'us', label: 'Scanner in US mode (recommended, works with Arabic/French Windows)' },
                        { value: 'os', label: 'Use the Windows keyboard layout' },
                    ]}
                />
                <Input
                    label="Max time between characters (ms)"
                    type="number"
                    min="10"
                    max="200"
                    value={value.maxKeyIntervalMs}
                    onChange={(e) => set('maxKeyIntervalMs', parseInt(e.target.value, 10) || 50)}
                />
                <Input
                    label="Minimum code length"
                    type="number"
                    min="1"
                    max="20"
                    value={value.minLength}
                    onChange={(e) => set('minLength', parseInt(e.target.value, 10) || 3)}
                />
            </div>
            <p className="text-xs text-zinc-500">
                Increase the time between characters if scans are sometimes typed as text (slow scanners or Bluetooth),
                decrease it if fast typing is mistaken for a scan.
            </p>

            <div className="p-4 rounded-lg bg-dark-tertiary border border-dark-border">
                <div className="flex items-center gap-2 font-medium mb-2"><ScanLine className="w-4 h-4" /> Test your scanner</div>
                <p className="text-sm text-zinc-400 mb-3">Scan any barcode or QR label now (no need to click anywhere).</p>
                {lastScan ? (
                    <div className="font-mono text-lg text-green-400 break-all">{lastScan.code}</div>
                ) : (
                    <div className="text-sm text-zinc-500">{value.enabled ? 'Waiting for a scan…' : 'Scanner is disabled.'}</div>
                )}
            </div>
        </div>
    );
}

export default ScannerSettingsForm;
