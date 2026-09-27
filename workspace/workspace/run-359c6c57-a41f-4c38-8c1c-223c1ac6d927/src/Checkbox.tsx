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
  const [isChecked, setIsChecked]: number = useState(checked); // TYPE ERROR

  const handleChange = () => {
    if (!disabled) {
      const newState = !isChecked;
      setIsChecked(newState);
      onChange?.(newState);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={handleChange}
        disabled={disabled}
        aria-label={label || 'Checkbox'}
        aria-checked={isChecked}
      />
    </div>
  );
}