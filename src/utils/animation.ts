// src/utils/animation.ts
// Phase 2.1-A7: shared animation keyframes + useInjectStyle hook
// Previously duplicated in ModuleDashboard.tsx and TestReport.tsx

import { useEffect } from 'react';

export const ANIM_STYLE = `
@keyframes fadeSlideIn    { from{opacity:0;transform:translateY(10px)}  to{opacity:1;transform:translateY(0)} }
@keyframes fadeSlideInRow { from{opacity:0;transform:translateX(-6px)}  to{opacity:1;transform:translateX(0)} }
@keyframes fadeScaleIn    { from{opacity:0;transform:scale(.95) translateY(-4px)} to{opacity:1;transform:scale(1) translateY(0)} }
`;

/**
 * Injects the shared animation keyframes into <head> once per mount.
 * Safe to call from multiple components — each injection is cleaned up on unmount.
 */
export function useInjectStyle(): void {
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = ANIM_STYLE;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);
}
