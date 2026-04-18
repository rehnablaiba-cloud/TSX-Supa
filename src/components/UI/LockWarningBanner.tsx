// src/components/UI/LockWarningBanner.tsx
// Phase 2.1-B2: extracted from Dashboard.tsx
// Displays a warning banner for active test locks held by the current user.

import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { AlertTriangle, Lock } from 'lucide-react';
import type { ActiveLock } from '../../types';

interface Props {
  locks:      ActiveLock[];
  onNavigate: (page: string, module_name?: string) => void;
}

const LockWarningBanner: React.FC<Props> = ({ locks, onNavigate }) => {
  const bannerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (bannerRef.current)
      gsap.fromTo(bannerRef.current,
        { opacity: 0, y: -8 },
        { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
  }, []);

  if (locks.length === 0) return null;

  return (
    <div ref={bannerRef}
      className="rounded-xl border px-4 py-3 flex flex-col gap-2"
      style={{ background: 'color-mix(in srgb, #f59e0b 8%, transparent)', borderColor: '#f59e0b55' }}>

      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0" style={{ color: '#f59e0b' }} />
        <span className="text-sm font-bold tracking-wide" style={{ color: '#f59e0b' }}>
          {locks.length === 1 ? 'You have an active test lock' : `You have ${locks.length} active test locks`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 pl-6">
        {locks.map(lock => (
          <div key={lock.module_test_id} className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs" style={{ color: '#fbbf24' }}>
              <Lock size={11} className="shrink-0" />
              <span>
                <span className="font-semibold">{lock.module_name}</span>
                <span className="mx-1 opacity-50">›</span>
                {lock.test_name}
              </span>
            </div>
            <button
              onClick={() => onNavigate('module', lock.module_name)}
              className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition-colors"
              style={{ color: '#f59e0b', borderColor: '#f59e0b88', background: 'color-mix(in srgb, #f59e0b 12%, transparent)' }}>
              Resume
            </button>
          </div>
        ))}
      </div>

      <p className="pl-6 text-[11px] leading-snug" style={{ color: '#fbbf24', opacity: 0.8 }}>
        Please finish or release {locks.length === 1 ? 'this test' : 'these tests'} before signing out
        or closing the app — the lock will block other testers.
      </p>
    </div>
  );
};

export default LockWarningBanner;
