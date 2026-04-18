// src/utils/chartTheme.ts
// Phase 2.1-C1: extracted from ModuleDashboard.tsx + TestReport.tsx
// Computes a ChartTheme object from CSS variables + current theme name.

import type { ChartTheme } from '../components/ModuleDashboard/charts/types';

/**
 * Derive chart colours from CSS custom properties.
 * Call inside useMemo(() => getChartTheme(theme), [theme]).
 */
export function getChartTheme(theme: string): ChartTheme {
  const s   = getComputedStyle(document.documentElement);
  const get = (v: string) => s.getPropertyValue(v).trim();
  const isDark = theme === 'dark';
  return {
    panel:       isDark ? '#0f172a' : '#ffffff',
    text:        get('--text-primary')   || (isDark ? '#f1f5f9' : '#1e293b'),
    muted:       get('--text-muted')     || (isDark ? '#64748b' : '#94a3b8'),
    grid:        isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    border:      isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
    tooltipBg:   isDark ? '#1e293b' : '#ffffff',
    tooltipText: isDark ? '#f1f5f9' : '#1e293b',
    tooltipName: isDark ? '#94a3b8' : '#64748b',
  };
}
