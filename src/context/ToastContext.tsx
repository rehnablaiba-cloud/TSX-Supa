import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Toast, ToastVariant } from "../types";
import { v4 as uuid } from "uuid";

interface ToastCtx {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant) => void;
  removeToast: (id: string) => void;
}

const Ctx = createContext<ToastCtx>({} as ToastCtx);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const removeToast = useCallback((id: string) => {
    setToasts(p => p.filter(t => t.id !== id));
    clearTimeout(timers.current[id]);
  }, []);

  const addToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = uuid();
    setToasts(p => [...p, { id, message, variant }]);
    timers.current[id] = setTimeout(() => removeToast(id), 3500);
  }, [removeToast]);

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
    success: "border-green-500 bg-green-500/10 text-green-300",
    error:   "border-red-500  bg-red-500/10  text-red-300",
    info:    "border-blue-500 bg-blue-500/10 text-blue-300",
  };
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full">
      {toasts.map(t => (
        <div key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm text-sm shadow-lg ${colors[t.variant]}`}>
          <span className="flex-1">{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="opacity-60 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      ))}
    </div>
  );
};
