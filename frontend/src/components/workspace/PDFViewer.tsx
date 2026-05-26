import React, { useRef, useEffect } from 'react';
import { FolderOpen } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';

interface PDFViewerProps {
  /** Ref forwarded to the <img> — callers use it for coordinate calculations */
  imageRef: React.RefObject<HTMLImageElement | null>;
  cursor?: string;
  /** DOM overlays rendered inside the image wrapper (SVG, absolute divs) */
  overlays?: React.ReactNode;
  /** Absolute-positioned UI outside the image wrapper (panels, extract button) */
  floats?: React.ReactNode;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  onMouseUp?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  onOpenFiles?: () => void;
}

const PDFViewer: React.FC<PDFViewerProps> = ({
  imageRef, cursor = 'default', overlays, floats,
  onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onClick, onOpenFiles,
}) => {
  const { hdPreviewBase64, isPreviewLoading, zoom, setZoom, baseDims, setBaseDims } = useWorkspace();
  const viewerRef = useRef<HTMLDivElement>(null);

  // Ctrl+scroll zoom
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
    if (imageRef.current) {
      setBaseDims({ w: imageRef.current.clientWidth, h: imageRef.current.clientHeight });
    }
  };

  const imgStyle: React.CSSProperties = baseDims
    ? { width: baseDims.w * zoom, height: baseDims.h * zoom }
    : {
        maxWidth: viewerRef.current ? viewerRef.current.clientWidth : 'calc(100vw - 14rem)',
        maxHeight: viewerRef.current ? viewerRef.current.clientHeight : 'calc(100vh - 5rem)',
      };

  return (
    <div
      ref={viewerRef}
      className="flex-1 relative bg-gray-900 min-h-0"
      style={{
        overflow: zoom > 1 ? 'auto' : 'hidden',
        display: 'flex',
        alignItems: zoom > 1 ? 'flex-start' : 'center',
        justifyContent: zoom > 1 ? 'flex-start' : 'center',
      }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      {/* Empty state */}
      {!hdPreviewBase64 && !isPreviewLoading && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-gray-700 flex items-center justify-center">
            <FolderOpen className="w-7 h-7 text-gray-600" />
          </div>
          <div className="text-center">
            <p className="text-gray-300 font-medium text-sm">Open P&ID files to begin</p>
            <p className="text-gray-600 text-xs mt-1">PDF · single file or batch</p>
          </div>
          {onOpenFiles && (
            <button
              onClick={onOpenFiles}
              className="text-xs font-semibold text-white bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
            >
              Open Files
            </button>
          )}
        </div>
      )}

      {/* Preview loading */}
      {isPreviewLoading && (
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-gray-300" />
          <p className="text-gray-500 text-xs">Loading P&ID…</p>
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
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 bg-gray-950/80 backdrop-blur-sm border border-white/[0.08] rounded-lg px-1.5 py-1">
            <button
              onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-sm font-bold"
            >−</button>
            <button
              onClick={() => setZoom(1.0)}
              className="px-2 h-6 text-[11px] text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors font-mono"
            >{zoom === 1.0 ? 'fit' : `${Math.round(zoom * 100)}%`}</button>
            <button
              onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-sm font-bold"
            >+</button>
          </div>

          {floats}
        </>
      )}
    </div>
  );
};

export default PDFViewer;
