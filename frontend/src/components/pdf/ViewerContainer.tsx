import { useState, useEffect, useRef } from "react";
import Toolbar from "./Toolbar";
import ThumbnailSidebar from "./ThumbnailSidebar";
import AnnotationSidebar from "./AnnotationSidebar";
import PIDSymbolPanel from "./pid/PIDSymbolPanel";
import StatusBar from "./StatusBar";
import { usePdfContext } from "./context/PdfContext";
import PdfRenderer from "./PdfRenderer";
import MiniMapOverlay from "./MiniMapOverlay";
import CommandPalette from "./CommandPalette";
import ReviewSessionBridge from "./ReviewSessionBridge";
import type { ToolName } from "./context/PdfState";

type ViewerContainerProps = {
  onOpenFile?: () => void;
  documentName?: string;
};

function ViewInner({ onOpenFile, documentName }: ViewerContainerProps) {
  const { pdfDoc, dispatch, selectedTool, fitMode, scale, showPidPanel, pidSelectedSymbolId, pidColor } = usePdfContext();
  const [mouseCoords, setMouseCoords] = useState<{ x: number; y: number } | null>(null);
  const [showPages, setShowPages] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(148);
  const [rightPanelWidth, setRightPanelWidth] = useState(308);
  const [isPanning, setIsPanning] = useState(false);
  const [viewportMetrics, setViewportMetrics] = useState({
    viewportWidth: 0,
    viewportHeight: 0,
    contentWidth: 0,
    contentHeight: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  
  // Track previous tool when spacebar is pressed for pan
  const previousToolRef = useRef<ToolName | null>(null);
  const isSpacePressedRef = useRef(false);
  const hasAppliedMobileFitRef = useRef(false);



  //adding center page variables
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [shouldCenter, setShouldCenter] = useState(true);
  const dragStateRef = useRef<{
    panel: "left" | "right";
    startX: number;
    startWidth: number;
  } | null>(null);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const currentScaleRef = useRef(scale);
  const zoomStateRef = useRef<{
    targetScale: number;
    docX: number;
    docY: number;
    viewportX: number;
    viewportY: number;
    rafId: number | null;
  } | null>(null);

  const updateViewportMetrics = () => {
    const viewport = scrollViewportRef.current;
    const content = pdfRef.current;
    if (!viewport || !content) return;

    setViewportMetrics({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      contentWidth: content.scrollWidth,
      contentHeight: content.scrollHeight,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    });
  };


  //measuring widths after render and on resize
  useEffect(()=> {
    if (!containerRef.current) return;

    function updateAlignment() {
      if(!pdfRef.current || !containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;  
      const pdfWidth = pdfRef.current.clientWidth;
      const isCentered = pdfWidth <= containerWidth;
      setShouldCenter(isCentered);
    }

    updateAlignment();

    const resizeObserver = new ResizeObserver(updateAlignment);
    resizeObserver.observe(containerRef.current);
    if (pdfRef.current) resizeObserver.observe(pdfRef.current);

    return () => resizeObserver.disconnect();
  }, [pdfDoc,scale,fitMode]);

  useEffect(() => {
    updateViewportMetrics();

    const viewport = scrollViewportRef.current;
    const content = pdfRef.current;
    if (!viewport || !content) return;

    const onScroll = () => updateViewportMetrics();
    const resizeObserver = new ResizeObserver(() => updateViewportMetrics());

    viewport.addEventListener("scroll", onScroll, { passive: true });
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);

    return () => {
      viewport.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [pdfDoc, scale, fitMode, leftPanelWidth, rightPanelWidth, showPages, showAnnotations]);

  useEffect(() => {
    currentScaleRef.current = scale || 1;
  }, [scale]);

  // Keyboard shortcuts for undo/redo and spacebar pan
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Prevent default browser undo/redo when we have a PDF loaded
      if (pdfDoc && e.ctrlKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
      }
      
      // Undo/Redo shortcuts
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) {
        dispatch({ type: "UNDO" });
      }
      if (e.ctrlKey && e.shiftKey && e.key === "Z") {
        dispatch({ type: "REDO" });
      }
      
      // Spacebar for temporary pan tool
      // Only activate if spacebar is pressed and not already in pan mode
      // Also check that we're not in an input field (to allow typing spaces)
      if (e.key === " " && !isSpacePressedRef.current) {
        const target = e.target as HTMLElement;
        const isInputField = target.tagName === "INPUT" || 
                            target.tagName === "TEXTAREA" || 
                            target.isContentEditable;
        
        if (!isInputField) {
          e.preventDefault(); // Prevent page scroll
          isSpacePressedRef.current = true;
          // Store current tool if it's not already pan
          if (selectedTool !== "pan") {
            previousToolRef.current = selectedTool;
            dispatch({ type: "SET_SELECTED_TOOL", payload: "pan" });
          } else {
            // If already in pan mode, don't store anything
            previousToolRef.current = null;
          }
        }
      }
    }
    
    function onKeyUp(e: KeyboardEvent) {
      // Restore previous tool when spacebar is released
      if (e.key === " " && isSpacePressedRef.current) {
        isSpacePressedRef.current = false;
        // Only restore if we have a stored tool and we're currently in pan mode
        // (user might have manually switched tools while spacebar was held)
        if (previousToolRef.current && selectedTool === "pan") {
          dispatch({ type: "SET_SELECTED_TOOL", payload: previousToolRef.current });
          previousToolRef.current = null;
        }
      }
    }
    
    // Handle case where spacebar might be released outside the window
    function onBlur() {
      if (isSpacePressedRef.current) {
        isSpacePressedRef.current = false;
        if (previousToolRef.current && selectedTool === "pan") {
          dispatch({ type: "SET_SELECTED_TOOL", payload: previousToolRef.current });
          previousToolRef.current = null;
        }
      }
    }
    
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [dispatch, pdfDoc, selectedTool]);

  // On small screens, default to "fit-width" once so the page fills the viewport
  useEffect(() => {
    const applyMobileFit = () => {
      if (window.innerWidth < 768 && !hasAppliedMobileFitRef.current) {
        // Only auto-apply if user hasn't chosen a fit mode yet
        if (fitMode !== "fit-width") {
          dispatch({ type: "SET_FIT_MODE", payload: "fit-width" });
        }
        hasAppliedMobileFitRef.current = true;
      }
    };

    applyMobileFit();
    window.addEventListener("resize", applyMobileFit);
    return () => window.removeEventListener("resize", applyMobileFit);
  }, [dispatch, fitMode]);

  useEffect(() => {
    const handleOpenShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onOpenFile?.();
      }
    };

    window.addEventListener("keydown", handleOpenShortcut);
    return () => window.removeEventListener("keydown", handleOpenShortcut);
  }, [onOpenFile]);

  const clampScale = (nextScale: number) => Math.min(8, Math.max(0.25, nextScale));

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const animateZoom = () => {
      const zoomState = zoomStateRef.current;
      const liveViewport = scrollViewportRef.current;
      if (!zoomState || !liveViewport) return;

      const currentScale = currentScaleRef.current || 1;
      const diff = zoomState.targetScale - currentScale;

      if (Math.abs(diff) < 0.002) {
        currentScaleRef.current = zoomState.targetScale;
        dispatch({ type: "SET_SCALE", payload: zoomState.targetScale });
        liveViewport.scrollLeft = zoomState.docX * zoomState.targetScale - zoomState.viewportX;
        liveViewport.scrollTop = zoomState.docY * zoomState.targetScale - zoomState.viewportY;
        zoomStateRef.current = null;
        return;
      }

      const nextScale = currentScale + diff * 0.22;
      currentScaleRef.current = nextScale;
      dispatch({ type: "SET_SCALE", payload: nextScale });
      liveViewport.scrollLeft = zoomState.docX * nextScale - zoomState.viewportX;
      liveViewport.scrollTop = zoomState.docY * nextScale - zoomState.viewportY;
      zoomState.rafId = window.requestAnimationFrame(animateZoom);
    };

    const handleWheel = (e: WheelEvent) => {
      if (!pdfDoc || !e.ctrlKey) return;

      e.preventDefault();

      const rect = viewport.getBoundingClientRect();
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;

      const currentScale = currentScaleRef.current || scale || 1;
      const zoomFactor = Math.exp(-e.deltaY * 0.0012);
      const baseScale = zoomStateRef.current?.targetScale ?? currentScale;
      const nextScale = clampScale(baseScale * zoomFactor);

      if (Math.abs(nextScale - currentScale) < 0.001) return;

      dispatch({ type: "SET_FIT_MODE", payload: "custom" });
      zoomStateRef.current = {
        targetScale: nextScale,
        docX: (viewport.scrollLeft + viewportX) / currentScale,
        docY: (viewport.scrollTop + viewportY) / currentScale,
        viewportX,
        viewportY,
        rafId: zoomStateRef.current?.rafId ?? null,
      };

      if (!zoomStateRef.current.rafId) {
        zoomStateRef.current.rafId = window.requestAnimationFrame(animateZoom);
      }
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      if (zoomStateRef.current?.rafId) {
        window.cancelAnimationFrame(zoomStateRef.current.rafId);
      }
      zoomStateRef.current = null;
    };
  }, [dispatch, pdfDoc, scale]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      if (dragState.panel === "left") {
        const nextWidth = Math.min(260, Math.max(112, dragState.startWidth + (event.clientX - dragState.startX)));
        setLeftPanelWidth(nextWidth);
      } else {
        const nextWidth = Math.min(420, Math.max(240, dragState.startWidth - (event.clientX - dragState.startX)));
        setRightPanelWidth(nextWidth);
      }
    };

    const onUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pdfDoc || selectedTool !== "pan" || event.button !== 0) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    panStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleViewportPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panStateRef.current) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const deltaX = event.clientX - panStateRef.current.startX;
    const deltaY = event.clientY - panStateRef.current.startY;

    viewport.scrollLeft = panStateRef.current.scrollLeft - deltaX;
    viewport.scrollTop = panStateRef.current.scrollTop - deltaY;
  };

  const endViewportPan = () => {
    if (!panStateRef.current) return;
    panStateRef.current = null;
    setIsPanning(false);
  };

  const startResize = (panel: "left" | "right", event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      panel,
      startX: event.clientX,
      startWidth: panel === "left" ? leftPanelWidth : rightPanelWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#181818]">
      <Toolbar
        onOpenFile={onOpenFile}
        isEmptyState={!pdfDoc}
        showPages={showPages}
        showAnnotations={showAnnotations}
        onTogglePages={() => setShowPages((prev) => !prev)}
        onToggleAnnotations={() => setShowAnnotations((prev) => !prev)}
      />
      <CommandPalette
        onOpenFile={onOpenFile}
        showPages={showPages}
        showAnnotations={showAnnotations}
        onTogglePages={() => setShowPages((prev) => !prev)}
        onToggleAnnotations={() => setShowAnnotations((prev) => !prev)}
      />
      <ReviewSessionBridge documentName={documentName} />
      <div className="flex flex-1 overflow-hidden">
        {!pdfDoc ? (
          <div
            className="relative flex-1 overflow-hidden bg-[#1e1e1e]"
            onDoubleClick={() => onOpenFile?.()}
          >
            <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(#ffffff 0.6px, transparent 0.6px)", backgroundSize: "6px 6px" }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-xs tracking-[0.16em] text-slate-300/70 uppercase">
                Double-click or use File to open a PDF
              </p>
            </div>
          </div>
        ) : (
          <>
        {/* Thumbnail sidebar: hidden on small screens to maximize space */}
        <div
          className={`${showPages ? "hidden overflow-auto border-r border-[#2b2b2b] bg-[#181818] text-[#cccccc] md:block" : "hidden"}`}
          style={showPages ? { width: `${leftPanelWidth}px` } : undefined}
        >
          <ThumbnailSidebar />
        </div>
        {showPages ? (
          <div
            className="hidden w-1 cursor-col-resize bg-[#1e1e1e] transition-colors hover:bg-[#3794ff] md:block"
            onMouseDown={(event) => startResize("left", event)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize pages panel"
          />
        ) : null}
        <div
          ref={scrollViewportRef}
          className={`xyra-scroll-contained flex-1 overflow-auto bg-[#1e1e1e] p-2 md:p-3 ${selectedTool === "pan" ? (isPanning ? "cursor-grabbing" : "cursor-grab") : ""}`}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={endViewportPan}
          onPointerCancel={endViewportPan}
          onPointerLeave={() => {
            if (!isPanning) setMouseCoords(null);
          }}
        >
            <div
              ref={containerRef}
              className={`flex min-h-full w-full ${shouldCenter ? "justify-center" : "justify-start"}`}
            >
              <div ref={pdfRef} className="pb-3">
                <PdfRenderer onPointerMove={setMouseCoords} />
              </div>
            </div>
            {viewportMetrics.contentWidth > viewportMetrics.viewportWidth * 1.08 ||
            viewportMetrics.contentHeight > viewportMetrics.viewportHeight * 1.08 ? (
              <MiniMapOverlay
                contentWidth={viewportMetrics.contentWidth}
                contentHeight={viewportMetrics.contentHeight}
                viewportWidth={viewportMetrics.viewportWidth}
                viewportHeight={viewportMetrics.viewportHeight}
                scrollLeft={viewportMetrics.scrollLeft}
                scrollTop={viewportMetrics.scrollTop}
                onNavigate={(nextLeft, nextTop) => {
                  const viewport = scrollViewportRef.current;
                  if (!viewport) return;

                  viewport.scrollTo({
                    left: Math.max(
                      0,
                      Math.min(nextLeft, Math.max(0, viewportMetrics.contentWidth - viewportMetrics.viewportWidth)),
                    ),
                    top: Math.max(
                      0,
                      Math.min(nextTop, Math.max(0, viewportMetrics.contentHeight - viewportMetrics.viewportHeight)),
                    ),
                    behavior: "smooth",
                  });
                }}
              />
            ) : null}
        </div>
        {/* P&ID Symbol Panel */}
        {showPidPanel && (
          <>
            <div
              className="hidden w-1 bg-[#1e1e1e] md:block"
              role="separator"
              aria-orientation="vertical"
            />
            <div
              className="hidden border-l border-[#2b2b2b] bg-[#181818] text-[#cccccc] md:block"
              style={{ width: "260px" }}
            >
              <PIDSymbolPanel
                selectedSymbolId={pidSelectedSymbolId}
                onSelectSymbol={(id) => dispatch({ type: "SET_PID_SYMBOL", payload: id })}
                activeColor={pidColor}
                onColorChange={(color) => dispatch({ type: "SET_PID_COLOR", payload: color })}
                onClose={() => {
                  dispatch({ type: "SET_SHOW_PID_PANEL", payload: false });
                  dispatch({ type: "SET_SELECTED_TOOL", payload: "select" });
                }}
              />
            </div>
          </>
        )}

        {/* Annotation list sidebar: hidden on small screens, annotations still work on the page */}
        {showAnnotations ? (
          <div
            className="hidden w-1 cursor-col-resize bg-[#1e1e1e] transition-colors hover:bg-[#3794ff] md:block"
            onMouseDown={(event) => startResize("right", event)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize review panel"
          />
        ) : null}
        <div
          className={`${showAnnotations ? "hidden overflow-auto border-l border-[#2b2b2b] bg-[#181818] text-[#cccccc] md:block" : "hidden"}`}
          style={showAnnotations ? { width: `${rightPanelWidth}px` } : undefined}
        >
          <AnnotationSidebar onClose={() => setShowAnnotations(false)} />
        </div>
          </>
        )}
      </div>
      {pdfDoc ? <StatusBar mouseCoords={mouseCoords} /> : null}
    </div>
  );
}

export default function ViewerContainer({ onOpenFile, documentName }: ViewerContainerProps) {
  // NOTE: App.tsx already wraps the whole app in <PdfProvider>,
  // so we just render the inner viewer here to use that context.
  return <ViewInner onOpenFile={onOpenFile} documentName={documentName} />;
}
