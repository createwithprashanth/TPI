import { usePdfContext } from "./context/PdfContext";

export default function StatusBar({ mouseCoords }: { mouseCoords: { x: number; y: number } | null }) {
  const { currentPage, numPages, scale, isDirty, fitMode, viewMode, selectedTool, rotation } = usePdfContext();

  const fitLabel =
    fitMode === "fit-page" ? "Fit Page" :
    fitMode === "fit-width" ? "Fit Width" :
    "Custom";

  return (
    <div className="flex h-11 items-center justify-between border-t border-slate-700 bg-slate-950 px-4 text-xs text-slate-300">
      <div className="flex flex-wrap items-center gap-4">
        <div className="font-medium">Page <strong className="text-white">{currentPage}</strong> / {numPages}</div>
        <div className="font-medium">Zoom <strong className="text-white">{Math.round((scale || 1) * 100)}%</strong></div>
        <div className="font-medium">Fit <strong className="text-white">{fitLabel}</strong></div>
        <div className="font-medium">View <strong className="text-white capitalize">{viewMode}</strong></div>
        <div className="font-medium">Tool <strong className="text-white capitalize">{selectedTool.replace("-", " ")}</strong></div>
        <div className="font-medium">Rotate <strong className="text-white">{((rotation % 360) + 360) % 360}°</strong></div>
        <div className={`font-medium ${isDirty ? "text-amber-300" : "text-emerald-300"}`}>Status: {isDirty ? "Unsaved" : "Saved"}</div>
      </div>
      <div className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-[11px] text-slate-400">
        {mouseCoords ? `X: ${mouseCoords.x}, Y: ${mouseCoords.y}` : "-"}
      </div>
    </div>
  );
}
