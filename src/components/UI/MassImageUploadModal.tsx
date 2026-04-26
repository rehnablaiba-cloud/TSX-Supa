import React, { useState } from "react";
import { supabase } from "../../supabase";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type UploadRow = {
  fileName: string;
  status: "pending" | "done" | "error" | "skipped";
  message?: string;
};

const BUCKET = "test_steps";

const MassImageUploadModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);

  if (!isOpen) return null;

  const updateRow = (fileName: string, patch: Partial<UploadRow>) => {
    setRows((prev) =>
      prev.map((row) =>
        row.fileName === fileName ? { ...row, ...patch } : row
      )
    );
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    const fileArray = Array.from(files);

    setRows(
      fileArray.map((file) => ({
        fileName: file.name,
        status: "pending",
      }))
    );

    setUploading(true);

    for (const file of fileArray) {
      try {
        // CORRECT: anchor on the _false/_true suffix so digits after it are unambiguously the image number
        const match = file.name.match(
          /^(.+_(true|false))(\d+)\.(jpg|jpeg|png|webp|gif)$/i
        );
        if (!match) {
          updateRow(file.name, {
            status: "skipped",
            message: "Wrong filename format",
          });
          continue;
        }

        const stepId = match[1]; // e.g. "Water Tightness Test_106_false"
        const imageNumber = Number(match[3]); // e.g. 1, 2, 3...
        const ext = match[4].toLowerCase();
        const path = `${stepId}_${imageNumber}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: true });

        if (uploadError) throw uploadError;

        const columnName =
          imageNumber % 2 === 0 ? "expected_image_urls" : "action_image_urls";

        const { data: stepRow, error: fetchError } = await supabase
          .from("test_steps")
          .select("id, action_image_urls, expected_image_urls")
          .eq("id", stepId)
          .single();

        if (fetchError || !stepRow) {
          updateRow(file.name, {
            status: "error",
            message: "Step ID not found in test_steps",
          });
          continue;
        }

        const existing =
          columnName === "action_image_urls"
            ? stepRow.action_image_urls || []
            : stepRow.expected_image_urls || [];

        const next = Array.from(new Set([...existing, path])).sort((a, b) => {
          const aNum = Number(a.split("_").pop()?.split(".")[0] || 0);
          const bNum = Number(b.split("_").pop()?.split(".")[0] || 0);
          return aNum - bNum;
        });

        const { error: updateError } = await supabase
          .from("test_steps")
          .update({ [columnName]: next })
          .eq("id", stepId);

        if (updateError) throw updateError;

        updateRow(file.name, {
          status: "done",
          message:
            columnName === "action_image_urls"
              ? "Saved to Action"
              : "Saved to Expected",
        });
      } catch (err: any) {
        updateRow(file.name, {
          status: "error",
          message: err?.message || "Upload failed",
        });
      }
    }

    setUploading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        backgroundColor: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border shadow-2xl p-6 flex flex-col gap-4"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-color)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-t-primary">
              Mass Upload Images
            </h2>
            <p className="text-sm text-t-muted mt-1">
              File name must be: stepId_number.jpg
            </p>
            <p className="text-xs text-t-muted mt-1">
              Odd number = Action, Even number = Expected Result
            </p>
          </div>

          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border text-sm font-semibold text-t-secondary hover:text-t-primary"
            style={{ borderColor: "var(--border-color)" }}
          >
            Close
          </button>
        </div>

        <div
          className="rounded-xl border border-dashed p-6 text-center"
          style={{
            borderColor: "var(--border-color)",
            backgroundColor: "var(--bg-card)",
          }}
        >
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={uploading}
            className="block w-full text-sm text-t-primary"
          />
          <p className="text-xs text-t-muted mt-3">
            Example: 123e4567-e89b-12d3-a456-426614174000_1.jpg
          </p>
        </div>

        <div
          className="max-h-80 overflow-auto rounded-xl border"
          style={{ borderColor: "var(--border-color)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: "var(--border-color)" }}
              >
                <th className="text-left px-3 py-2 text-xs text-t-muted">
                  File
                </th>
                <th className="text-left px-3 py-2 text-xs text-t-muted">
                  Status
                </th>
                <th className="text-left px-3 py-2 text-xs text-t-muted">
                  Message
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-3 py-6 text-center text-t-muted text-sm"
                  >
                    No files selected yet
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.fileName}
                    className="border-b last:border-b-0"
                    style={{ borderColor: "var(--border-color)" }}
                  >
                    <td className="px-3 py-2 text-t-primary break-all">
                      {row.fileName}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          row.status === "done"
                            ? "bg-[color-mix(in_srgb,var(--color-pass)_15%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)]"
                            : row.status === "error"
                            ? "bg-[var(--color-fail)]/15 text-[var(--color-fail)]"
                            : row.status === "skipped"
                            ? "bg-[color-mix(in_srgb,var(--color-warn)_15%,transparent)] text-[color-mix(in_srgb,var(--color-warn),white_30%)]"
                            : "bg-[var(--border-color)] text-t-muted"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-t-muted text-xs">
                      {row.message || "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MassImageUploadModal;
