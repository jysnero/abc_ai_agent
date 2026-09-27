```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/* ------------------------------------------------------------------ */
/* Bridge adapter (minigame_shell_v1)                                  */
/* All native calls go through this adapter. It enforces the per-      */
/* session call limits declared in the architecture contract.          */
/* ------------------------------------------------------------------ */

type MaybePromise<T> = T | Promise<T>;

interface GrantPointParams {
  amount: number;
  reason: string;
  requestId