import { useEffect, useRef } from 'react';

/** Escape closes the window it belongs to (while `active`). */
export function useEscape(handler, active = true) {
    const ref = useRef(handler);
    ref.current = handler;
    useEffect(() => {
        if (!active) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') ref.current?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active]);
}

export default useEscape;
