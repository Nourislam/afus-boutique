// Chart colours: one fixed order (never cycled), checked for colour-blind
// readers in both themes (dark is the default, html.theme-light the other).
// Series take their colour from what they are (cash is always slot 1...),
// never from their rank, so a filter never repaints them.
import { useEffect, useState } from 'react';

export const VIZ = {
    dark: {
        series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
        track: '#1c3a63',
        grid: '#2c2c2a',
        axis: '#383835',
        text: '#898781',
    },
    light: {
        series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
        track: '#cde2fb',
        grid: '#e1e0d9',
        axis: '#c3c2b7',
        text: '#6b6a65',
    },
};

const isLight = () => typeof document !== 'undefined' && document.documentElement.classList.contains('theme-light');

/** The colours of the theme on screen, updated when the theme changes. */
export function useVizColors() {
    const [light, setLight] = useState(isLight);
    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return undefined;
        const observer = new MutationObserver(() => setLight(isLight()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);
    return light ? VIZ.light : VIZ.dark;
}

// Each payment method keeps its own colour on every screen
const METHOD_SLOT = { cash: 0, card: 1, transfer: 2, credit: 3, gift_card: 4 };
export const methodColor = (colors, method) => colors.series[METHOD_SLOT[method] ?? 4];
