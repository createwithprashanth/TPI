import { X } from "lucide-react";
import { usePdfContext } from "./context/PdfContext";

export default function AnnotationSidebar({ onClose }: { onClose?: () => void }) {
  const { annotations, dispatch } = usePdfContext();

  const all = Object.entries(annotations).flatMap(([page, list]) => list.map(a => ({ page: Number(page), a })));

  return (
    <div className="p-6">
      <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-6 border-b border-slate-700 bg-slate-950/95 px-6 py-4 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Review Items</div>
            <h3 className="mt-2 text-lg font-semibold text-white">Annotations</h3>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-all duration-200 hover:border-brand-primary/35 hover:bg-slate-800 hover:text-white"
              title="Close annotations sidebar"
              aria-label="Close annotations sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      {all.length === 0 && (
        <div className="py-8 text-center text-sm text-slate-500">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900">
            <svg className="h-6 w-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </div>
          <p>No annotations yet.</p>
        </div>
      )}
      <ul className="space-y-3">
        {all.map((it) => (
          <li key={it.a.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/90 p-4 transition-all duration-200 hover:border-brand-primary/35 hover:bg-slate-900">
            <div>
              <div className="mb-1 text-sm font-semibold text-white">[{it.a.type}]</div>
              <div className="text-xs text-slate-400">Page {it.page}</div>
            </div>
            <div className="flex gap-2">
              <button className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-primary-hover" onClick={() => dispatch({ type: "SET_PAGE", payload: it.page })}>Go</button>
              <button className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-all duration-200 hover:bg-red-500/20" onClick={() => dispatch({ type: "REMOVE_ANNOTATION", payload: { page: it.page, id: it.a.id } })}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
