// src/components/ModuleDashboard/charts/RAreaChart.tsx
// gradient IDs use "rg-{k}" so this can be shared with TestReport without collision.
import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import CustomTooltip from './CustomTooltip';

interface Props { data: ChartRow[]; ct: ChartTheme; height?: number; }

const TICK   = (ct: ChartTheme) => ({ fill: ct.muted, fontSize: 11 });
const MARGIN = { top: 8, right: 12, left: -16, bottom: 4 };
const LEGEND_FMT = (ct: ChartTheme) => (v: string) => (
  <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>{v}</span>
);

const RAreaChart: React.FC<Props> = ({ data, ct, height = 220 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <AreaChart data={data} margin={MARGIN}>
      <defs>
        {(['pass', 'fail', 'pending'] as const).map(k => (
          <linearGradient key={k} id={`rg-${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={COLORS[k]} stopOpacity={0.32} />
            <stop offset="95%" stopColor={COLORS[k]} stopOpacity={0.02} />
          </linearGradient>
        ))}
      </defs>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis
        dataKey="name"
        tick={TICK(ct)}
        axisLine={false}
        tickLine={false}
        tickFormatter={v => v.length > 12 ? v.slice(0, 11) + '…' : v}
      />
      <YAxis tick={TICK(ct)} axisLine={false} tickLine={false} allowDecimals={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} />
      <Legend
        iconType="square"
        iconSize={8}
        wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        formatter={LEGEND_FMT(ct)}
      />
      {/* Render pending first (bottom) so pass sits on top visually */}
      <Area type="monotone" dataKey="pending" stroke={COLORS.pending} fill="url(#rg-pending)" strokeWidth={2} dot={false} isAnimationActive={false} />
      <Area type="monotone" dataKey="fail"    stroke={COLORS.fail}    fill="url(#rg-fail)"    strokeWidth={2} dot={false} isAnimationActive={false} />
      <Area type="monotone" dataKey="pass"    stroke={COLORS.pass}    fill="url(#rg-pass)"    strokeWidth={2}
        dot={{ r: 3, strokeWidth: 0, fill: COLORS.pass }} isAnimationActive={false} />
    </AreaChart>
  </ResponsiveContainer>
);
export default RAreaChart;
