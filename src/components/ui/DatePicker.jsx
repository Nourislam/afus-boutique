import { useT } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X } from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, isToday } from 'date-fns';

/**
 * A date in the shop's language (the browser's own date field writes
 * mm/dd/yyyy in English). value / onChange: "YYYY-MM-DD" or ''.
 * clearable: a cross to empty an optional date.
 */
export function DatePicker({ value, onChange, label, className = '', clearable = false, placeholder, min, testId }) {
    const { t } = useT();
    const [isOpen, setIsOpen] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const containerRef = useRef(null);
    const panelRef = useRef(null);
    // The calendar is drawn above everything, under the field or above it when
    // there is no room below (never cut by a window that scrolls)
    const [place, setPlace] = useState(null);
    const toggle = () => {
        if (isOpen) { setIsOpen(false); return; }
        const r = containerRef.current?.getBoundingClientRect();
        if (r) {
            const below = window.innerHeight - r.bottom > 330;
            const rtl = document.documentElement.dir === 'rtl';
            const left = Math.max(8, Math.min(window.innerWidth - 264, rtl ? r.right - 256 : r.left));
            setPlace({ left, top: below ? r.bottom + 4 : undefined, bottom: below ? undefined : window.innerHeight - r.top + 4 });
        }
        setIsOpen(true);
    };

    // "YYYY-MM-DD" read as a local day (not midnight UTC, the day before in some places)
    const selectedDate = value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value) : null;
    const minDay = min ? new Date(`${String(min).slice(0, 10)}T00:00:00`) : null;

    useEffect(() => {
        if (selectedDate) {
            setCurrentMonth(selectedDate);
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target) && !panelRef.current?.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

    const days = eachDayOfInterval({
        start: startOfWeek(startOfMonth(currentMonth)),
        end: endOfWeek(endOfMonth(currentMonth))
    });

    const handleSelect = (day) => {
        if (minDay && day < minDay) return;
        // Return YYYY-MM-DD format as expected by the parent
        onChange(format(day, 'yyyy-MM-dd'));
        setIsOpen(false);
    };

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            {label && <label className="form-label">{label}</label>}

            <div className="relative">
                <button
                    type="button"
                    onClick={toggle}
                    data-testid={testId}
                    className="input w-full flex items-center justify-between gap-2 text-start"
                >
                    <span className={`truncate ${!selectedDate ? 'text-zinc-500' : ''}`}>
                        {selectedDate ? formatLocalDate(selectedDate, 'date') : (placeholder || t('common.selectDate'))}
                    </span>
                    <CalendarIcon className={`w-4 h-4 text-zinc-400 flex-none ${clearable && selectedDate ? 'me-6' : ''}`} />
                </button>
                {clearable && selectedDate && (
                    <button type="button" onClick={() => onChange('')} title={t('common.clear')} aria-label={t('common.clear')}
                        className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-dark-tertiary text-zinc-400 hover:text-white">
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {isOpen && place && createPortal(
                <div ref={panelRef} className="fixed z-[200] w-64 bg-dark-secondary border border-dark-border rounded-xl shadow-xl p-3"
                    style={{ left: place.left, top: place.top, bottom: place.bottom }} data-testid={testId ? `${testId}-calendar` : undefined}>
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <button
                            type="button"
                            onClick={prevMonth}
                            aria-label={t('common.previous')}
                            className="p-1 hover:bg-dark-tertiary rounded-lg text-zinc-400 hover:text-white transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4 flip-rtl" />
                        </button>
                        <span className="text-sm font-medium">
                            {formatLocalDate(currentMonth, 'month')}
                        </span>
                        <button
                            type="button"
                            onClick={nextMonth}
                            aria-label={t('common.next')}
                            className="p-1 hover:bg-dark-tertiary rounded-lg text-zinc-400 hover:text-white transition-colors"
                        >
                            <ChevronRight className="w-4 h-4 flip-rtl" />
                        </button>
                    </div>

                    {/* Weekdays */}
                    <div className="grid grid-cols-7 gap-1 mb-2">
                        {t('common.weekdaysShort').split(',').map(day => (
                            <div key={day} className="text-center text-xs text-zinc-500 font-medium py-1">
                                {day}
                            </div>
                        ))}
                    </div>

                    {/* Days */}
                    <div className="grid grid-cols-7 gap-1">
                        {days.map((day, idx) => {
                            const isSelected = selectedDate && isSameDay(day, selectedDate);
                            const isCurrentMonth = isSameMonth(day, currentMonth);
                            const isDayToday = isToday(day);
                            const blocked = minDay && day < minDay;

                            return (
                                <button
                                    key={idx}
                                    type="button"
                                    disabled={blocked}
                                    onClick={() => handleSelect(day)}
                                    className={`
                                        ${blocked ? 'opacity-30 cursor-not-allowed' : ''}
                                        h-8 rounded-lg text-xs font-medium transition-all relative
                                        ${!isCurrentMonth ? 'text-zinc-700' : 'text-zinc-300'}
                                        ${isSelected
                                            ? 'bg-accent-primary text-white shadow-lg shadow-accent-primary/25'
                                            : 'hover:bg-dark-tertiary hover:text-white'}
                                        ${isDayToday && !isSelected ? 'text-accent-primary' : ''}
                                    `}
                                >
                                    {format(day, 'd')}
                                    {isDayToday && !isSelected && (
                                        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent-primary"></span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
