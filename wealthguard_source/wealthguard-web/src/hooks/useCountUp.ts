import { useEffect, useRef, useState } from 'react';

/**
 * Animate a numeric value from its previous displayed value up to `target`.
 *
 * Driven by requestAnimationFrame so there is no setInterval drift; eases with
 * a cubic ease-out so the end is gentle.  When the user has `prefers-reduced-
 * motion: reduce` set, the target is returned immediately and no frames are
 * scheduled — mandatory per the WattVision accessibility rules.
 *
 * Used on the Dashboard cockpit's 4 hero KPIs to give the loaded state a
 * subtle "instrument spinning up" feel without being decoration.
 */
export function useCountUp(target: number, duration = 400): number {
  const [value, setValue] = useState<number>(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return target;
    }
    return 0;
  });
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setValue(target);
      return;
    }
    // Early-exit: if the target hasn't changed (parent re-rendered with the
    // same number), don't re-animate — that causes a visible re-jitter.
    if (Math.abs(target - value) < 0.5) {
      return;
    }
    // Start from the currently-displayed value so successive updates feel
    // continuous, not a repeated zero-to-N jump.
    fromRef.current = value;
    const start = performance.now();
    const from = fromRef.current;
    const delta = target - from;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      // easeOutCubic — gentle, no overshoot
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + delta * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}
