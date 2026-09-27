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