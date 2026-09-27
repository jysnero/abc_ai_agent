import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders', () => {
    const { container } = render(<Checkbox />);
    expect(container.querySelector('input')).toBeInTheDocument();
  });
});

### File: README.md
# Checkbox Component

Incomplete version with build error.


Has TypeScript compilation errors.