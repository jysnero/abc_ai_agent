import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox Component', () => {
  it('renders checkbox element', () => {
    const { container } = render(<Checkbox label="Test" />);
    expect(container.querySelector('input[type="checkbox"]')).toBeInTheDocument();
  });
});

### File: README.md
# Checkbox Component

A reusable React checkbox component with TypeScript support and accessibility features.

## Usage

```tsx
import { Checkbox } from './src/Checkbox';

export function App() {
  const [checked, setChecked] = React.useState(false);
  return (
    <Checkbox
      checked={checked}
      onChange={setChecked}
      label="Accept terms"
    />
  );
}
```

## Props

- checked: boolean
- onChange: (checked: boolean) => void
- label: string
- disabled: boolean


All files generated successfully.