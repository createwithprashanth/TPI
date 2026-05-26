// src/components/pdf/SearchHighlightLayer.tsx

import { useEffect, useRef } from "react";
import { usePdfContext } from "./context/PdfContext";

type SearchHighlightLayerProps = {
  pageNumber: number;
  width: number;
  height: number;
};

export default function SearchHighlightLayer({
  pageNumber,
  width,
  height,
}: SearchHighlightLayerProps) {
  const { search, pdfDoc, scale, rotation } = usePdfContext();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !pdfDoc) return;

    const container = containerRef.current;
    container.innerHTML = "";

    // Find matches for this page
    const pageMatch = search.matches.find((match) => match.page === pageNumber);
    if (!pageMatch || !pageMatch.rect || pageMatch.rect.length === 0) {
      return;
    }

    // Get the page to access viewport for coordinate transformation
    pdfDoc.getPage(pageNumber).then((page) => {
      const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
      
      // Calculate the effective scale from the viewport dimensions
      // The width/height passed to this component are the actual viewport dimensions
      // which already account for the scale and rotation
      const effectiveScale = width / baseViewport.width;
      
      // Calculate total match index across all pages to determine active match
      let totalMatchIndex = 0;
      for (const match of search.matches) {
        if (match.page < pageNumber) {
          totalMatchIndex += match.rect.length;
        } else if (match.page === pageNumber) {
          break;
        }
      }

      // Render highlights for each rect in this page's matches
      pageMatch.rect.forEach((rect, rectIndex) => {
        const matchIndex = totalMatchIndex + rectIndex;
        const isActive = matchIndex === search.activeIndex;

        // Transform PDF coordinates to viewport coordinates
        // PDF coordinates: (0,0) at bottom-left, y increases upward
        // Viewport coordinates: (0,0) at top-left, y increases downward
        // The rect coordinates from findInPdf are in PDF space at scale 1
        
        // X coordinate: simple scale
        const x = rect.x * effectiveScale;
        
        // Y coordinate: flip from PDF (bottom-up) to viewport (top-down)
        // rect.y is the baseline in PDF coordinates, rect.height is the font size
        // We need to position the highlight at the top of the text
        const pdfPageHeight = baseViewport.height;
        // Convert from PDF Y (baseline) to viewport Y (top of text box)
        const y = (pdfPageHeight - rect.y - rect.height) * effectiveScale;
        
        // Width and height scaled
        const w = rect.width * effectiveScale;
        const h = rect.height * effectiveScale;

        const highlight = document.createElement("div");
        highlight.style.position = "absolute";
        highlight.style.left = `${x}px`;
        highlight.style.top = `${y}px`;
        highlight.style.width = `${w}px`;
        highlight.style.height = `${h}px`;
        highlight.style.backgroundColor = isActive
          ? "rgba(255, 255, 0, 0.5)" // Yellow for active match
          : "rgba(255, 255, 0, 0.3)"; // Lighter yellow for other matches
        highlight.style.pointerEvents = "none"; // Allow clicks to pass through
        highlight.style.border = isActive ? "2px solid rgba(255, 200, 0, 0.8)" : "none";
        highlight.style.borderRadius = "2px";
        highlight.style.zIndex = "10"; // Above text layer but below annotations
        
        // Add data attribute for active match to enable scroll-into-view
        if (isActive) {
          highlight.setAttribute("data-active-search-match", "true");
          highlight.setAttribute("data-match-index", matchIndex.toString());
        }

        container.appendChild(highlight);
      });
    });
  }, [search, pageNumber, width, height, pdfDoc]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: "none",
      }}
    />
  );
}
