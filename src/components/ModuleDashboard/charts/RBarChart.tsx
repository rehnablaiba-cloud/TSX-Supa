// src/components/ModuleDashboard/charts/RBarChart.tsx
import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import CustomTooltip from './CustomTooltip';

interface Props { data: ChartRow[]; ct: ChartTheme; height?: number; }

const TICK = (ct: ChartTheme) => ({ fill: ct.muted, fontSize: 11 });
const MARGIN = { top: 8, right: 12, left: -16, bottom: 4 };
const LEGEND_FMT = (ct: ChartTheme) => (v: string) => (
  <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>{v}</span>
);

const RBarChart: React.FC<Props> = ({ data, ct, height = 220 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} margin={MARGIN} barCategoryGap={28} barGap={3}>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis
        dataKey="name"
        tick={TICK(ct)}
        axisLine={false}
        tickLine={false}
        tickFormatter={v => v.length > 12 ? v.slice(0, 11) + '…' : v}
      />
      <YAxis tick={TICK(ct)} axisLine={false} tickLine={false} allowDecimals={false} />
      <Tooltip
        content={<CustomTooltip ct={ct} />}
        cursor={{ fill: 'rgba(128,128,128,0.06)' }}
      />
      <Legend
        iconType="square"
        iconSize={8}
        wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        formatter={LEGEND_FMT(ct)}
      />
      <Bar dataKey="pass"    fill={COLORS.pass}    radius={[3,3,0,0]} maxBarSize={18} isAnimationActive={false} />
      <Bar dataKey="fail"    fill={COLORS.fail}    radius={[3,3,0,0]} maxBarSize={18} isAnimationActive={false} />
      <Bar dataKey="pending" fill={COLORS.pending} radius={[3,3,0,0]} maxBarSize={18} isAnimationActive={false} />
    </BarChart>
  </ResponsiveContainer>
);
export default RBarChart;
