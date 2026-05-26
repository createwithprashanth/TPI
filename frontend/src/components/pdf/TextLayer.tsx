// src/components/pdf/TextLayer.tsx

import { useEffect, useRef } from "react";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { SearchMatch } from "./utils/searchUtils";

type Props = {
  textContent: TextContent | null;
  scale: number;
  rotation: number;
  width: number;
  height: number;
  selectedTool?: string;
  searchResults?: SearchMatch[];
  currentMatchIndex?: number;
  pageNumber?: number;
};

export default function TextLayer({ 
  textContent, 
  scale, 
  rotation, 
  width, 
  height, 
  selectedTool,
  searchResults = [],
  currentMatchIndex = -1,
  pageNumber = 0,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!textContent || !ref.current) return;

    const container = ref.current;
    container.innerHTML = "";

    const items = textContent.items.filter(
      (item): item is TextItem => "str" in item && "transform" in item
    );

    // Get viewport if available (passed from PdfPage)
    const viewport = (textContent as any)._viewport;

    // Sort items by reading order (top to bottom, then left to right) for correct selection
    // This ensures copied text is in the correct order
    const sortedItems = [...items].sort((a, b) => {
      let aX: number, aY: number, bX: number, bY: number;

      // Transform matrix: [a, b, c, d, e, f]
      // e = x translation, f = y translation (in PDF coordinates)
      // PDF coordinates: (0,0) at bottom-left, y increases upward
      // HTML coordinates: (0,0) at top-left, y increases downward
      
      const viewportHeight = viewport ? viewport.height : height;
      
      aX = a.transform[4] * scale;
      aY = viewportHeight - (a.transform[5] * scale); // Convert PDF Y to HTML Y
      bX = b.transform[4] * scale;
      bY = viewportHeight - (b.transform[5] * scale); // Convert PDF Y to HTML Y
      
      // First sort by Y (top to bottom), with tolerance for same line
      // Use a larger tolerance based on font size to group items on the same line
      const avgFontSize = Math.abs((a.transform[3] || 12) * scale);
      const lineTolerance = Math.max(avgFontSize * 0.3, 3); // 30% of font size or 3px, whichever is larger
      
      const yDiff = Math.abs(aY - bY);
      if (yDiff > lineTolerance) {
        return aY - bY; // Lower Y (higher on screen) comes first
      }
      
      // Same line (within tolerance), sort by X (left to right)
      return aX - bX;
    });

    sortedItems.forEach((item, index) => {
      if (!item.str || item.str.trim().length === 0) return; // Skip empty items

      const span = document.createElement("span");
      span.textContent = item.str;
      span.setAttribute("data-text-index", index.toString()); // For debugging
      // Store the original text item data for search matching
      span.setAttribute("data-pdf-x", item.transform[4].toString());
      span.setAttribute("data-pdf-y", item.transform[5].toString());
      span.setAttribute("data-pdf-text", item.str);

      // Transform matrix: [a, b, c, d, e, f]
      // a, d = scale factors
      // e, f = translation (x, y) in PDF coordinates
      const [, , , d, e, f] = item.transform;
      const fontSize = Math.abs(d) * scale; // Use d (vertical scale) for font size
      
      let x: number, y: number;
      
      // Transform coordinates from PDF space to viewport space
      // PDF coordinates: (0,0) at bottom-left, y increases upward
      // Viewport coordinates: (0,0) at top-left, y increases downward
      // Transform matrix: [a, b, c, d, e, f] where e=x, f=y in PDF coordinates
      
      if (viewport) {
        const baseViewport = (textContent as any)._baseViewport;
        
        // X coordinate: simple scale (no coordinate system flip)
        x = e * scale;
        
        // Y coordinate: need to flip from PDF (bottom-up) to HTML (top-down).
        // The 'f' value is the text baseline, while our spans should start at
        // the top of the text box so that any overlay (like search highlight)
        // aligns with the visible glyphs instead of appearing below them.
        if (baseViewport) {
          const pdfPageHeight = baseViewport.height;
          const baselineY = (pdfPageHeight - f) * scale;
          y = baselineY - fontSize;
        } else {
          const baselineY = viewport.height - (f * scale);
          y = baselineY - fontSize;
        }
      } else {
        // Fallback: manual calculation
        const baselineY = height - (f * scale); // Invert Y coordinate
        y = baselineY - fontSize;
        x = e * scale;
      }

      span.style.position = "absolute";
      span.style.left = `${x}px`;
      span.style.top = `${y}px`;
      span.style.fontSize = `${fontSize}px`;
      span.style.fontFamily = item.fontName || "sans-serif";
      span.style.whiteSpace = "pre";
      // Only allow pointer events for text selection when select tool is active
      // Use !important to override CSS rule
      span.style.setProperty("pointer-events", selectedTool === "select" ? "auto" : "none", "important");
      span.style.color = "transparent"; // invisible but selectable
      span.style.userSelect = selectedTool === "select" ? "text" : "none";
      span.style.cursor = selectedTool === "select" ? "text" : "default";
      span.style.lineHeight = "1";
      span.style.verticalAlign = "baseline";
      span.style.margin = "0";
      span.style.padding = "0";
      
      // Apply rotation if needed
      if (rotation !== 0) {
        span.style.transform = `rotate(${rotation}deg)`;
        span.style.transformOrigin = "top left";
      }

      container.appendChild(span);
    });
  }, [textContent, scale, rotation, width, height, selectedTool]);

  // Render search highlights using actual DOM positions of text spans
  useEffect(() => {
    if (!highlightRef.current || !ref.current || !textContent) return;

    const highlightContainer = highlightRef.current;
    const textContainer = ref.current;
    highlightContainer.innerHTML = "";

    // Filter matches for this page
    const pageMatches = searchResults.filter((match) => match.page === pageNumber);

    if (pageMatches.length === 0) return;

    // Get all text spans from the DOM
    const textSpans = Array.from(textContainer.querySelectorAll("span")) as HTMLSpanElement[];

    // Find which spans contain the search term and use their exact positions
    const searchTerm = searchResults.length > 0 ? searchResults[0].text : "";
    if (!searchTerm) return;

    const searchLower = searchTerm.toLowerCase();

    // Create a map to track which spans correspond to which matches.
    // Instead of relying on approximate PDF coordinates (which can drift and
    // cause highlights to appear far from the actual text), we map matches
    // purely by occurrence order on the page: the 1st occurrence in DOM order
    // corresponds to pageMatches[0], the 2nd to pageMatches[1], etc.
    const matchToSpanMap = new Map<number, { span: HTMLSpanElement; indexInSpan: number }>();
    let occurrenceIndex = 0;

    for (const span of textSpans) {
      const spanText = span.textContent || "";
      const spanTextLower = spanText.toLowerCase();
      let searchIndex = 0;

      while ((searchIndex = spanTextLower.indexOf(searchLower, searchIndex)) !== -1) {
        if (occurrenceIndex < pageMatches.length && !matchToSpanMap.has(occurrenceIndex)) {
          matchToSpanMap.set(occurrenceIndex, { span, indexInSpan: searchIndex });
        }

        occurrenceIndex++;
        searchIndex += searchTerm.length;
      }
    }

    // Render highlights for each match
    pageMatches.forEach((match, matchIdx) => {
      const isCurrentMatch = searchResults.indexOf(match) === currentMatchIndex;
      
      const spanInfo = matchToSpanMap.get(matchIdx);
      
      if (!spanInfo) {
        // If we can't reliably map this match to a real text span on the page,
        // skip drawing a highlight rather than showing it in an incorrect
        // position (e.g. in the blank area at the bottom of the page).
        return;
      }

      const { span: foundSpan, indexInSpan } = spanInfo;

      // Use the exact position of the found span
      const spanRect = foundSpan.getBoundingClientRect();
      const containerRect = textContainer.getBoundingClientRect();
      
      // Calculate relative position within the container
      const relativeX = spanRect.left - containerRect.left;
      const relativeY = spanRect.top - containerRect.top;
      
      // Calculate the position of the match within the span
      // We need to measure the text up to the match position
      const spanText = foundSpan.textContent || "";
      const beforeMatch = spanText.substring(0, indexInSpan);
      
      // Create a temporary span to measure the width of text before the match
      const measureSpan = document.createElement("span");
      measureSpan.style.visibility = "hidden";
      measureSpan.style.position = "absolute";
      measureSpan.style.whiteSpace = "pre";
      measureSpan.style.fontSize = foundSpan.style.fontSize;
      measureSpan.style.fontFamily = foundSpan.style.fontFamily;
      measureSpan.textContent = beforeMatch;
      document.body.appendChild(measureSpan);
      const beforeMatchWidth = measureSpan.offsetWidth;
      document.body.removeChild(measureSpan);
      
      // Measure the width of the match text
      const matchSpan = document.createElement("span");
      matchSpan.style.visibility = "hidden";
      matchSpan.style.position = "absolute";
      matchSpan.style.whiteSpace = "pre";
      matchSpan.style.fontSize = foundSpan.style.fontSize;
      matchSpan.style.fontFamily = foundSpan.style.fontFamily;
      matchSpan.textContent = searchTerm;
      document.body.appendChild(matchSpan);
      const matchWidth = matchSpan.offsetWidth;
      document.body.removeChild(matchSpan);
      
      // Get the span's font size for height
      const spanFontSize = parseFloat(foundSpan.style.fontSize) || parseFloat(window.getComputedStyle(foundSpan).fontSize);
      
      const highlight = document.createElement("div");
      highlight.style.position = "absolute";
      highlight.style.left = `${relativeX + beforeMatchWidth}px`;
      highlight.style.top = `${relativeY}px`;
      highlight.style.width = `${matchWidth}px`;
      highlight.style.height = `${spanFontSize}px`;
      highlight.style.backgroundColor = isCurrentMatch ? "rgba(255, 255, 0, 0.5)" : "rgba(255, 255, 0, 0.3)";
      highlight.style.border = isCurrentMatch ? "2px solid rgba(255, 200, 0, 0.8)" : "none";
      highlight.style.pointerEvents = "none";
      highlight.style.zIndex = "2";
      highlight.style.borderRadius = "2px";
      
      // Apply rotation if needed
      if (rotation !== 0) {
        highlight.style.transform = `rotate(${rotation}deg)`;
        highlight.style.transformOrigin = "top left";
      }
      
      highlightContainer.appendChild(highlight);
    });
  }, [searchResults, currentMatchIndex, pageNumber, textContent, scale, rotation, width, height]);

  // Only allow pointer events for text selection when select tool is active
  const allowPointerEvents = selectedTool === "select";

  return (
    <>
      <div
        ref={ref}
        className="text-layer absolute top-0 left-0 w-full h-full"
        style={{ 
          width, 
          height,
          pointerEvents: allowPointerEvents ? "auto" : "none",
          zIndex: allowPointerEvents ? 1000 : 3, // High z-index when selecting text to be above annotation layer (999)
          cursor: allowPointerEvents ? "text" : "inherit",
          position: "absolute",
          userSelect: allowPointerEvents ? "text" : "none",
        }}
      />
      <div
        ref={highlightRef}
        className="search-highlights absolute top-0 left-0 w-full h-full"
        style={{ 
          width, 
          height,
          pointerEvents: "none", // Allow events to pass through to text layer
          zIndex: 2, // Below text layer
          position: "absolute"
        }}
      />
    </>
  );
}
