import React from "react";

interface Props {
  open: boolean; title: string; message: string;
  onConfirm: () => void; onCancel: () => void;
  confirmText?: string; danger?: boolean;
}

const ConfirmDialog: React.FC<Props> = ({ open, title, message, onConfirm, onCancel, confirmText = "Confirm", danger = false }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-gray-400 text-sm mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
          <button onClick={onConfirm}
            className={`${danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"} text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
export default ConfirmDialog;
