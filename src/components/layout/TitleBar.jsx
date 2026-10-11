import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { AfusLogo } from '../brand/AfusLogo';
import { HelpButton } from './HelpButton';
import { useT } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';

const PLATFORM = typeof window !== 'undefined' ? window.electronAPI?.platform : undefined;

/**
 * Title bar. The window buttons are the system's own (macOS traffic lights
 * on the left, Windows/Linux buttons on the right), drawn by Electron over
 * this bar, so they never appear twice. Their space is kept free with a
 * physical padding that does not flip in Arabic.
 */
export function TitleBar({ bare = false, loggedIn = true }) {
    const [time, setTime] = useState(new Date());
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
            <div className="h-10 flex-none titlebar-drag flex items-center gap-2 text-xs text-zinc-500" style={reserved}
                onDoubleClick={() => window.electronAPI?.maximize()}>
                <AfusLogo size={18} />
                {t('app.name')}
            </div>
        );
    }

    return (
        <div
            className="relative h-10 flex-none bg-dark-secondary border-b border-dark-border flex items-center gap-4 titlebar-drag select-none"
            style={reserved}
            onDoubleClick={() => window.electronAPI?.maximize()}
        >
            {/* The program (Afus). The shop's own logo and name are in the menu. */}
            <div className="flex items-center gap-2 min-w-0 text-xs text-zinc-400" title={t('titlebar.program')}>
                <AfusLogo size={16} />
                <span className="font-medium truncate">{t('app.name')}</span>
            </div>

            <div className="flex-1" />

            <HelpButton loggedIn={loggedIn} />
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-dark-tertiary text-xs text-zinc-400 whitespace-nowrap" title={t('settings.db.localText')}>
                <WifiOff className="w-3 h-3" />
                {t('titlebar.local')}
            </span>

            {/* Date and time in the middle of the window, whatever the language and the window buttons */}
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center gap-3 text-xs text-zinc-400 whitespace-nowrap pointer-events-none" data-testid="titlebar-clock">
                <span className="hidden md:inline">{formatLocalDate(time, 'long')}</span>
                <span className="font-medium tabular text-zinc-300">{formatLocalDate(time, 'time')}</span>
            </div>
        </div>
    );
}
