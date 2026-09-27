import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox Component', () => {
  it('renders checkbox element', () => {
    const { container } = render(<Checkbox label="Test" />);
    expect(container.querySelector('input[type="checkbox"]')).toBeInTheDocument();
  });
});