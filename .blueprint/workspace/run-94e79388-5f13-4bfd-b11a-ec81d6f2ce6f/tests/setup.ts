```ts
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Tell React 18 we are in a test environment so act() works without warnings.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  delete (window as any).NHBridge;
  vi.useRealTimers();
  document.body.innerHTML = '';
});
```