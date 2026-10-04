import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { ShopLogo } from '../shop/ShopLogo';
import { useT } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';

const PLATFORM = typeof window !== 'undefined' ? window.electronAPI?.platform : undefined;

/**
 * Title bar. The window buttons are the system's own (macOS traffic lights
 * on the left, Windows/Linux buttons on the right), drawn by Electron over
 * this bar, so they never appear twice. Their space is kept free with a
 * physical padding that does not flip in Arabic.
 */
export function TitleBar({ bare = false }) {
    const [time, setTime] = useState(new Date());
    const { settings } = useSettingsStore();
    const { t } = useT();

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 15000);
        return () => clearInterval(timer);
    }, []);

    // macOS traffic lights take ~76px on the left; Windows/Linux buttons ~140px on the right
    const reserved = PLATFORM === 'darwin' ? { paddingLeft: 84, paddingRight: 16 }
        : PLATFORM ? { paddingLeft: 16, paddingRight: 150 } : { paddingLeft: 16, paddingRight: 16 };

    if (bare) {
        // Setup and loading screens: only a strip to move the window
        return (
            <div className="h-10 flex-none titlebar-drag flex items-center text-xs text-zinc-600" style={reserved}
                onDoubleClick={() => window.electronAPI?.maximize()}>
                {t('app.name')}
            </div>
        );
    }

    return (
        <div
            className="h-10 flex-none bg-[#111113] border-b border-dark-border flex items-center gap-4 titlebar-drag select-none"
            style={reserved}
            onDoubleClick={() => window.electronAPI?.maximize()}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                <ShopLogo fileName={settings.shopLogo} size={22} />
                <span className="font-semibold text-sm text-white truncate max-w-[260px]">{settings.businessName || t('app.name')}</span>
                <span className="text-[11px] text-zinc-600 hidden md:inline">· {t('app.name')}</span>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-3 text-xs text-zinc-400 whitespace-nowrap">
                <span className="hidden lg:inline">{formatLocalDate(time, 'long')}</span>
                <span className="font-medium tabular text-zinc-300">{formatLocalDate(time, 'time')}</span>
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-dark-tertiary text-zinc-400" title={t('settings.db.localText')}>
                    <WifiOff className="w-3 h-3" />
                    {t('titlebar.local')}
                </span>
            </div>
        </div>
    );
}
