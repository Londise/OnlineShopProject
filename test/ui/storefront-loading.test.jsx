import { test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useStorefrontLoading from '../../src/hooks/useStorefrontLoading';

test('V3: resolved catalog waits for its image only up to the banner deadline', () => {
  vi.useFakeTimers();
  const { result, rerender, unmount } = renderHook(props => useStorefrontLoading(props), {
    initialProps: { catalogLoading: true, catalogError: '', bannerReady: false },
  });
  expect(result.current).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  rerender({ catalogLoading: false, catalogError: '', bannerReady: false });
  act(() => vi.advanceTimersByTime(2499));
  expect(result.current).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(false);
  expect(document.body.style.overflow).not.toBe('hidden');
  rerender({ catalogLoading: true, catalogError: '', bannerReady: false });
  expect(result.current).toBe(false);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  { catalogLoading: false, catalogError: '', bannerReady: true },
  { catalogLoading: false, catalogError: 'Unavailable', bannerReady: false },
])('V3/V4: readiness or catalog error releases the overlay without waiting', next => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(props => useStorefrontLoading(props), {
    initialProps: { catalogLoading: true, catalogError: '', bannerReady: false },
  });
  rerender(next);
  expect(result.current).toBe(false);
});

test('V4: a stalled catalog cannot lock scrolling forever, and unmount restores the previous overflow', () => {
  vi.useFakeTimers();
  document.body.style.overflow = 'auto';
  const first = renderHook(() => useStorefrontLoading({ catalogLoading: true, bannerReady: false }));
  first.unmount();
  expect(document.body.style.overflow).toBe('auto');
  const { result, unmount } = renderHook(() => useStorefrontLoading({ catalogLoading: true, bannerReady: false }));
  act(() => vi.advanceTimersByTime(12000));
  expect(result.current).toBe(false);
  expect(document.body.style.overflow).toBe('auto');
  unmount();
  document.body.style.overflow = '';
});
