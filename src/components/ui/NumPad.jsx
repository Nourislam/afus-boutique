import { t } from '../../i18n';
import { Delete, CornerDownLeft } from 'lucide-react';

export function NumPad({ value, onChange, onEnter, maxLength = 10 }) {
    const handleNumber = (num) => {
        if (value.length < maxLength) {
            onChange(value + num);
        }
    };

    const handleDecimal = () => {
        if (!value.includes('.') && value.length < maxLength) {
            onChange(value + '.');
        }
    };

    const handleBackspace = () => {
        onChange(value.slice(0, -1));
    };

    const handleClear = () => {
        onChange('');
    };

    return (
        <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                    key={num}
                    type="button"
                    onClick={() => handleNumber(num.toString())}
                    className="numpad-btn"
                >
                    {num}
                </button>
            ))}
            <button
                type="button"
                onClick={handleDecimal}
                className="numpad-btn"
            >
                .
            </button>
            <button
                type="button"
                onClick={() => handleNumber('0')}
                className="numpad-btn"
            >
                0
            </button>
            <button
                type="button"
                onClick={handleBackspace}
                className="numpad-btn numpad-btn-danger"
            >
                <Delete className="w-6 h-6" />
            </button>
            <button
                type="button"
                onClick={handleClear}
                className="numpad-btn col-span-2 text-lg"
            >
                {t('qr.clear')}
            </button>
            <button
                type="button"
                onClick={onEnter}
                className="numpad-btn numpad-btn-action"
            >
                <CornerDownLeft className="w-6 h-6" />
            </button>
        </div>
    );
}

export function PinPad({ value, onChange, onEnter, pinLength = 4 }) {
    const handleNumber = (num) => {
        if (value.length < pinLength) {
            const newValue = value + num;
            onChange(newValue);
            if (newValue.length === pinLength) {
                setTimeout(() => onEnter?.(newValue), 100);
            }
        }
    };

    const handleBackspace = () => {
        onChange(value.slice(0, -1));
    };

    const handleClear = () => {
        onChange('');
    };

    return (
        <div className="space-y-4">
            {/* PIN display */}
            <div className="flex justify-center gap-3">
                {Array(pinLength).fill(0).map((_, i) => (
                    <div
                        key={i}
                        className={`w-4 h-4 rounded-full transition-all duration-200 ${i < value.length
                                ? 'bg-accent-primary scale-110'
                                : 'bg-dark-tertiary'
                            }`}
                    />
                ))}
            </div>

            {/* Number pad */}
            <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                    <button
                        key={num}
                        type="button"
                        onClick={() => handleNumber(num.toString())}
                        className="numpad-btn h-16"
                    >
                        {num}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={handleClear}
                    className="numpad-btn h-16 text-base"
                >
                    {t('qr.clear')}
                </button>
                <button
                    type="button"
                    onClick={() => handleNumber('0')}
                    className="numpad-btn h-16"
                >
                    0
                </button>
                <button
                    type="button"
                    onClick={handleBackspace}
                    className="numpad-btn h-16"
                >
                    <Delete className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
