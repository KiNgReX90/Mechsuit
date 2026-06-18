import { describe, it, expect } from 'vitest';
import { pulseFor, rollupStatus } from './nodeStatus';
import type { SessionStatus } from '../types';

describe('pulseFor', () => {
  it('returns green + pulsing for working', () => {
    expect(pulseFor('working')).toEqual({ color: 'green', pulsing: true });
  });

  it('returns orange + pulsing for awaiting-approval', () => {
    expect(pulseFor('awaiting-approval')).toEqual({ color: 'orange', pulsing: true });
  });

  it('returns gray + NOT pulsing for ready', () => {
    expect(pulseFor('ready')).toEqual({ color: 'gray', pulsing: false });
  });

  it('returns red + pulsing for error', () => {
    expect(pulseFor('error')).toEqual({ color: 'red', pulsing: true });
  });

  it('only "ready" has pulsing: false', () => {
    const statuses: SessionStatus[] = ['working', 'awaiting-approval', 'error'];
    for (const s of statuses) {
      expect(pulseFor(s).pulsing).toBe(true);
    }
    expect(pulseFor('ready').pulsing).toBe(false);
  });
});

describe('rollupStatus', () => {
  it('returns "ready" for an empty array', () => {
    expect(rollupStatus([])).toBe('ready');
  });

  it('returns the sole status when there is only one', () => {
    expect(rollupStatus(['working'])).toBe('working');
    expect(rollupStatus(['error'])).toBe('error');
    expect(rollupStatus(['awaiting-approval'])).toBe('awaiting-approval');
    expect(rollupStatus(['ready'])).toBe('ready');
  });

  it('error beats all others', () => {
    expect(rollupStatus(['error', 'working'])).toBe('error');
    expect(rollupStatus(['error', 'awaiting-approval'])).toBe('error');
    expect(rollupStatus(['error', 'ready'])).toBe('error');
    expect(rollupStatus(['error', 'working', 'awaiting-approval', 'ready'])).toBe('error');
  });

  it('awaiting-approval beats working and ready', () => {
    expect(rollupStatus(['awaiting-approval', 'working'])).toBe('awaiting-approval');
    expect(rollupStatus(['awaiting-approval', 'ready'])).toBe('awaiting-approval');
    expect(rollupStatus(['awaiting-approval', 'working', 'ready'])).toBe('awaiting-approval');
  });

  it('working beats ready', () => {
    expect(rollupStatus(['working', 'ready'])).toBe('working');
    expect(rollupStatus(['ready', 'working', 'ready'])).toBe('working');
  });

  it('returns "ready" when all statuses are "ready"', () => {
    expect(rollupStatus(['ready', 'ready', 'ready'])).toBe('ready');
  });

  it('is order-independent (precedence, not position)', () => {
    const mixed: SessionStatus[] = ['ready', 'working', 'awaiting-approval', 'error'];
    const reversed = [...mixed].reverse();
    expect(rollupStatus(mixed)).toBe('error');
    expect(rollupStatus(reversed)).toBe('error');
  });
});
