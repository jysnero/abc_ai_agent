import { vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';

export const LIMITS = {
  grantPoint: 7,
  showRewarded: 5,
  close: 1,
} as const;

export type BridgeMocks = {
  grantPoint: ReturnType<typeof vi.fn>;
  showRewarded: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

export type BridgeMode = 'resolve' | 'pending' | 'throw' | 'reject';

function impl(mode: BridgeMode, value: unknown) {
  switch (mode) {
    case 'resolve':
      return () => Promise.resolve(value);
    case 'pending':
      return () => new Promise(() => {}); // never settles -> simulates slow native side
    case 'throw':
      return () => {
        throw new Error('native crash');
      };
    case 'reject':
      return () => Promise.reject(new Error('native rejected'));
  }
}

export function installBridge(
  modes: Partial<Record<keyof BridgeMocks, BridgeMode>> = {},
  omit: Array<keyof BridgeMocks> = []
): BridgeMocks {
  const mocks: BridgeMocks = {
    grantPoint: vi.fn(impl(modes.grantPoint ?? 'resolve', { ok: true, balance: 100 })),
    showRewarded: vi.fn(impl(modes.showRewarded ?? 'resolve', { completed: true, rewarded: true })),
    close: vi.fn(impl(modes.close ?? 'resolve', undefined)),
  };
  (window as any).NHBridge = {
    reward: omit.includes('grantPoint') ? {} : { grantPoint: mocks.grantPoint },
    ad: omit.includes('showRewarded') ? {} : { showRewarded: mocks.showRewarded },
    nav: omit.includes('close') ? {} : { close: mocks.close },
  };
  return mocks;
}

/** Fresh module instance => fresh module-level sessionCallCounts. */
export async function loadGame() {
  vi.resetModules();
  const mod = await import('../../src/pages/Game');
  return mod.default;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * UI-agnostic fuzz driver: repeatedly taps every element in the container
 * and advances fake timers so time-based phases (countdown, game over,
 * result screen) are all reached.
 */
export async function mashEverything(
  container: HTMLElement,
  { rounds = 25, stepMs = 1000 }: { rounds?: number; stepMs?: number } = {}
) {
  for (let r = 0; r < rounds; r++) {
    const nodes = Array.from(container.querySelectorAll<HTMLElement>('*'));
    for (const node of nodes) {
      if (!node.isConnected) continue;
      await act(async () => {
        fireEvent.pointerDown(node);
        fireEvent.touchStart(node);
        fireEvent.mouseDown(node);
        fireEvent.click(node);
        fireEvent.keyDown(node, { key: 'Enter' });
        fireEvent.keyDown(node, { key: ' ' });
      });
    }
