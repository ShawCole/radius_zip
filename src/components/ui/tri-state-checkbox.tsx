import React from 'react';

export type TriState = 'unset' | 'include' | 'exclude';

export interface TriStateCheckboxProps {
    state: TriState;
    onToggle: (next: TriState) => void;
    label?: string;
    className?: string;
}

const nextState = (current: TriState): TriState => {
    if (current === 'unset') return 'include';
    if (current === 'include') return 'exclude';
    return 'unset';
};

export const TriStateCheckbox: React.FC<TriStateCheckboxProps> = ({ state, onToggle, label, className }) => {
    const handleClick = () => onToggle(nextState(state));
    const handleKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onToggle(nextState(state));
        }
    };

    const base = 'inline-flex items-center gap-2';

    const boxClasses =
        'w-5 h-5 border rounded-sm flex items-center justify-center transition-colors select-none';

    const renderInner = () => {
        if (state === 'include') {
            return (
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" aria-hidden="true">
                    <path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2 9 19l11-11-1.5-1.5z" />
                </svg>
            );
        }
        if (state === 'exclude') {
            return (
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-red-600" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" />
                    <line x1="7" y1="17" x2="17" y2="7" stroke="currentColor" strokeWidth="2" />
                </svg>
            );
        }
        return null;
    };

    const computedBoxStyle =
        state === 'include'
            ? 'bg-blue-600 border-blue-600'
            : state === 'exclude'
                ? 'bg-white border-red-600'
                : 'bg-white border-gray-300';

    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={state === 'include'}
            aria-label={label}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            className={`${base} ${className || ''}`}
        >
            <span className={`${boxClasses} ${computedBoxStyle}`}>{renderInner()}</span>
            {label && <span className="text-sm text-gray-800">{label}</span>}
        </button>
    );
};

export default TriStateCheckbox;


