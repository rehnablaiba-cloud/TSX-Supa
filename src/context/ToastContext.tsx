import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Toast, ToastVariant } from "../types";
import { v4 as uuid } from "uuid";

interface ToastCtx {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant) => void;
  removeToast: (id: string) => void;
}

const Ctx = createContext<ToastCtx>({} as ToastCtx);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const removeToast = useCallback((id: string) => {
    setToasts((p) => p.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = uuid();
      setToasts((p) => [...p, { id, message, variant }]);
      timers.current[id] = setTimeout(() => removeToast(id), 3500);
    },
    [removeToast]
  );

  return (
    <Ctx.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer />
    </Ctx.Provider>
  );
};

export const useToast = () => useContext(Ctx);

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useContext(Ctx);
  const colors: Record<ToastVariant, string> = {
    success: "border-[var(--color-pass)] bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_50%)]",
    error: "border-[var(--color-fail)]  bg-[var(--color-fail)]/10  text-[color-mix(in_srgb,var(--color-fail),white_50%)]",
    info: "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_10%,transparent)] text-[color-mix(in_srgb,var(--color-brand),white_50%)]",
    warning: "border-[var(--color-warn)] bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] text-[color-mix(in_srgb,var(--color-warn),white_50%)]",
  };
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm text-sm shadow-lg ${
            colors[t.variant]
          }`}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="opacity-60 hover:opacity-100 text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
