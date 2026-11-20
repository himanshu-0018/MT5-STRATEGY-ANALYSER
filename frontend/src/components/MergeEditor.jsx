import { useState } from "react";
import { X, Trash2, Layers, Check } from "lucide-react";
import { money } from "../lib/portfolio";

const partStats = (p) => {
  const deals = p.deals || [];
  return {
    trades: deals.filter((d) => d.isOut).length,
    net: deals.reduce((s, d) => s + (d.net || 0), 0),
  };
};

/**
 * Edit an existing merged EA: rename it, take strategies out (they return to the
 * list as their own rows) or fold more strategies in.
 */
export const MergeEditor = ({ merged, reports, onClose, onRemovePart, onAdd, onRename }) => {
  const [name, setName] = useState(merged.expert);
  const [addSel, setAddSel] = useState(() => new Set());

  const parts = merged.mergedParts || [];
  const partIds = new Set(parts.map((p) => p.id));
  const candidates = reports.filter((r) => r.id !== merged.id && !partIds.has(r.id) && !r.mergedParts);

  const toggleAdd = (id) => {
    setAddSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div data-testid="merge-editor" className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 p-4 sm:p-8 overflow-auto" onClick={onClose}>
      <div className="w-full max-w-3xl bg-[#0B0F19] border border-cyan-500/40 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan-300" />
            <h2 className="font-heading text-sm font-semibold text-slate-100">Edit merged EA</h2>
            <span className="qf-label">{parts.length} strategies</span>
          </div>
          <button data-testid="merge-editor-close" onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-slate-800">
          <label className="qf-label block mb-2">EA name</label>
          <div className="flex gap-2">
            <input
              data-testid="merge-editor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-600 px-2 py-1.5 text-sm text-slate-100 font-mono outline-none focus:border-cyan-400"
            />
            <button
              data-testid="merge-editor-rename"
              onClick={() => { onRename(merged.id, name); onClose(); }}
              disabled={!name.trim() || name.trim() === merged.expert}
              className="px-3 py-1.5 text-[11px] font-mono border border-cyan-400/60 bg-cyan-500/20 text-cyan-100 disabled:opacity-40 hover:bg-cyan-500/30"
            >
              Save name
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="qf-label mb-2">Strategies in this EA</div>
          <table className="w-full">
            <tbody>
              {parts.map((p) => {
                const st = partStats(p);
                const last = parts.length <= 2;
                return (
                  <tr key={p.id} data-testid={`merge-part-${p.id}`} className="border-b border-slate-800/70">
                    <td className="py-2 text-xs text-slate-200">
                      <div className="truncate max-w-[240px]" title={p.label}>{p.label}</div>
                      {p.eaExpert && <div className="text-[10px] text-slate-500 font-mono">EA: {p.eaExpert}</div>}
                    </td>
                    <td className="py-2 text-right font-mono text-[11px] text-slate-400">{st.trades} trades</td>
                    <td className={`py-2 text-right font-mono text-[11px] ${st.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(st.net, true)}</td>
                    <td className="py-2 pl-3 text-right">
                      <button
                        data-testid={`merge-part-remove-${p.id}`}
                        onClick={() => onRemovePart(merged.id, p.id)}
                        disabled={last}
                        title={last ? "A group needs at least two strategies" : "Remove from this EA (it returns as its own row)"}
                        className="text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:hover:text-slate-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {parts.length <= 2 && <p className="qf-label mt-2">A merged EA needs at least two strategies.</p>}
        </div>

        <div className="px-5 py-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="qf-label">Add more strategies</span>
            <button
              data-testid="merge-editor-add"
              disabled={!addSel.size}
              onClick={() => { onAdd(merged.id, addSel); onClose(); }}
              className="px-3 py-1.5 text-[11px] font-mono border border-cyan-400/60 bg-cyan-500/20 text-cyan-100 disabled:opacity-40 hover:bg-cyan-500/30"
            >
              Add {addSel.size || ""} selected
            </button>
          </div>
          <div className="max-h-56 overflow-auto border border-slate-800">
            {candidates.length === 0 && <p className="px-3 py-4 text-xs text-slate-500">No other strategies in the list.</p>}
            {candidates.map((r) => {
              const st = partStats(r);
              const on = addSel.has(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  data-testid={`merge-add-${r.id}`}
                  onClick={() => toggleAdd(r.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left border-b border-slate-800/60 transition-colors ${on ? "bg-cyan-500/15" : "hover:bg-slate-800/40"}`}
                >
                  <span className={`h-4 w-4 shrink-0 border flex items-center justify-center ${on ? "border-cyan-400 bg-cyan-500 text-slate-900" : "border-slate-500"}`}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-xs text-slate-200">{r.expert}</span>
                    <span className="block text-[10px] text-slate-500 font-mono">{st.trades} trades</span>
                  </span>
                  <span className={`font-mono text-[11px] ${st.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(st.net, true)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
