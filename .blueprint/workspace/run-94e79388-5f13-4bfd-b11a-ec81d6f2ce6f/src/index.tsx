```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Game from './pages/Game';

const MOUNT_ID = 'root';

function resolveMountNode(): HTMLElement {
  const existing = document.getElementById(MOUNT_ID);
  if (existing) {
    return existing;
  }
  const created = document.createElement('div');
  created.id = MOUNT_ID;
  document.body.appendChild(created);
  return created;
}

function bootstrap(): void {
  const container = resolveMountNode();
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <Game />
    </StrictMode>
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
```