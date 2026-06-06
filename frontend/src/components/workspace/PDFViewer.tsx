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
}

const PDFViewer: React.FC<PDFViewerProps> = ({
  imageRef, cursor = 'default', overlays, floats,
  onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onClick,
  onOpenFiles, onDropFiles,
}) => {
  const { hdPreviewBase64, isPreviewLoading, zoom, setZoom, baseDims, setBaseDims, currentPage, setCurrentPage, pageCount } = useWorkspace();
  const viewerRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

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
      className="xyra-scroll-contained flex-1 relative bg-[#111114] min-h-0"
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

      {/* Empty state */}
      {!hdPreviewBase64 && !isPreviewLoading && (
        <div
          className="flex flex-col items-center gap-6 select-none cursor-pointer group"
          onClick={onOpenFiles}
        >
          {/* Logo + wordmark */}
          <div className="flex flex-col items-center gap-3">
            <img src="/favicon.png" alt="XYRA" className="w-10 h-10 opacity-40 group-hover:opacity-60 transition-opacity" />
            <p className="text-[11px] font-bold text-gray-700 tracking-[0.2em] uppercase">XYRA Studio</p>
          </div>

          {/* Drop zone card */}
          <div className="flex flex-col items-center gap-3 border border-dashed border-white/[0.08] rounded-2xl px-10 py-8 group-hover:border-white/[0.15] transition-colors">
            <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center group-hover:bg-white/[0.07] transition-colors">
              <Upload className="w-5 h-5 text-gray-500 group-hover:text-gray-300 transition-colors" />
            </div>
            <div className="text-center">
              <p className="text-gray-300 text-sm font-medium group-hover:text-white transition-colors">
                Drop P&ID drawings here
              </p>
              <p className="text-gray-600 text-xs mt-1">
                or click to browse &nbsp;·&nbsp; PDF &nbsp;·&nbsp; multi-page &nbsp;·&nbsp; batch
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isPreviewLoading && (
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-white/[0.08] border-t-gray-400" />
          <p className="text-gray-600 text-xs">Loading drawing…</p>
        </div>
      )}

      {/* Image + overlays */}
      {hdPreviewBase64 && (
        <>
          <div className="relative select-none" style={{ lineHeight: 0 }} onMouseDown={onMouseDown}>
            <img
              ref={imageRef}
              src={hdPreviewBase64}
              alt="P&ID diagram"
              onLoad={handleImgLoad}
              className="block"
              style={{ cursor, ...imgStyle }}
              onClick={onClick}
              draggable={false}
            />
            {overlays}
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 bg-[#0c0c0e]/90 backdrop-blur-sm border border-white/[0.07] rounded-lg px-1.5 py-1">
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

          {pageCount > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-[#0c0c0e]/90 backdrop-blur-sm border border-white/[0.07] rounded-lg px-1.5 py-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || isPreviewLoading}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 disabled:opacity-25 transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 h-6 flex items-center text-[11px] text-gray-400 font-mono tabular-nums">
                {currentPage} / {pageCount}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
                disabled={currentPage >= pageCount || isPreviewLoading}
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
