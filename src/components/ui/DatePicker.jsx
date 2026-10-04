import { useT } from '../../i18n';
import { formatDate as formatLocalDate } from '../../i18n/format';
import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, isToday } from 'date-fns';

export function DatePicker({ value, onChange, label, className = '' }) {
    const { t } = useT();
    const [isOpen, setIsOpen] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const containerRef = useRef(null);

    const selectedDate = value ? new Date(value) : null;

    useEffect(() => {
        if (selectedDate) {
            setCurrentMonth(selectedDate);
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
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
        // Return YYYY-MM-DD format as expected by the parent
        onChange(format(day, 'yyyy-MM-dd'));
        setIsOpen(false);
    };

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            {label && <label className="text-sm text-zinc-400 block mb-1">{label}</label>}

            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-zinc-100 hover:border-zinc-600 transition-colors focus:outline-none focus:border-accent-primary"
            >
                <span className={!selectedDate ? 'text-zinc-500' : ''}>
                    {selectedDate ? formatLocalDate(selectedDate, 'date') : t('common.selectDate')}
                </span>
                <CalendarIcon className="w-4 h-4 text-zinc-400" />
            </button>

            {isOpen && (
                <div className="absolute top-full start-0 z-50 mt-1 w-64 bg-dark-secondary border border-dark-border rounded-xl shadow-xl p-3">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <button
                            onClick={prevMonth}
                            className="p-1 hover:bg-dark-tertiary rounded-lg text-zinc-400 hover:text-white transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4 flip-rtl" />
                        </button>
                        <span className="text-sm font-medium">
                            {formatLocalDate(currentMonth, 'month')}
                        </span>
                        <button
                            onClick={nextMonth}
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

                            return (
                                <button
                                    key={idx}
                                    onClick={() => handleSelect(day)}
                                    className={`
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
                </div>
            )}
        </div>
    );
}
