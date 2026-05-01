import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from its previous value to the new target.
 * Uses requestAnimationFrame with an ease-out cubic curve.
 *
 * @param target   The value to animate toward.
 * @param duration Animation duration in ms (default 500).
 * @param enabled  Set false to skip animation and return target directly.
 */
export function useCountUp(
  target: number,
  duration = 500,
  enabled = true
): number {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const rafRef  = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setDisplay(target);
      prevRef.current = target;
      return;
    }

    const start = prevRef.current;
    const delta = target - start;
    if (delta === 0) return;

    const startTime = performance.now();

    const tick = (now: number) => {
      const raw   = Math.min((now - startTime) / duration, 1);
      // ease-out cubic: decelerates into the final value
      const eased = 1 - Math.pow(1 - raw, 3);
      setDisplay(Math.round(start + delta * eased));

      if (raw < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, enabled]);

  return display;
}
