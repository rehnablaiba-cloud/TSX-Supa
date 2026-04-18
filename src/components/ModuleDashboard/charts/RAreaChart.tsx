// src/components/ModuleDashboard/charts/RAreaChart.tsx
// Phase 2.1-A5: gradient IDs changed from "md-rg-{k}" → "rg-{k}"
// so this component can be shared with TestReport without ID collision.

import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import CustomTooltip from './CustomTooltip';

interface Props { data: ChartRow[]; ct: ChartTheme; }

const RAreaChart: React.FC<Props> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={220}>
    <AreaChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }}>
      <defs>
        {(['pass','fail','pending'] as const).map(k => (
          <linearGradient key={k} id={`rg-${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={COLORS[k]} stopOpacity={0.35} />
            <stop offset="95%" stopColor={COLORS[k]} stopOpacity={0.02} />
          </linearGradient>
        ))}
      </defs>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false}
        tickFormatter={v => v.length > 10 ? v.slice(0, 9) + '…' : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} />
      <Legend iconType="square" iconSize={10}
        formatter={v => <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>{v}</span>} />
      <Area type="monotone" dataKey="pending" stroke={COLORS.pending} fill="url(#rg-pending)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
      <Area type="monotone" dataKey="fail"    stroke={COLORS.fail}    fill="url(#rg-fail)"    strokeWidth={2.5} dot={false} isAnimationActive={false} />
      <Area type="monotone" dataKey="pass"    stroke={COLORS.pass}    fill="url(#rg-pass)"    strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 1.5, fill: COLORS.pass }} isAnimationActive={false} />
    </AreaChart>
  </ResponsiveContainer>
);
export default RAreaChart;
