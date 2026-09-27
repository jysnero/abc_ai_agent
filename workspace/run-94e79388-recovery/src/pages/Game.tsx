import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/* ------------------------------------------------------------------ */
/* Bridge adapter (minigame_shell_v1)                                  */
/* All native calls go through this adapter, which enforces the        */
/* per-session call limits declared in the architecture contract.      */
/* ------------------------------------------------------------------ */

interface GrantPointParams {
  amount: number;
  reason: string;
}

interface ShowRewardedParams {
  placement: string;
}

interface NHBridgeApi {
  reward?: {
    grantPoint?: (params: GrantPointParams) => unknown;
  };
  ad?: {
    showRewarded?: (params: ShowRewardedParams) => unknown;
  };
  nav?: {
    close?: () => unknown;
  };
}

declare global {
  interface Window {
    NHBridge?: NHBridgeApi;
  }
}

type BridgeMethod = 'reward.grantPoint' | 'ad.showRewarded' | 'nav.close';

type BridgeFailure = 'limit_exceeded' | 'unavailable' | 'rejected';

type BridgeOutcome<T> = { ok: true; data: T } | { ok: false; reason: BridgeFailure; message: string };

const BRIDGE_POLICY: Readonly<Record<BridgeMethod, { maxCallsPerSession: number }>> = {
  'reward.grantPoint': { maxCallsPerSession: 7 },
  'ad.showRewarded': { maxCallsPerSession: 5 },
  'nav.close': { maxCallsPerSession: 1 },
};

const sessionCallCounts: Record<BridgeMethod, number> = {
  'reward.grantPoint': 0,
  'ad.showRewarded': 0,
  'nav.close': 0,
};

function remainingCalls(method: BridgeMethod): number {
  return Math.max(0, BRIDGE_POLICY[method].maxCallsPerSession - sessionCallCounts[method]);
}

function getBridge(): NHBridgeApi | undefined {
  return typeof window !== 'undefined' ? window.NHBridge : undefined;
}

async function invokeGuarded<T>(
  method: BridgeMethod,
  resolveFn: (bridge: NHBridgeApi) => (() => unknown) | undefined
): Promise<BridgeOutcome<T>> {
  if (remainingCalls(method) <= 0) {
    return { ok: false, reason: 'limit_exceeded', message: 'Session limit reached for this action.' };
  }
  const bridge = getBridge();
  const fn = bridge ? resolveFn(bridge) : undefined;
  if (!fn) {
    return { ok: false, reason: 'unavailable', message: 'This feature is not available in the current app.' };
  }
  // Count the attempt before invoking so concurrent taps cannot exceed the limit.
  sessionCallCounts[method] += 1;
  try {
    const data = (await Promise.resolve(fn())) as T;
    return { ok: true
