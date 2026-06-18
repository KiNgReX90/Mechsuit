import type { SessionStatus } from '../types';

/**
 * Visual status roll-up utilities for the sessions graph.
 *
 * Pure, dependency-free functions — no React, no IPC, no side effects.
 * `color` values are stable CSS tokens; concrete styling lives in the view layer.
 */

/** Descriptor driving the visual pulse of a graph node. */
export interface PulseDescriptor {
  /** Stable token the view's CSS keys off. */
  color: 'green' | 'orange' | 'gray' | 'red';
  /** Whether the node should animate (pulse). `ready` is the only non-pulsing state. */
  pulsing: boolean;
}

/**
 * Map a single session status to its visual pulse descriptor.
 *
 * - working          → green, pulsing
 * - awaiting-approval → orange, pulsing
 * - ready            → gray, NOT pulsing
 * - error            → red, pulsing
 */
export function pulseFor(status: SessionStatus): PulseDescriptor {
  switch (status) {
    case 'working':
      return { color: 'green', pulsing: true };
    case 'awaiting-approval':
      return { color: 'orange', pulsing: true };
    case 'ready':
      return { color: 'gray', pulsing: false };
    case 'error':
      return { color: 'red', pulsing: true };
  }
}

/**
 * Precedence order for worst-wins roll-up (index 0 = highest precedence).
 */
const PRECEDENCE: SessionStatus[] = ['error', 'awaiting-approval', 'working', 'ready'];

/**
 * Derive a single representative status from a collection of session statuses
 * using worst-wins precedence: `error > awaiting-approval > working > ready`.
 *
 * Returns `"ready"` for an empty input array.
 */
export function rollupStatus(statuses: SessionStatus[]): SessionStatus {
  if (statuses.length === 0) {
    return 'ready';
  }
  for (const candidate of PRECEDENCE) {
    if (statuses.includes(candidate)) {
      return candidate;
    }
  }
  // All statuses in the input are known values covered by PRECEDENCE; this
  // path is unreachable at runtime but satisfies the type-checker.
  return 'ready';
}
