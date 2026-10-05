import { t } from '../../i18n';
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
                <span className="text-sm">{t('scanner.enable')}</span>
            </label>

            <div className="grid grid-cols-2 gap-4">
                <Select
                    label={t('scanner.suffix')}
                    value={value.suffix}
                    onChange={(v) => set('suffix', v)}
                    options={[
                        { value: 'enter', label: t('scanner.enter') },
                        { value: 'tab', label: 'Tab' },
                        { value: 'none', label: t('scanner.none') },
                    ]}
                />
                <Select
                    label={t('scanner.layout')}
                    value={value.layoutMode}
                    onChange={(v) => set('layoutMode', v)}
                    options={[
                        { value: 'us', label: t('scanner.layoutUs') },
                        { value: 'azerty', label: t('scanner.layoutAzerty') },
                        { value: 'os', label: t('scanner.layoutOs') },
                    ]}
                />
                <p className="form-hint col-span-full -mt-2">{t('scanner.layoutHint')}</p>
                <Input
                    label={t('scanner.interval')}
                    type="number"
                    min="10"
                    max="200"
                    value={value.maxKeyIntervalMs}
                    onChange={(e) => set('maxKeyIntervalMs', parseInt(e.target.value, 10) || 50)}
                />
                <Input
                    label={t('scanner.minLength')}
                    type="number"
                    min="1"
                    max="20"
                    value={value.minLength}
                    onChange={(e) => set('minLength', parseInt(e.target.value, 10) || 3)}
                />
            </div>
            <p className="text-xs text-zinc-500">
                {t('scanner.intervalHint')}
            </p>

            <div className="p-4 rounded-lg bg-dark-tertiary border border-dark-border">
                <div className="flex items-center gap-2 font-medium mb-2"><ScanLine className="w-4 h-4" /> {t('scanner.test')}</div>
                <p className="text-sm text-zinc-400 mb-3">{t('scanner.testHint')}</p>
                {lastScan ? (
                    <div className="font-mono text-lg text-green-400 break-all">{lastScan.code}</div>
                ) : (
                    <div className="text-sm text-zinc-500">{value.enabled ? t('scanner.waiting') : t('scanner.disabled')}</div>
                )}
            </div>
        </div>
    );
}

export default ScannerSettingsForm;
