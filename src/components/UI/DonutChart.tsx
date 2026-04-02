import React, { useEffect, useRef } from "react";
import gsap from "gsap";

interface Segment { value: number; color: string; label: string; }
interface Props { segments: Segment[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: number | string; }

const DonutChart: React.FC<Props> = ({ segments, size = 140, thickness = 22, centerLabel = "Total", centerValue }) => {
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const refs = useRef<SVGCircleElement[]>([]);
  let offset = 0;
  const arcs = segments.map((seg, i) => {
    const dash = (seg.value / total) * circ;
    const arc  = { dash, gap: circ - dash, offset, ...seg, idx: i };
    offset += dash;
    return arc;
  });

  useEffect(() => {
    refs.current.forEach((el, i) => {
      if (!el) return;
      gsap.fromTo(el,
        { strokeDasharray: `0 ${circ}` },
        { strokeDasharray: `${arcs[i].dash} ${arcs[i].gap}`, duration: 1, ease: "power2.out", delay: i * 0.1 }
      );
    });
  }, [segments]);

  const cx = size / 2, cy = size / 2;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {arcs.map((arc, i) => (
          <circle key={i} ref={el => { if (el) refs.current[i] = el; }}
            cx={cx} cy={cy} r={r} fill="none" stroke={arc.color} strokeWidth={thickness}
            strokeDasharray={`${arc.dash} ${arc.gap}`} strokeDashoffset={-arc.offset} strokeLinecap="round" />
        ))}
        {/* Track ring uses CSS var so it adapts to light/dark */}
        <circle cx={cx} cy={cy} r={r - thickness / 2} fill="none"
          stroke="var(--bg-card)" strokeWidth={thickness} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-t-primary">{centerValue ?? total}</span>
        <span className="text-xs text-t-muted">{centerLabel}</span>
      </div>
    </div>
  );
};
export default DonutChart;
