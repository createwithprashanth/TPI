import { usePdfContext } from "./context/PdfContext";

export default function StatusBar({ mouseCoords }: { mouseCoords: { x: number; y: number } | null }) {
  const { currentPage, numPages, scale, isDirty, fitMode, viewMode, selectedTool, rotation } = usePdfContext();

  const fitLabel =
    fitMode === "fit-page" ? "Fit Page" :
    fitMode === "fit-width" ? "Fit Width" :
    "Custom";

  return (
    <div className="flex h-6 items-center justify-between border-t border-[#2b2b2b] bg-[#007acc] px-2 text-[11px] text-white">
      <div className="flex flex-wrap items-center gap-3">
        <div>Page <strong>{currentPage}</strong> / {numPages}</div>
        <div>Zoom <strong>{Math.round((scale || 1) * 100)}%</strong></div>
        <div>Fit <strong>{fitLabel}</strong></div>
        <div>View <strong className="capitalize">{viewMode}</strong></div>
        <div>Tool <strong className="capitalize">{selectedTool.replace("-", " ")}</strong></div>
        <div>Rotate <strong>{((rotation % 360) + 360) % 360}°</strong></div>
        <div className={`font-medium ${isDirty ? "text-amber-300" : "text-emerald-300"}`}>Status: {isDirty ? "Unsaved" : "Saved"}</div>
      </div>
      <div className="font-mono text-[11px] text-white/80">
        {mouseCoords ? `X: ${mouseCoords.x}, Y: ${mouseCoords.y}` : "-"}
      </div>
    </div>
  );
}
