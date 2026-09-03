import React, { useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';

interface PDFViewerProps {
  imageRef: React.RefObject<HTMLImageElement | null>;
  cursor?: string;
  overlays?: React.ReactNode;
  floats?: React.ReactNode;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  onMouseUp?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  onOpenFiles?: () => void;
  onDropFiles?: (files: File[]) => void;
  previewBase64?: string | null;
  previewLoading?: boolean;
  previewPageCount?: number;
}

const PDFViewer: React.FC<PDFViewerProps> = ({
  imageRef, cursor = 'default', overlays, floats,
  onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onClick,
  onOpenFiles, onDropFiles, previewBase64, previewLoading, previewPageCount,
}) => {
  const { hdPreviewBase64, isPreviewLoading, zoom, setZoom, baseDims, setBaseDims, currentPage, setCurrentPage, pageCount } = useWorkspace();
  const viewerRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const displayedPreview = previewBase64 || hdPreviewBase64;
  const displayedLoading = previewLoading ?? isPreviewLoading;
  const displayedPageCount = previewPageCount ?? pageCount;

  // Ctrl/Cmd+scroll zoom
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(z => Math.max(0.5, Math.min(4, +(z - e.deltaY * 0.002).toFixed(2))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  const handleImgLoad = () => {
    if (imageRef.current)
      setBaseDims({ w: imageRef.current.clientWidth, h: imageRef.current.clientHeight });
  };

  const imgStyle: React.CSSProperties = baseDims
    ? { width: baseDims.w * zoom, height: baseDims.h * zoom }
    : {
        maxWidth: viewerRef.current ? viewerRef.current.clientWidth : 'calc(100vw - 14rem)',
        maxHeight: viewerRef.current ? viewerRef.current.clientHeight : 'calc(100vh - 5rem)',
      };

  const handleDragOver = (e: React.DragEvent) => {
    if (!onDropFiles) return;
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!onDropFiles) return;
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length) onDropFiles(files);
  };

  return (
    <div
      ref={viewerRef}
      className="tpi-scroll-contained flex-1 relative bg-white min-h-0"
      style={{
        overflow: zoom > 1 ? 'auto' : 'hidden',
        display: 'flex',
        alignItems: zoom > 1 ? 'flex-start' : 'center',
        justifyContent: zoom > 1 ? 'flex-start' : 'center',
      }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-over overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-blue-500/10 border-2 border-blue-400/50 border-dashed rounded-sm flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-8 h-8 text-blue-400" />
            <p className="text-blue-300 text-sm font-medium">Drop PDFs here</p>
          </div>
        </div>
      )}
      {/* Loading state */}
      {displayedLoading && (
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-white/[0.08] border-t-gray-400" />
          <p className="text-gray-600 text-xs">Loading drawing…</p>
        </div>
      )}

      {/* Image + overlays */}
      {displayedPreview && (
        <>
          <div className="relative select-none" style={{ lineHeight: 0 }} onMouseDown={onMouseDown}>
            <img
              ref={imageRef}
              src={displayedPreview}
              alt="P&ID diagram"
              onLoad={handleImgLoad}
              className="block"
              style={{ cursor, filter: 'contrast(1.15)', imageRendering: 'auto', ...imgStyle }}
              onClick={onClick}
              draggable={false}
            />
            {overlays}
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-1 shadow-lg">
            <button
              onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors text-sm font-bold"
            >−</button>
            <button
              onClick={() => setZoom(1.0)}
              className="px-2 h-6 text-[11px] text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors font-mono"
            >{zoom === 1.0 ? 'fit' : `${Math.round(zoom * 100)}%`}</button>
            <button
              onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors text-sm font-bold"
            >+</button>
          </div>

          {displayedPageCount > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-1 shadow-lg">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || displayedLoading}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 disabled:opacity-25 transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 h-6 flex items-center text-[11px] text-gray-400 font-mono tabular-nums">
                {currentPage} / {displayedPageCount}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(displayedPageCount, p + 1))}
                disabled={currentPage >= displayedPageCount || displayedLoading}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 disabled:opacity-25 transition-colors"
                title="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {floats}
        </>
      )}
    </div>
  );
};

export default PDFViewer;
