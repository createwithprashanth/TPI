// src/components/pdf/PdfPage.tsx

import { useEffect, useRef, useState } from "react";
import { usePdfContext } from "./context/PdfContext";
import TextLayer from "./TextLayer";
import AnnotationLayer from "./AnnotationLayer";
import SearchHighlightLayer from "./SearchHighlightLayer";

type PdfPageProps = {
  pageNumber: number;
  onPointerMove?: (pt: { x: number; y: number }) => void;
};

export default function PdfPage({ pageNumber, onPointerMove }: PdfPageProps) {
  const { pdfDoc, scale, rotation, fitMode, selectedTool, searchResults, currentMatchIndex } = usePdfContext();
  const FIT_GUTTER = 24;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [textContent, setTextContent] = useState<any>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [calculatedScale, setCalculatedScale] = useState<number>(scale);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);

  // Track container size with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    let scrollContainer: HTMLElement | null = null;

    const updateSize = () => {
      if (!containerRef.current) return;

      if (!scrollContainer) {
        let parent: HTMLElement | null = containerRef.current.parentElement;
        while (parent && !parent.classList.contains("overflow-auto")) {
          parent = parent.parentElement;
        }
        scrollContainer = parent;
      }

      if (scrollContainer) {
        const styles = window.getComputedStyle(scrollContainer);
        const paddingX =
          parseFloat(styles.paddingLeft || "0") +
          parseFloat(styles.paddingRight || "0");
        const paddingY =
          parseFloat(styles.paddingTop || "0") +
          parseFloat(styles.paddingBottom || "0");

        setContainerSize({
          width: Math.max(0, scrollContainer.clientWidth - paddingX - FIT_GUTTER),
          height: Math.max(0, scrollContainer.clientHeight - paddingY - FIT_GUTTER),
        });
      } else {
        setContainerSize({
          width: Math.max(0, window.innerWidth - 420 - FIT_GUTTER),
          height: Math.max(0, window.innerHeight - 180 - FIT_GUTTER),
        });
      }
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);

    if (!scrollContainer) {
      let parent: HTMLElement | null = containerRef.current.parentElement;
      while (parent && !parent.classList.contains("overflow-auto")) {
        parent = parent.parentElement;
      }
      scrollContainer = parent;
    }

    if (scrollContainer) {
      resizeObserver.observe(scrollContainer);
    } else {
      window.addEventListener("resize", updateSize);
    }

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);


  
  // Calculate scale based on fitMode
  useEffect(() => {
    if (!pdfDoc || fitMode === "custom") {
      setCalculatedScale(scale);
      return;
    }

    if (!containerSize) return; // Wait for container size

    let cancelled = false;

    (async () => {
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;

      // Use viewport with rotation applied (but scale 1) to get correct dimensions after rotation
      const baseViewport = page.getViewport({ scale: 1, rotation });
      
      let newScale = scale;

      if (fitMode === "fit-width") {
        // Calculate scale to fit page width to available width
        newScale = containerSize.width / baseViewport.width;
      } else if (fitMode === "fit-page") {
        // Calculate scale to fit entire page (both width and height)
        const scaleX = containerSize.width / baseViewport.width;
        const scaleY = containerSize.height / baseViewport.height;
        newScale = Math.min(scaleX, scaleY);
      }

      if (!cancelled) {
        setCalculatedScale(Math.max(0.1, Math.min(newScale, 8)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, scale, rotation, fitMode, containerSize]);

  useEffect(() => {
    if (!pdfDoc) return;

    let cancelled = false;

    (async () => {
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale: calculatedScale, rotation });
      const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
      const cssWidth = Math.round(viewport.width);
      const cssHeight = Math.round(viewport.height);
      setViewportSize({ width: cssWidth, height: cssHeight });

      const text = await page.getTextContent();
      if (!cancelled) {
        setTextContent({
          ...text,
          _viewport: viewport,
          _baseViewport: baseViewport,
        });
      }

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const outputScale = Math.max(1, window.devicePixelRatio || 1);

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.style.imageRendering = "auto";
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        canvas,
      });

      await renderTask.promise;
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, calculatedScale, rotation]);

  // Get cursor style based on tool
  const getCursor = () => {
    if (selectedTool === "highlight") return "crosshair";
    if (selectedTool === "shape-rect" || selectedTool === "shape-circle") return "crosshair";
    if (selectedTool === "arrow") return "crosshair";
    if (selectedTool === "textbox") return "text";
    if (selectedTool === "pan") return "grab";
    if (selectedTool === "select") return "text";
    return "default";
  };

  const isAnnotationTool =
    selectedTool === "highlight" ||
                          selectedTool === "draw" ||
                          selectedTool === "shape-rect" || 
                          selectedTool === "shape-circle" || 
                          selectedTool === "arrow" || 
                          selectedTool === "textbox";

  // Center the page on wide screens when the rendered width is less than
  // or equal to the available container width; otherwise left-align so
  // horizontal scrolling reveals hidden content.
  const shouldCenterOnWideScreens =
    !!viewportSize &&
    !!containerSize &&
    viewportSize.width <= containerSize.width;

  return (
    <div
      ref={containerRef}
      className={`relative flex my-3 justify-start ${
        shouldCenterOnWideScreens ? "md:justify-center" : "md:justify-start"
      } w-full`}
    >
      <div
        className="relative overflow-hidden bg-white"
        style={
          viewportSize
            ? { 
                width: viewportSize.width, 
                height: viewportSize.height,
                cursor: isAnnotationTool || selectedTool === "pan" ? getCursor() : "default",
                // Allow native panning/scrolling even when zoomed
                touchAction: "pan-y pan-x"
              }
            : undefined
        }
      >
        {/* CANVAS */}
        <canvas
          ref={canvasRef}
          style={{
            pointerEvents: selectedTool === "select" ? "none" : "auto" // Disable canvas pointer events when selecting text so text layer can receive them
          }}
          onPointerMove={(e) => {
            if (!canvasRef.current || selectedTool === "select") return; // Don't handle pointer move when selecting text
            const rect = canvasRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            onPointerMove?.({ x: Math.round(x), y: Math.round(y) });
          }}
        />

        {/* TEXT LAYER */}
        {textContent && viewportSize && (
          <TextLayer
            textContent={textContent}
            scale={calculatedScale}
            rotation={rotation}
            width={viewportSize.width}
            height={viewportSize.height}
            selectedTool={selectedTool}
            searchResults={searchResults}
            currentMatchIndex={currentMatchIndex}
            pageNumber={pageNumber}
          />
        )}

        {/* SEARCH HIGHLIGHT LAYER */}
        {viewportSize && (
          <SearchHighlightLayer
            pageNumber={pageNumber}
            width={viewportSize.width}
            height={viewportSize.height}
          />
        )}

        {/* ANNOTATION LAYER */}
        {viewportSize && (
          <AnnotationLayer
            pageNumber={pageNumber}
            width={viewportSize.width}
            height={viewportSize.height}
          />
        )}
      </div>
    </div>
  );
}
