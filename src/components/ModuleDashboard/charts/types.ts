// src/components/ModuleDashboard/charts/types.ts
// Phase 2.1-A1: added CHART_TYPES export so TestReport can import it
// instead of re-declaring the same array.

export interface ChartRow {
  name:    string;
  pass:    number;
  fail:    number;
  pending: number;
}

export interface ChartTheme {
  panel:       string;
  text:        string;
  muted:       string;
  grid:        string;
  border:      string;
  tooltipBg:   string;
  tooltipText: string;
  tooltipName: string;
}

export const COLORS = {
  pass:    '#22c55e',
  fail:    '#ef4444',
  pending: '#f59e0b',
} as const;

export type ChartType = 'bar' | 'area' | 'line' | 'pie' | 'radar';

export const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: 'bar',   label: 'Bar'   },
  { type: 'area',  label: 'Area'  },
  { type: 'line',  label: 'Line'  },
  { type: 'pie',   label: 'Pie'   },
  { type: 'radar', label: 'Radar' },
];
