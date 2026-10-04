import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Plus, X } from 'lucide-react';

/**
 * Searchable list with a scrollable menu (replaces <datalist>, which does not
 * scroll on macOS). Type to filter, arrows + Enter to choose, and optionally
 * "Add …" for a value that is not in the list.
 *
 * options: [{ value, label, hint? }]
 */
export function Combobox({
    label, value, onChange, options, placeholder, createLabel, onCreate, emptyText, containerClassName = '', clearable = true,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(0);
    const [rect, setRect] = useState(null);
    const inputRef = useRef(null);
    const menuRef = useRef(null);

    const selected = options.find(o => o.value === value);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
    }, [options, query]);
    const canCreate = !!onCreate && query.trim() && !options.some(o => o.label.toLowerCase() === query.trim().toLowerCase());
    const items = canCreate ? [...filtered, { create: true, value: query.trim(), label: query.trim() }] : filtered;

    // The menu is drawn in a portal so it is never cut by a scrolling dialog
    const place = () => {
        const r = inputRef.current?.getBoundingClientRect();
        if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width, above: window.innerHeight - r.bottom < 260, bottom: window.innerHeight - r.top + 4 });
    };
    useLayoutEffect(() => { if (open) place(); }, [open]);
    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => {
            if (inputRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onScroll = (e) => { if (!menuRef.current?.contains(e.target)) place(); };
        document.addEventListener('mousedown', close);
        window.addEventListener('resize', place);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('mousedown', close);
            window.removeEventListener('resize', place);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [open]);
    useEffect(() => { setHighlight(0); }, [query]);
    useEffect(() => {
        menuRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [highlight]);

    const choose = async (item) => {
        if (item.create) {
            const created = await onCreate(item.value);
            onChange(created ?? item.value);
        } else {
            onChange(item.value);
        }
        setQuery('');
        setOpen(false);
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, items.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
        else if (e.key === 'Enter') {
            if (open && items[highlight]) { e.preventDefault(); choose(items[highlight]); }
        } else if (e.key === 'Escape' && open) {
            // Close only the list, not the dialog around it
            e.stopPropagation();
            setOpen(false);
            setQuery('');
        }
    };

    return (
        <div className={`form-group ${containerClassName}`}>
            {label && <label className="form-label">{label}</label>}
            <div className="relative">
                <input
                    ref={inputRef}
                    className="input pe-16"
                    value={open ? query : (selected?.label ?? value ?? '')}
                    placeholder={selected?.label || placeholder}
                    onFocus={() => { setOpen(true); setQuery(''); }}
                    onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                    onKeyDown={onKeyDown}
                    role="combobox"
                    aria-expanded={open}
                    autoComplete="off"
                />
                <div className="absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-zinc-500">
                    {clearable && value && !open && (
                        <button type="button" onClick={() => onChange('')} className="p-0.5 hover:text-white" aria-label="clear"><X className="w-4 h-4" /></button>
                    )}
                    <ChevronDown className="w-4 h-4 pointer-events-none" />
                </div>
            </div>
            {open && rect && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[100] max-h-60 overflow-y-auto rounded-lg border border-dark-border bg-dark-secondary shadow-2xl shadow-black/60 py-1"
                    style={rect.above ? { left: rect.left, bottom: rect.bottom, width: rect.width } : { left: rect.left, top: rect.top, width: rect.width }}
                    dir={document.documentElement.dir}
                    role="listbox"
                >
                    {items.length === 0 && <div className="px-3 py-2 text-sm text-zinc-500">{emptyText}</div>}
                    {items.map((item, index) => (
                        <button
                            key={`${item.create ? 'new:' : ''}${item.value}`}
                            type="button"
                            data-index={index}
                            onMouseEnter={() => setHighlight(index)}
                            onClick={() => choose(item)}
                            className={`w-full px-3 py-2 text-sm text-start flex items-center gap-2 ${index === highlight ? 'bg-dark-tertiary text-white' : 'text-zinc-300'}`}
                            role="option"
                            aria-selected={item.value === value}
                        >
                            {item.create ? <Plus className="w-4 h-4 text-indigo-400" /> : <Check className={`w-4 h-4 ${item.value === value ? 'text-indigo-400' : 'opacity-0'}`} />}
                            <span className="flex-1 truncate">{item.create ? `${createLabel} « ${item.label} »` : item.label}</span>
                            {item.hint && <span className="text-xs text-zinc-500">{item.hint}</span>}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}

export default Combobox;
