import React, { useState } from 'react';

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Checkbox({
  checked = false,
  onChange,
  label,
  disabled = false,
}: CheckboxProps): JSX.Element {
  const [isChecked, setIsChecked] = useState(checked);

  const handleChange = () => {
    if (!disabled) {
      const newState = !isChecked;
      setIsChecked(newState);
      onChange?.(newState);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === ' ' && !disabled) {
      e.preventDefault();
      handleChange();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={label || 'Checkbox'}
        aria-checked={isChecked}
        className="w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-2 focus:outline-offset-2 focus:outline-blue-500"
      />
      {label && (
        <label className="text-sm font-medium cursor-pointer disabled:opacity-50">
          {label}
        </label>
      )}
    </div>
  );
}