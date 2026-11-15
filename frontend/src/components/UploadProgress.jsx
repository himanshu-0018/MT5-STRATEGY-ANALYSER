import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2, X, AlertTriangle } from "lucide-react";
import { uploadProgress } from "../lib/uploadProgress";

const human = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const UploadProgressHost = () => {
  const s = useSyncExternalStore(uploadProgress.subscribe, uploadProgress.snapshot, () => null);
  if (!s) return null;

  const building = s.phase === "building";
  const pct = building ? 100 : s.total ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0;
  const elapsed = Date.now() - s.startedAt;
  const etaMs = s.done > 0 ? (elapsed / s.done) * (s.total - s.done) : 0;
  const remaining = !building && s.done > 0 && s.done < s.total ? human(etaMs) : "";
  const title = building ? "Building portfolio" : "Reading reports";
  const sub = building
    ? "Merging every deal onto one timeline"
    : s.done >= s.total
      ? "Finishing up"
      : `Parsing ${Math.min(s.done + 1, s.total)} of ${s.total}`;

  return createPortal(
    <div
      data-testid="upload-progress"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
    >
      <div className="qf-card w-full max-w-lg p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="relative flex h-9 w-9 items-center justify-center border border-cyan-500/40 bg-cyan-500/10">
            {building ? (
              <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
            ) : (
              <FileText className="h-4 w-4 text-cyan-300" />
            )}
          </span>
          <div className="min-w-0">
            <div className="font-heading text-base font-semibold text-slate-50">{title}</div>
            <div className="qf-label mt-0.5">{sub}</div>
          </div>
          <span className="ml-auto font-mono text-3xl font-bold tabular-nums text-cyan-300" data-testid="upload-progress-pct">
            {pct}%
          </span>
        </div>

        <div className="mt-5 h-2 w-full overflow-hidden bg-slate-800">
          {building ? (
            <div className="qf-indeterminate h-full bg-gradient-to-r from-cyan-500 to-emerald-400" />
          ) : (
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 transition-[width] duration-150 ease-out"
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 font-mono text-[11px]">
          <span className="text-slate-400" data-testid="upload-progress-count">
            {s.done} / {s.total} files
            {s.failed > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-400">
                <AlertTriangle className="h-3 w-3" /> {s.failed} unreadable
              </span>
            )}
          </span>
          <span className="text-slate-500">{building ? "" : remaining ? `~${remaining} left` : elapsed > 1200 ? `${human(elapsed)} elapsed` : ""}</span>
        </div>

        {!building && s.current && (
          <div className="mt-3 truncate border border-slate-800 bg-slate-900/60 px-3 py-2 font-mono text-[11px] text-slate-400" title={s.current}>
            {s.current}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[10px] leading-relaxed text-slate-600">
            Parsed locally in your browser - nothing is uploaded anywhere.
          </p>
          <button
            type="button"
            data-testid="upload-cancel-button"
            onClick={() => uploadProgress.requestCancel()}
            className="flex shrink-0 items-center gap-1.5 border border-slate-700 px-3 py-1.5 text-[11px] font-mono text-slate-300 transition-colors hover:border-red-400 hover:text-red-300"
          >
            <X className="h-3 w-3" /> Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
