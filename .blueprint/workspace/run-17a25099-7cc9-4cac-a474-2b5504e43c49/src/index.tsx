```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Game from './pages/Game';

const MOUNT_ELEMENT_ID = 'root';

function resolveContainer(): HTMLElement {
  const existing = document.getElementById(MOUNT_ELEMENT_ID);
  if (existing) {
    return existing;
  }
  const created = document.createElement('div');
  created.id = MOUNT_ELEMENT_ID;
  document.body.appendChild(created);
  return created;
}

function mount(): void {
  const container = resolveContainer();
  createRoot(container).render(
    <StrictMode>
      <Game />
    </StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
```