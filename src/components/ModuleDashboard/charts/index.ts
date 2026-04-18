// src/components/ModuleDashboard/charts/index.ts
// Barrel export — unchanged from Phase 2.
// All 5 chart components export from here.
export { default as RBarChart   } from './RBarChart';
export { default as RAreaChart  } from './RAreaChart';
export { default as RLineChart  } from './RLineChart';
export { default as RPieChart   } from './RPieChart';
export { default as RRadarChart } from './RRadarChart';
export { default as CustomTooltip } from './CustomTooltip';
export { default as PieTooltip    } from './PieTooltip';
export type { ChartRow, ChartTheme } from './types';
export { COLORS, CHART_TYPES }      from './types';
