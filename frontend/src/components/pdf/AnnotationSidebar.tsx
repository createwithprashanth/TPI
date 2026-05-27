import { X } from "lucide-react";
import { usePdfContext } from "./context/PdfContext";

export default function AnnotationSidebar({ onClose }: { onClose?: () => void }) {
  const { annotations, dispatch } = usePdfContext();

  const all = Object.entries(annotations).flatMap(([page, list]) => list.map(a => ({ page: Number(page), a })));

  return (
    <div className="p-3">
      <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-3 border-b border-[#2b2b2b] bg-[#181818] px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#858585]">Review Items</div>
            <h3 className="mt-1 text-sm font-semibold text-[#cccccc]">Annotations</h3>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-[#cccccc] transition-colors hover:bg-[#2a2d2e] hover:text-white"
              title="Close annotations sidebar"
              aria-label="Close annotations sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      {all.length === 0 && (
        <div className="py-8 text-center text-xs text-[#858585]">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[3px] bg-[#1e1e1e]">
            <svg className="h-5 w-5 text-[#858585]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </div>
          <p>No annotations yet.</p>
        </div>
      )}
      <ul className="space-y-2">
        {all.map((it) => (
          <li key={it.a.id} className="flex items-center justify-between border border-[#2b2b2b] bg-[#1e1e1e] p-2 transition-colors hover:border-[#454545] hover:bg-[#252526]">
            <div>
              <div className="mb-0.5 text-xs font-semibold text-[#cccccc]">[{it.a.type}]</div>
              <div className="text-[11px] text-[#858585]">Page {it.page}</div>
            </div>
            <div className="flex gap-1">
              <button className="rounded-[3px] bg-[#0e639c] px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-[#1177bb]" onClick={() => dispatch({ type: "SET_PAGE", payload: it.page })}>Go</button>
              <button className="rounded-[3px] px-2 py-1 text-xs font-medium text-[#f48771] transition-colors hover:bg-[#5a1d1d] hover:text-white" onClick={() => dispatch({ type: "REMOVE_ANNOTATION", payload: { page: it.page, id: it.a.id } })}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
