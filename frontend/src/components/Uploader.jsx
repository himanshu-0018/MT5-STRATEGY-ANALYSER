import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

const MODES = [
  { key: "per-ea", label: "One file per EA", hint: "Each report is its own strategy" },
  { key: "multi", label: "Files hold several EAs", hint: "Split a file into one strategy per EA" },
];

export const Uploader = ({ onFiles, compact, mode = "per-ea", onModeChange }) => {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    onFiles(Array.from(e.dataTransfer.files));
  };
  return (
    <div className="qf-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="qf-label">What are you uploading?</span>
        <div data-testid="upload-mode-toggle" className="flex border border-slate-700">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              data-testid={`upload-mode-${m.key}`}
              title={m.hint}
              onClick={() => onModeChange && onModeChange(m.key)}
              className={`px-3 py-1.5 text-[11px] font-mono transition-colors ${mode === m.key ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-500 font-mono">
          {mode === "multi"
            ? "Strategies are split by the magic number, or by the EA tag in each trade's comment."
            : "Every file is treated as one strategy - the report name is the label."}
        </span>
      </div>

      <div
        data-testid="file-drop-area"
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`qf-drop group cursor-pointer border border-dashed transition-colors duration-200 ${over ? "border-cyan-400 bg-cyan-400/5" : "border-slate-700 hover:border-slate-500"} ${compact ? "px-5 py-4 flex items-center gap-4" : "px-8 py-16 flex flex-col items-start gap-5"}`}
    >
      <UploadCloud className={`text-cyan-400 transition-transform duration-300 group-hover:-translate-y-0.5 ${compact ? "h-6 w-6" : "h-10 w-10"}`} />
      <div>
        <p className={`font-heading font-semibold text-slate-100 ${compact ? "text-sm" : "text-xl"}`}>
          {compact ? "Add more MT5 reports" : "Drop MT5 Strategy Tester reports here"}
        </p>
        <p className="text-xs text-slate-400 mt-1">.html / .htm exports — multiple files supported. Parsed locally in your browser.</p>
      </div>
      <input
        ref={ref}
        data-testid="file-input-element"
        type="file"
        accept=".html,.htm"
        multiple
        className="hidden"
        onChange={(e) => { onFiles(Array.from(e.target.files)); e.target.value = ""; }}
      />
      </div>
    </div>
  );
};
