// src/components/Layout/ModalShell.tsx
import React, { useRef, useLayoutEffect } from "react";
import { X } from "lucide-react";
import gsap from "gsap";

interface ModalShellProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}

const ModalShell: React.FC<ModalShellProps> = ({
  title,
  onClose,
  children,
  maxWidth = 480,
}) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!backdropRef.current || !cardRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        backdropRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.25, ease: "power2.out" }
      );
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, scale: 0.96, y: 16 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.35,
          ease: "back.out(1.4)",
          delay: 0.05,
        }
      );
    });
    return () => ctx.revert();
  }, []);

  const handleClose = () => {
    if (!backdropRef.current || !cardRef.current) {
      onClose();
      return;
    }
    gsap.killTweensOf([cardRef.current, backdropRef.current]);
    gsap.to(cardRef.current, {
      opacity: 0,
      scale: 0.96,
      y: 12,
      duration: 0.2,
      ease: "power2.in",
    });
    gsap.to(backdropRef.current, {
      opacity: 0,
      duration: 0.2,
      ease: "power2.in",
      onComplete: onClose,
    });
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center backdrop-dim"
      style={{ opacity: 0 }}
      onClick={handleClose}
    >
      <div
        ref={cardRef}
        className="w-full glass-frost flex flex-col"
        style={{
          opacity: 0,
          maxWidth,
          maxHeight: "85vh",
          margin: "16px",
          borderRadius: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0 border-b"
          style={{
            borderColor:
              "color-mix(in srgb, var(--border-color) 50%, transparent)",
          }}
        >
          <h2 className="text-base font-bold text-t-primary tracking-tight">
            {title}
          </h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--bg-surface)_5%,transparent)] active:scale-90"
            style={{
              background: "color-mix(in srgb, var(--bg-card) 40%, transparent)",
            }}
          >
            <X size={14} className="text-t-muted" />
          </button>
        </div>

        {/* Scrollable content */}
        <div
          className="flex-1 overflow-y-auto px-5 py-4"
          style={{
            paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default ModalShell;
