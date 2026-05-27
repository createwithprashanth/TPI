import { useEffect, useState, useRef } from "react";
import { usePdfContext } from "./context/PdfContext";
import type { Annotation } from "./context/PdfState";
import { findSymbol } from "./pid/ISASymbols";

type Props = {
  pageNumber: number;
  width: number;
  height: number;
};

type ResizeHandle = "nw" | "ne" | "sw" | "se" | null;

export default function AnnotationLayer({ pageNumber, width, height }: Props) {
  const { selectedTool, annotations, dispatch, toolColors, signatureImage, selectedAnnotationId,
          pidSelectedSymbolId, pidColor } = usePdfContext();

  const [draft, setDraft] = useState<{
    x: number; y: number; width: number; height: number;
  } | null>(null);
  const [editingTextbox, setEditingTextbox] = useState<{ id: string; x: number; y: number } | null>(null);
  const textboxInputRef = useRef<HTMLInputElement>(null);
  
  // Dragging state for moving/resizing annotations
  const [dragging, setDragging] = useState<{
    id: string;
    startX: number;
    startY: number;
    origin: Annotation["rect"];
    isResize: boolean;
    resizeHandle?: ResizeHandle;
  } | null>(null);

  
  // Update textbox color when tool color changes while editing
  useEffect(() => {
    if (editingTextbox && selectedTool === "textbox") {
      const textboxAnn = annotations[pageNumber]?.find(a => a.id === editingTextbox.id);
      if (textboxAnn && textboxAnn.meta?.color !== toolColors.textbox) {
        dispatch({
          type: "UPDATE_ANNOTATION",
          payload: {
            page: pageNumber,
            id: editingTextbox.id,
            updates: {
              meta: { 
                ...textboxAnn.meta, 
                color: toolColors.textbox,
              },
            },
          },
        });
      }
    }
  }, [toolColors.textbox, editingTextbox, selectedTool, pageNumber, annotations, dispatch]);

  // Clear selection when tool changes (track previous tool to only clear on actual tool switch)
  const prevToolRef = useRef(selectedTool);
  useEffect(() => {
    // Only clear if the tool actually changed (not on initial render)
    if (prevToolRef.current !== selectedTool && selectedAnnotationId) {
      // Clear selection when switching tools (allows re-selection in new tool)
      dispatch({
        type: "SELECT_ANNOTATION",
        payload: { page: pageNumber, id: null },
      });
    }
    prevToolRef.current = selectedTool;
  }, [selectedTool, pageNumber, dispatch, selectedAnnotationId]);

  const pageAnnotations: Annotation[] = annotations[pageNumber] || [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle>(null);
  
  // Helper function to check if annotation type supports drag/resize
  const isDraggableType = (type: string): boolean => {
    return type === "shape-rect" || type === "shape-circle" || type === "arrow"
        || type === "textbox" || type === "draw" || type === "pid-symbol";
  };
  
  // Start drag for moving/resizing annotations
  function startDrag(e: React.PointerEvent, ann: Annotation, handle?: ResizeHandle) {
    // Only allow drag for specific annotation types
    if (!isDraggableType(ann.type)) return;
    
    // Always allow drag/resize for existing annotations (they're already created)
    // The check for drawing mode is handled at the layer level to prevent creating new annotations
    // when clicking on existing ones
    
    e.stopPropagation();
    e.preventDefault();
    
    setDragging({
      id: ann.id,
      startX: e.clientX,
      startY: e.clientY,
      origin: ann.rect,
      isResize: !!handle,
      resizeHandle: handle,
    });
    
    // Select the annotation if not already selected
    if (selectedAnnotationId !== ann.id) {
      dispatch({
        type: "SELECT_ANNOTATION",
        payload: { page: pageNumber, id: ann.id },
      });
    }
    
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn("Pointer capture failed:", err);
    }
  }
  
  // Handle move for dragging/resizing annotations
  function onDragMove(e: React.PointerEvent) {
    if (!dragging) return;
    
    const dx = (e.clientX - dragging.startX) / width;
    const dy = (e.clientY - dragging.startY) / height;
    
    const ann = pageAnnotations.find(a => a.id === dragging.id);
    if (!ann) return;
    
    if (dragging.isResize && dragging.resizeHandle) {
      // Handle resize
      let newRect = { ...dragging.origin };
      const handle = dragging.resizeHandle;
      
      if (handle.includes("n")) {
        newRect.y = dragging.origin.y + dy;
        newRect.height = dragging.origin.height - dy;
        // Clamp to prevent going above page
        if (newRect.y < 0) {
          newRect.height += newRect.y;
          newRect.y = 0;
        }
      }
      if (handle.includes("s")) {
        newRect.height = dragging.origin.height + dy;
        // Clamp to prevent going below page
        if (newRect.y + newRect.height > 1) {
          newRect.height = 1 - newRect.y;
        }
      }
      if (handle.includes("w")) {
        newRect.x = dragging.origin.x + dx;
        newRect.width = dragging.origin.width - dx;
        // Clamp to prevent going left of page
        if (newRect.x < 0) {
          newRect.width += newRect.x;
          newRect.x = 0;
        }
      }
      if (handle.includes("e")) {
        newRect.width = dragging.origin.width + dx;
        // Clamp to prevent going right of page
        if (newRect.x + newRect.width > 1) {
          newRect.width = 1 - newRect.x;
        }
      }
      
      // Ensure minimum size
      const minSize = 0.01;
      if (newRect.width < minSize) {
        const diff = minSize - newRect.width;
        newRect.width = minSize;
        if (handle.includes("w")) {
          newRect.x -= diff;
        }
      }
      if (newRect.height < minSize) {
        const diff = minSize - newRect.height;
        newRect.height = minSize;
        if (handle.includes("n")) {
          newRect.y -= diff;
        }
      }
      
      // Final clamp to ensure annotation stays within page bounds
      newRect.x = Math.max(0, Math.min(1 - newRect.width, newRect.x));
      newRect.y = Math.max(0, Math.min(1 - newRect.height, newRect.y));
      newRect.width = Math.min(newRect.width, 1 - newRect.x);
      newRect.height = Math.min(newRect.height, 1 - newRect.y);
      
      dispatch({
        type: "UPDATE_ANNOTATION",
        payload: {
          page: pageNumber,
          id: dragging.id,
          updates: { rect: newRect },
        },
      });
    } else {
      // Handle drag (move)
      dispatch({
        type: "UPDATE_ANNOTATION",
        payload: {
          page: pageNumber,
          id: dragging.id,
          updates: {
            rect: {
              ...dragging.origin,
              x: Math.max(0, Math.min(1 - dragging.origin.width, dragging.origin.x + dx)),
              y: Math.max(0, Math.min(1 - dragging.origin.height, dragging.origin.y + dy)),
            },
          },
        },
      });
    }
  }
  
  // Handle pointer up for dragging
  function onDragUp(e: React.PointerEvent) {
    if (!dragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      // Ignore if capture wasn't set
    }
    setDragging(null);
  }
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; scrollX: number; scrollY: number } | null>(null);
  const panScrollContainerRef = useRef<HTMLElement | null>(null);
  const [isPlacingSignature, setIsPlacingSignature] = useState(false);
  const [signatureDimensions, setSignatureDimensions] = useState<{ width: number; height: number } | null>(null);

  const layerRef = useRef<HTMLDivElement>(null);
  
  // Tools that use drag interaction
  const isDragTool = selectedTool === "highlight" || 
                     selectedTool === "shape-rect" || 
                     selectedTool === "shape-circle" || 
                     selectedTool === "arrow" ||
                     selectedTool === "draw";
  
  // Tools that use click interaction
  const isClickTool = selectedTool === "textbox" || selectedTool === "signature"
                   || selectedTool === "pid-symbol";

  // Get cursor style based on tool
  const getCursor = () => {
    if (selectedTool === "highlight") return "crosshair";
    if (selectedTool === "shape-rect" || selectedTool === "shape-circle") return "crosshair";
    if (selectedTool === "arrow") return "crosshair";
    if (selectedTool === "draw") return "crosshair";
    if (selectedTool === "erase") return "crosshair";
    if (selectedTool === "textbox") return "text";
    if (selectedTool === "pid-symbol") return pidSelectedSymbolId ? "crosshair" : "not-allowed";
    if (selectedTool === "pan") return isPanning ? "grabbing" : "grab";
    if (selectedTool === "select") return "text";
    return "default";
  };

  // Preload signature image dimensions when signature image changes
  useEffect(() => {
    if (signatureImage) {
      const img = new Image();
      img.onload = () => {
        setSignatureDimensions({ width: img.width, height: img.height });
      };
      img.onerror = () => {
        setSignatureDimensions(null);
      };
      img.src = signatureImage;
    } else {
      setSignatureDimensions(null);
    }
  }, [signatureImage]);

  // Reset transient draw state when tool changes away from draw
  useEffect(() => {
    if (selectedTool !== "draw") {
      setDrawPoints(null);
      setDraft(null);
      setIsDrawing(false);
    }
    if (selectedTool !== "erase") {
      setIsErasing(false);
    }
    if (selectedTool !== "pan") {
      setIsPanning(false);
      setPanStart(null);
    }
    if (selectedTool !== "signature") {
      setIsPlacingSignature(false);
    }
  }, [selectedTool]);

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    // Don't create new annotations if already editing a textbox
    if (editingTextbox) return;
    // Don't create new annotations if dragging an existing one
    if (dragging) return;
    // Clear selection when clicking on empty area (if select tool is active)
    if (selectedTool === "select" && selectedAnnotationId) {
      dispatch({
        type: "SELECT_ANNOTATION",
        payload: { page: pageNumber, id: null },
      });
    }
    // Left button only for drawing tools
    if (selectedTool === "draw" && e.button !== 0) return;

    // Handle pan tool
    if (selectedTool === "pan" && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      
      // Find the scrollable container parent by traversing up the DOM tree
      // Look for element with overflow-auto class or check computed style
      let scrollContainer: HTMLElement | null = e.currentTarget.parentElement;
      while (scrollContainer && scrollContainer !== document.body) {
        // Check if this element has overflow-auto class or is scrollable
        const hasOverflowAuto = scrollContainer.classList.contains('overflow-auto');
        const computedStyle = window.getComputedStyle(scrollContainer);
        const isScrollable = computedStyle.overflow === 'auto' || 
                           computedStyle.overflow === 'scroll' ||
                           computedStyle.overflowY === 'auto' ||
                           computedStyle.overflowY === 'scroll';
        
        if (hasOverflowAuto || isScrollable) {
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }
      
      // If not found, try to find the main scroll container in ViewerContainer
      if (!scrollContainer) {
        // Look for the main content area with overflow-auto
        const mainContainer = document.querySelector('.flex-1.overflow-auto');
        if (mainContainer instanceof HTMLElement) {
          scrollContainer = mainContainer;
        }
      }
      
      if (scrollContainer) {
        // Store reference to scroll container for use in onMove
        panScrollContainerRef.current = scrollContainer;
        setIsPanning(true);
        setPanStart({
          x: e.clientX,
          y: e.clientY,
          scrollX: scrollContainer.scrollLeft,
          scrollY: scrollContainer.scrollTop,
        });
        
        // Capture pointer to track movement even outside the element
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch (err) {
          console.warn("Pointer capture failed:", err);
        }
      } else {
        console.warn("Pan: Could not find scroll container");
      }
      return;
    }

    // Don't prevent default for other tools
    if (selectedTool !== "pan") {
      e.preventDefault();
      e.stopPropagation();
    }

    // Handle pid-symbol tool click
    if (selectedTool === "pid-symbol" && e.button === 0 && pidSelectedSymbolId) {
      const sym = findSymbol(pidSelectedSymbolId);
      if (!sym) return;
      const box = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const sizePx = sym.defaultSize;
      const annotation: Annotation = {
        id: crypto.randomUUID?.() ?? Date.now().toString(),
        type: "pid-symbol",
        page: pageNumber,
        rect: {
          x: Math.max(0, Math.min(1 - sizePx / width,  (x - sizePx / 2) / width)),
          y: Math.max(0, Math.min(1 - sizePx / height, (y - sizePx / 2) / height)),
          width:  sizePx / width,
          height: sizePx / height,
        },
        meta: { symbolId: pidSelectedSymbolId, color: pidColor, label: "" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      dispatch({ type: "ADD_ANNOTATION", payload: annotation });
      return;
    }

    // Handle signature tool click
    if (selectedTool === "signature" && e.button === 0) {
      if (!signatureImage || !signatureDimensions || isPlacingSignature) {
        // If no signature image or dimensions not loaded, or already placing, don't do anything
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Prevent multiple placements
      setIsPlacingSignature(true);

      const box = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;

      // Create a signature annotation with default size
      // Size will be based on the image's aspect ratio (already loaded)
      const aspectRatio = signatureDimensions.width / signatureDimensions.height;
      const defaultHeight = height * 0.1; // 10% of page height
      const defaultWidth = defaultHeight * aspectRatio;

      const annotation: Annotation = {
        id: crypto.randomUUID?.() ?? Date.now().toString(),
        type: "signature",
        page: pageNumber,
        rect: {
          x: Math.max(0, Math.min(1 - defaultWidth / width, x / width)),
          y: Math.max(0, Math.min(1 - defaultHeight / height, y / height)),
          width: defaultWidth / width,
          height: defaultHeight / height,
        },
        meta: { imageData: signatureImage },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      dispatch({ type: "ADD_ANNOTATION", payload: annotation });
      
      // Reset flag after a short delay to allow the click to complete
      setTimeout(() => {
        setIsPlacingSignature(false);
      }, 100);
      
      return;
    }

    // Handle textbox click
    if (isClickTool && selectedTool === "textbox") {
      // Check if clicking on an existing textbox
      const box = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;

      // Check if clicking on existing textbox
      const clickedTextbox = pageAnnotations.find(ann => {
        if (ann.type !== "textbox") return false;
        const left = ann.rect.x * width;
        const top = ann.rect.y * height;
        const annWidth = ann.rect.width * width;
        const annHeight = ann.rect.height * height;
        return x >= left && x <= left + annWidth && y >= top && y <= top + annHeight;
      });

      if (clickedTextbox) {
        // Edit existing textbox
        setEditingTextbox({ 
          id: clickedTextbox.id, 
          x: clickedTextbox.rect.x * width, 
          y: clickedTextbox.rect.y * height 
        });
        setTimeout(() => {
          textboxInputRef.current?.focus();
          if (textboxInputRef.current && clickedTextbox.meta?.text) {
            textboxInputRef.current.value = clickedTextbox.meta.text;
          }
        }, 10);
        return;
      }

      // Create new textbox annotation
      const annotation: Annotation = {
        id: crypto.randomUUID?.() ?? Date.now().toString(),
        type: "textbox",
        page: pageNumber,
        rect: {
          x: x / width,
          y: y / height,
          width: 0.2, // Default width (20% of page)
          height: 0.05, // Default height (5% of page)
        },
        meta: { text: "", fontSize: 14, color: toolColors.textbox },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      dispatch({ type: "ADD_ANNOTATION", payload: annotation });
      setEditingTextbox({ id: annotation.id, x, y });
      
      // Focus input after a short delay
      setTimeout(() => {
        textboxInputRef.current?.focus();
      }, 10);
      
      return;
    }

    // Handle drag tools
    if (!isDragTool) return;

    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;

    // Start drawing
    setDraft({ x, y, width: 0, height: 0 });
    if (selectedTool === "draw") {
      setIsDrawing(true);
      setDrawPoints([{ x, y }]);
    }

    // Capture pointer to track movement even outside the element
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn("Pointer capture failed:", err);
    }
  }

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    // Handle pan tool
    if (selectedTool === "pan" && isPanning && panStart) {
      e.preventDefault();
      e.stopPropagation();
      
      // Use stored scroll container reference, or find it again if not available
      let scrollContainer = panScrollContainerRef.current;
      
      if (!scrollContainer) {
        // Find the scrollable container parent by traversing up the DOM tree
        scrollContainer = e.currentTarget.parentElement;
        while (scrollContainer && scrollContainer !== document.body) {
          // Check if this element has overflow-auto class or is scrollable
          const hasOverflowAuto = scrollContainer.classList.contains('overflow-auto');
          const computedStyle = window.getComputedStyle(scrollContainer);
          const isScrollable = computedStyle.overflow === 'auto' || 
                             computedStyle.overflow === 'scroll' ||
                             computedStyle.overflowY === 'auto' ||
                             computedStyle.overflowY === 'scroll';
          
          if (hasOverflowAuto || isScrollable) {
            break;
          }
          scrollContainer = scrollContainer.parentElement;
        }
        
        // If not found, try to find the main scroll container in ViewerContainer
        if (!scrollContainer) {
          // Look for the main content area with overflow-auto
          const mainContainer = document.querySelector('.flex-1.overflow-auto');
          if (mainContainer instanceof HTMLElement) {
            scrollContainer = mainContainer;
          }
        }
        
        // Store for next time
        if (scrollContainer) {
          panScrollContainerRef.current = scrollContainer;
        }
      }
      
      if (scrollContainer) {
        const deltaX = panStart.x - e.clientX;
        const deltaY = panStart.y - e.clientY;
        
        scrollContainer.scrollLeft = panStart.scrollX + deltaX;
        scrollContainer.scrollTop = panStart.scrollY + deltaY;
      }
      return;
    }

    if (!isDragTool || (!draft && selectedTool !== "draw")) return;

    // Prevent text selection while dragging
    e.preventDefault();
    e.stopPropagation();

    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;

    if (selectedTool === "draw") {
      // Only add points while actively drawing (pointer is held)
      if (!isDrawing) return;
      setDrawPoints((pts) => {
        const nextPts = [...(pts || []), { x, y }];
        // Compute bounding box for draft
        const xs = nextPts.map(p => p.x);
        const ys = nextPts.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        setDraft({
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        });
        return nextPts;
      });
      return;
    }

    if (!draft) return;

    setDraft({
      ...draft,
      width: x - draft.x,
      height: y - draft.y,
    });
  }

  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    // Handle pan tool
    if (selectedTool === "pan" && isPanning) {
      e.preventDefault();
      e.stopPropagation();
      
      setIsPanning(false);
      setPanStart(null);
      panScrollContainerRef.current = null; // Clear reference
      
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        // Ignore if capture wasn't set
      }
      return;
    }

    if (!isDragTool || (!draft && selectedTool !== "draw") || (selectedTool === "draw" && !isDrawing)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      // Ignore if capture wasn't set
    }

    let { x, y, width: w, height: h } = draft || { x: 0, y: 0, width: 0, height: 0 };

    // For arrows, preserve the original start point and direction (don't normalize)
    // For other shapes, normalize negative drag
    if (selectedTool !== "arrow") {
      if (w < 0) { x = x + w; w = Math.abs(w); }
      if (h < 0) { y = y + h; h = Math.abs(h); }
    }

    const isTiny = Math.abs(w) < 4 || Math.abs(h) < 4;
    // Prevent tiny annotations for all except draw; for draw require at least a few points
    if (selectedTool !== "draw" && isTiny) {
      setDraft(null);
      setDrawPoints(null);
      setIsDrawing(false);
      return;
    }
    if (selectedTool === "draw" && (!drawPoints || drawPoints.length < 2)) {
      setDraft(null);
      setDrawPoints(null);
      setIsDrawing(false);
      return;
    }

    // Determine annotation type and meta based on selected tool
    let type = "highlight";
    let meta: any = { color: toolColors.highlight };

    if (selectedTool === "shape-rect") {
      type = "shape-rect";
      meta = { color: toolColors["shape-rect"], strokeWidth: 2 };
    } else if (selectedTool === "shape-circle") {
      type = "shape-circle";
      meta = { color: toolColors["shape-circle"], strokeWidth: 2 };
    } else if (selectedTool === "arrow") {
      type = "arrow";
      meta = { color: toolColors.arrow, strokeWidth: 2 };
    } else if (selectedTool === "highlight") {
      type = "highlight";
      meta = { color: toolColors.highlight };
    } else if (selectedTool === "draw") {
      type = "draw";
      const points = (drawPoints && drawPoints.length ? drawPoints : [{ x, y }]);
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      meta = {
        color: toolColors.draw,
        strokeWidth: 2,
        points: points.map(p => ({
          x: (p.x - minX) / bw,
          y: (p.y - minY) / bh,
        })),
      };
      // Replace rect with bounding box
      x = minX;
      y = minY;
      w = bw;
      h = bh;
    }

    // For arrows, store the start point and direction vector (width/height can be negative)
    // This preserves the direction information needed for correct arrow rendering
    const annotation: Annotation = {
      id: crypto.randomUUID?.() ?? Date.now().toString(),
      type,
      page: pageNumber,
      rect: {
        x: x / width,
        y: y / height,
        width: w / width,
        height: h / height,
      },
      meta,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    dispatch({ type: "ADD_ANNOTATION", payload: annotation });
    setDraft(null);
    setDrawPoints(null);
    setIsDrawing(false);
  }

  // Render draft (while dragging)
  function renderDraft() {
    if (!draft) return null;

    const left = Math.min(draft.x, draft.x + draft.width);
    const top = Math.min(draft.y, draft.y + draft.height);
    const w = Math.abs(draft.width);
    const h = Math.abs(draft.height);

    if (selectedTool === "draw" && drawPoints && drawPoints.length > 1) {
      const drawW = Math.max(w, 1);
      const drawH = Math.max(h, 1);
      const minX = left;
      const minY = top;
      const path = drawPoints
        .map((p) => `${p.x - minX},${p.y - minY}`)
        .join(" ");
      return (
        <svg
          className="absolute pointer-events-none"
          style={{ left, top, width: drawW, height: drawH }}
          viewBox={`0 0 ${drawW} ${drawH}`}
        >
          <polyline
            points={path}
            fill="none"
            stroke="#7c3aed"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      );
    }

    if (selectedTool === "highlight") {
      const color = toolColors.highlight;
      const hex = color.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      return (
        <div
          className="absolute border pointer-events-none"
          style={{ 
            left, 
            top, 
            width: w, 
            height: h,
            backgroundColor: `rgba(${r}, ${g}, ${b}, 0.3)`,
            borderColor: color,
          }}
        />
      );
    }

    if (selectedTool === "shape-rect") {
      return (
        <div
          className="absolute border-2 pointer-events-none bg-transparent"
          style={{ 
            left, 
            top, 
            width: w, 
            height: h,
            borderColor: toolColors["shape-rect"],
          }}
        />
      );
    }

    if (selectedTool === "shape-circle") {
      return (
        <div
          className="absolute border-2 rounded-full pointer-events-none bg-transparent"
          style={{ 
            left, 
            top, 
            width: w, 
            height: h,
            borderColor: toolColors["shape-circle"],
          }}
        />
      );
    }

    if (selectedTool === "arrow") {
      // Use actual width and height (not absolute) to preserve direction
      const arrowLength = Math.sqrt(draft.width * draft.width + draft.height * draft.height);
      const angle = Math.atan2(draft.height, draft.width) * (180 / Math.PI);
      return (
        <div
          className="absolute pointer-events-none"
          style={{
            left: draft.x,
            top: draft.y,
            width: arrowLength,
            height: 2,
            transformOrigin: "0 50%",
            transform: `rotate(${angle}deg)`,
          }}
        >
          <svg width={arrowLength} height="20" style={{ overflow: "visible" }}>
            <defs>
              <marker
                id="draft-arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill={toolColors.arrow} />
              </marker>
            </defs>
            <line
              x1="0"
              y1="10"
              x2={arrowLength - 10}
              y2="10"
              stroke={toolColors.arrow}
              strokeWidth="2"
              markerEnd="url(#draft-arrowhead)"
            />
          </svg>
        </div>
      );
    }

    return null;
  }

  // Enable pointer events for annotation tools and pan tool
  // Don't include "select" - text selection needs the annotation layer to be disabled
  const shouldEnablePointerEvents =
    isDragTool || isClickTool || selectedTool === "erase" || selectedTool === "pan";

  // Touch behavior: allow panning/scrolling by default, only fully lock when free-drawing/erasing
  const wantsFreeDrawing = selectedTool === "draw" || selectedTool === "erase";


  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        dispatch({
          type: "REMOVE_ANNOTATION",
          payload: { page: pageNumber, id: selectedId },
        });
        setSelectedId(null);
      }
      if (e.key === "Escape" && pidSelectedSymbolId) {
        dispatch({ type: "SET_PID_SYMBOL", payload: null });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, dispatch, pageNumber, pidSelectedSymbolId]);

  /* ----------------------- POINTER DOWN ----------------------- */
  function onPointerDown(
    e: React.PointerEvent,
    ann: Annotation,
    handle: ResizeHandle = null
  ) {
    // Don't allow selection/dragging when draw or erase tool is active
    // Let the event bubble to the layer handler for erase functionality
    // For signature tool, allow selection so users can move/resize existing signatures
    if (selectedTool === "draw" || selectedTool === "erase") {
      // Don't stop propagation so erase can work
      return;
    }
    e.stopPropagation();

    const rect = layerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setSelectedId(ann.id);

    if (handle) {
      setResizeHandle(handle);
    } else {
      setDragOffset({
        x: x - ann.rect.x * width,
        y: y - ann.rect.y * height,
      });
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  /* ----------------------- POINTER MOVE ----------------------- */
  function onPointerMove(e: React.PointerEvent) {
    if (!selectedId) return;

    const ann = pageAnnotations.find(a => a.id === selectedId);
    if (!ann) return;

    const rect = layerRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    let next = { ...ann.rect };

    if (resizeHandle) {
      const right = ann.rect.x + ann.rect.width;
      const bottom = ann.rect.y + ann.rect.height;

      const nx = px / width;
      const ny = py / height;

      if (resizeHandle.includes("n")) {
        next.height = bottom - ny;
        next.y = ny;
      }
      if (resizeHandle.includes("s")) {
        next.height = ny - ann.rect.y;
      }
      if (resizeHandle.includes("w")) {
        next.width = right - nx;
        next.x = nx;
      }
      if (resizeHandle.includes("e")) {
        next.width = nx - ann.rect.x;
      }

      // Minimum size
      next.width = Math.max(next.width, 0.01);
      next.height = Math.max(next.height, 0.01);
    } else if (dragOffset) {
      next.x = (px - dragOffset.x) / width;
      next.y = (py - dragOffset.y) / height;
    }

    // Clamp to page
    next.x = Math.max(0, Math.min(1 - next.width, next.x));
    next.y = Math.max(0, Math.min(1 - next.height, next.y));

    dispatch({
      type: "UPDATE_ANNOTATION",
      payload: {
        page: pageNumber,
        id: ann.id,
        updates: { rect: next },
      },
    });
  }

  /* ----------------------- POINTER UP ----------------------- */
  function onPointerUp(e: React.PointerEvent) {
    setDragOffset(null);
    setResizeHandle(null);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    if (selectedTool === "draw") {
      setIsDrawing(false);
    }
  }

  /* ----------------------- HELPERS ----------------------- */
  const eraseAtPoint = (px: number, py: number) => {
    const pointToSegmentDist = (
      px2: number,
      py2: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number
    ) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (dx === 0 && dy === 0) {
        const dxp = px2 - x1;
        const dyp = py2 - y1;
        return Math.sqrt(dxp * dxp + dyp * dyp);
      }
      const t = Math.max(0, Math.min(1, ((px2 - x1) * dx + (py2 - y1)) / (dx * dx + dy * dy)));
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      const dxp = px2 - projX;
      const dyp = py2 - projY;
      return Math.sqrt(dxp * dxp + dyp * dyp);
    };

    const target = [...pageAnnotations]
      .reverse() // topmost first
      .find((a) => {
        const left = a.rect.x * width;
        const top = a.rect.y * height;
        const w = a.rect.width * width;
        const h = a.rect.height * height;
        
        // For draw annotations, use segment-based hit testing
        if (a.type === "draw" && Array.isArray(a.meta?.points)) {
          // Quick reject by bbox + tolerance
          if (px < left - 8 || px > left + w + 8 || py < top - 8 || py > top + h + 8) {
            return false;
          }
          const pts = a.meta.points as { x: number; y: number }[];
          if (pts.length < 2) return false;
          const absPoints = pts.map(p => ({ x: left + p.x * w, y: top + p.y * h }));
          // Hit test against each segment with tolerance
          for (let i = 0; i < absPoints.length - 1; i++) {
            const p1 = absPoints[i];
            const p2 = absPoints[i + 1];
            if (pointToSegmentDist(px, py, p1.x, p1.y, p2.x, p2.y) <= 8) {
              return true;
            }
          }
          return false;
        } else {
          // For other annotation types, check if point is within bounding box
          return px >= left && px <= left + w && py >= top && py <= top + h;
        }
      });

    if (target) {
      dispatch({
        type: "REMOVE_ANNOTATION",
        payload: { page: pageNumber, id: target.id },
      });
      return true;
    }
    return false;
  };

  /* ----------------------- RENDER ----------------------- */
  function renderAnnotation(ann: Annotation) {
    const left = ann.rect.x * width;
    const top = ann.rect.y * height;
    let w = ann.rect.width * width;
    let h = ann.rect.height * height;
    const selected = ann.id === selectedAnnotationId;
    const isDraggable = isDraggableType(ann.type);

    // For arrows, w and h represent the direction vector (can be negative)
    // Calculate the bounding box that contains both start and end points
    let boundingLeft = left;
    let boundingTop = top;
    let boundingWidth = w;
    let boundingHeight = h;
    
    if (ann.type === "arrow") {
      const endX = left + w;
      const endY = top + h;
      boundingLeft = Math.min(left, endX);
      boundingTop = Math.min(top, endY);
      boundingWidth = Math.abs(w);
      boundingHeight = Math.abs(h);
    }

    const baseStyle: React.CSSProperties = {
      left: ann.type === "arrow" ? boundingLeft : left,
      top: ann.type === "arrow" ? boundingTop : top,
      width: Math.max(ann.type === "arrow" ? boundingWidth : w, 1), // Ensure minimum width
      height: Math.max(ann.type === "arrow" ? boundingHeight : h, 1), // Ensure minimum height
      position: "absolute",
      cursor: selected && isDraggable ? "move" : "default",
      // Disable pointer events when erase tool is active so clicks pass through to layer
      pointerEvents: selectedTool === "erase" ? "none" : "auto",
      overflow: "visible", // Ensure content is visible - CRITICAL for resize handles to be visible
      zIndex: selected ? 10 : 1, // Ensure selected annotations are above others
    };

    // For arrows, w and h represent the direction vector (can be negative)
    // The arrow starts at (left, top) and points in the direction of (w, h)
    const arrowLength = Math.sqrt(w * w + h * h);
    const arrowAngle = Math.atan2(h, w) * (180 / Math.PI);

    return (
      <div
        key={ann.id}
        data-annotation-id={ann.id}
        className={`absolute ${selected && isDraggable ? "ring-2 ring-blue-500" : ""}`}
        style={baseStyle}
        onPointerDown={(e) => {
          // Don't start drag if clicking on a resize handle (handles have higher z-index and stop propagation)
          // Check if the target is a resize handle
          const target = e.target as HTMLElement;
          if (target.classList.contains('resize-handle') || target.closest('.resize-handle')) {
            return; // Let the resize handle handle it
          }
          
          // Stop propagation to prevent layer from creating new annotation
          e.stopPropagation();
          
          // For draggable annotations, always allow selection and dragging
          // This works in both select mode and drawing modes (to edit existing annotations)
          if (isDraggable) {
            // First, select the annotation so resize handles appear
            if (selectedAnnotationId !== ann.id) {
              dispatch({
                type: "SELECT_ANNOTATION",
                payload: { page: pageNumber, id: ann.id },
              });
            }
            // Then start drag (for moving) - but only if not in drawing mode or if already selected
            // In drawing mode, we want to allow editing existing annotations
            startDrag(e, ann);
          } else {
            // Use existing handler for other types
            onPointerDown(e, ann);
          }
        }}
        onPointerMove={dragging && dragging.id === ann.id ? onDragMove : undefined}
        onPointerUp={dragging && dragging.id === ann.id ? onDragUp : undefined}
      >
        {/* SHAPE */}
        {ann.type === "highlight" && (() => {
          const color = ann.meta?.color || toolColors.highlight;
          // Convert hex to rgba with opacity
          const hex = color.replace('#', '');
          const r = parseInt(hex.substr(0, 2), 16);
          const g = parseInt(hex.substr(2, 2), 16);
          const b = parseInt(hex.substr(4, 2), 16);
          return (
            <div 
              style={{ 
                backgroundColor: `rgba(${r}, ${g}, ${b}, 0.4)`,
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none", // Allow text selection through highlights
              }} 
            />
          );
        })()}

        {ann.type === "shape-rect" && (
          <div 
            className="w-full h-full border-2" 
            style={{ borderColor: ann.meta?.color || toolColors["shape-rect"] }}
          />
        )}

        {ann.type === "shape-circle" && (
          <div 
            className="w-full h-full border-2 rounded-full" 
            style={{ borderColor: ann.meta?.color || toolColors["shape-circle"] }}
          />
        )}

        {ann.type === "arrow" && (
          <div
            style={{
              // Position the arrow at the start point relative to the bounding box
              left: left - boundingLeft,
              top: top - boundingTop,
              width: arrowLength,
              height: 2,
              transformOrigin: "0 50%",
              transform: `rotate(${arrowAngle}deg)`,
              pointerEvents: "none", // Allow resize handles to work
              position: "absolute",
            }}
          >
            <svg width={arrowLength} height="20" style={{ overflow: "visible" }}>
              <defs>
                <marker
                  id={`arrowhead-${ann.id}`}
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3, 0 6"
                    fill={ann.meta?.color || "#10b981"}
                  />
                </marker>
              </defs>
              <line
                x1="0"
                y1="10"
                x2={arrowLength - 10}
                y2="10"
                stroke={ann.meta?.color || "#10b981"}
                strokeWidth={ann.meta?.strokeWidth || 2}
                markerEnd={`url(#arrowhead-${ann.id})`}
              />
            </svg>
          </div>
        )}

        {ann.type === "draw" && ann.meta?.points?.length > 1 && (
          <svg
            className="absolute top-0 left-0"
            width={w}
            height={h}
            viewBox={`0 0 ${w || 1} ${h || 1}`}
            style={{ pointerEvents: "none" }}
          >
            <polyline
              points={ann.meta.points
                .map((p: any) => `${p.x * w},${p.y * h}`)
                .join(" ")}
              fill="none"
              stroke={ann.meta?.color || "#7c3aed"}
              strokeWidth={ann.meta?.strokeWidth || 2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}

        {ann.type === "textbox" && (
          <div 
            className="w-full h-full bg-white border p-1 text-sm"
            style={{ color: ann.meta?.color || toolColors.textbox }}
          >
            {ann.meta?.text}
          </div>
        )}

        {ann.type === "signature" && ann.meta?.imageData && (
          <img
            src={ann.meta.imageData}
            alt="Signature"
            className="w-full h-full object-contain"
            style={{ pointerEvents: "none" }}
          />
        )}

        {ann.type === "pid-symbol" && (() => {
          const sym = findSymbol(ann.meta?.symbolId);
          if (!sym) return null;
          return (
            <>
              <svg
                viewBox="0 0 100 100"
                width={w}
                height={h}
                style={{ color: ann.meta?.color || "#ef4444", pointerEvents: "none", overflow: "visible", display: "block" }}
                dangerouslySetInnerHTML={{ __html: sym.svg }}
              />
              {ann.meta?.label && (
                <div
                  className="absolute whitespace-nowrap text-[10px] font-medium leading-none"
                  style={{
                    top: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    marginTop: 2,
                    color: ann.meta.color || "#ef4444",
                    pointerEvents: "none",
                  }}
                >
                  {ann.meta.label}
                </div>
              )}
            </>
          );
        })()}

        {/* SELECTION & RESIZE HANDLES */}
        {/* Show resize handles for draggable types except draw (draw is only movable, not resizable) */}
        {selected && isDraggable && ann.type !== "draw" && (
          <>
            {["nw", "ne", "sw", "se"].map(h => {
              // Determine cursor based on handle position
              const getCursor = () => {
                if (h === "nw") return "nwse-resize";
                if (h === "ne") return "nesw-resize";
                if (h === "sw") return "nesw-resize";
                return "nwse-resize"; // se
              };
              
              const cursorStyle = getCursor();
              
              const handleStyle: React.CSSProperties = {
                position: "absolute",
                width: "14px",
                height: "14px",
                backgroundColor: "#3b82f6",
                border: "2px solid white",
                borderRadius: "50%",
                cursor: cursorStyle,
                zIndex: 1000, // Very high z-index to ensure it's on top
                pointerEvents: "auto",
                boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                transform: "translate(-50%, -50%)", // Center the handle on the corner
                transition: "background-color 0.2s, transform 0.2s",
              };
              
              // Position handles at corners (centered on corners)
              let baseTransform = "translate(-50%, -50%)";
              if (h === "nw") {
                handleStyle.left = 0;
                handleStyle.top = 0;
              } else if (h === "ne") {
                handleStyle.right = 0;
                handleStyle.top = 0;
                baseTransform = "translate(50%, -50%)";
              } else if (h === "sw") {
                handleStyle.left = 0;
                handleStyle.bottom = 0;
                baseTransform = "translate(-50%, 50%)";
              } else if (h === "se") {
                handleStyle.right = 0;
                handleStyle.bottom = 0;
                baseTransform = "translate(50%, 50%)";
              }
              handleStyle.transform = baseTransform;
              
              return (
                <div
                  key={h}
                  className="resize-handle"
                  style={handleStyle}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    startDrag(e, ann, h as ResizeHandle);
                    // Capture pointer to track movement even outside the handle
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch (err) {
                      console.warn("Pointer capture failed:", err);
                    }
                  }}
                  onPointerMove={(e) => {
                    // Ensure cursor is set on hover
                    e.currentTarget.style.cursor = cursorStyle;
                  }}
                  onMouseEnter={(e) => {
                    // Ensure cursor changes on mouse enter and add hover effect
                    e.currentTarget.style.cursor = cursorStyle;
                    e.currentTarget.style.backgroundColor = "#2563eb";
                    e.currentTarget.style.transform = baseTransform + " scale(1.2)";
                  }}
                  onMouseLeave={(e) => {
                    // Reset on mouse leave
                    e.currentTarget.style.backgroundColor = "#3b82f6";
                    e.currentTarget.style.transform = baseTransform;
                  }}
                />
              );
            })}
          </>
        )}
      </div>
    );
  }

  const handleLayerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Erase when erase tool is active (left button), or draw tool + Alt/right click
    const eraseMode =
      selectedTool === "erase" ||
      (selectedTool === "draw" && (e.altKey || e.button === 2));
    if (eraseMode) {
      e.preventDefault();
      e.stopPropagation();
      if (selectedTool === "erase" && e.button !== 0) return;
      const rect = layerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      eraseAtPoint(px, py);
      setIsErasing(true);
      return;
    }

    // Don't create new annotations if we're dragging/resizing an existing one
    if (dragging) {
      return;
    }

    // Check if clicking on an annotation or resize handle - if so, don't create new annotation
    const target = e.target as HTMLElement;
    if (target.closest('[data-annotation-id]') || target.classList.contains('resize-handle') || target.closest('.resize-handle')) {
      // Clicking on existing annotation - let it handle the event
      return;
    }

    // Clear selection when clicking on empty area (for any tool)
    if (e.target === e.currentTarget) {
      dispatch({
        type: "SELECT_ANNOTATION",
        payload: { page: pageNumber, id: null },
      });
      setSelectedId(null);
      // Only create new annotations if clicking on empty area and not in select mode
      if (selectedTool !== "select") {
        onDown(e);
      }
    }
  };

  const handleLayerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isErasing && (selectedTool === "draw" || selectedTool === "erase")) {
      const rect = layerRef.current?.getBoundingClientRect();
      if (rect) {
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        eraseAtPoint(px, py);
      }
      e.preventDefault();
      return;
    }
    // Handle new drag system first (including resize)
    // This will handle both dragging and resizing
    if (dragging) {
      onDragMove(e);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Handle layer-level events (drawing, pan, etc.)
    onMove(e);
    // Then handle existing annotation system
    onPointerMove(e);
  };

  const handleLayerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isErasing) {
      setIsErasing(false);
    }
    // Handle new drag system first (including resize)
    if (dragging) {
      onDragUp(e);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Handle layer-level events (drawing, pan, etc.)
    onUp(e);
    // Then handle existing annotation system
    onPointerUp(e);
  };


  return (
    <div
      className="absolute inset-0"
      ref={layerRef}
      onPointerMove={handleLayerPointerMove}
      onPointerUp={handleLayerPointerUp}
      onPointerDown={handleLayerPointerDown}
      style={{ 
        position: "absolute",
        top: 0,
        left: 0,
        width, 
        height,
        pointerEvents: shouldEnablePointerEvents ? "auto" : "none",
        cursor: shouldEnablePointerEvents ? getCursor() : "inherit",
        zIndex: shouldEnablePointerEvents ? 999 : 0, // Very high z-index to ensure it's on top
        touchAction: shouldEnablePointerEvents
          ? (wantsFreeDrawing ? "none" : "pan-y pan-x")
          : "auto",
      }}
      onPointerLeave={(e) => {
        // Clear draft if pointer leaves while dragging
      if (draft) {
        setDraft(null);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
      }
      if (selectedTool === "draw") {
        setDrawPoints(null);
        setIsDrawing(false);
        setIsErasing(false);
      } else if (selectedTool === "erase") {
        setIsErasing(false);
      } else if (selectedTool === "pan") {
        setIsPanning(false);
        setPanStart(null);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
      }
      }}
    >
      {/* Render existing annotations */}
      {pageAnnotations.map(renderAnnotation)}

      {/* Draft (while dragging) */}
      {renderDraft()}

      {/* Textbox input (when editing) */}
      {editingTextbox && (() => {
        const textboxAnn = pageAnnotations.find(a => a.id === editingTextbox.id);
        return (
          <input
            ref={textboxInputRef}
            type="text"
            className="absolute border-2 border-blue-500 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 z-10"
            style={{
              left: editingTextbox.x,
              top: editingTextbox.y,
              width: "200px",
              minHeight: "24px",
              color: textboxAnn?.meta?.color || toolColors.textbox,
            }}
            placeholder="Enter text..."
            defaultValue={textboxAnn?.meta?.text || ""}
            onBlur={(e) => {
              // Update the textbox annotation with text
              // Preserve existing color or use current tool color
              if (textboxAnn && e.target.value.trim()) {
                dispatch({
                  type: "UPDATE_ANNOTATION",
                  payload: {
                    page: pageNumber,
                    id: editingTextbox.id,
                    updates: {
                      meta: { 
                        ...textboxAnn.meta, 
                        text: e.target.value,
                        color: textboxAnn.meta?.color || toolColors.textbox,
                      },
                    },
                  },
                });
              } else if (textboxAnn && !e.target.value.trim() && !textboxAnn.meta?.text) {
                // Remove empty textbox only if it was empty before
                dispatch({
                  type: "REMOVE_ANNOTATION",
                  payload: { page: pageNumber, id: editingTextbox.id },
                });
              }
              setEditingTextbox(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                // Remove empty textbox on escape only if it was empty
                if (textboxAnn && !textboxAnn.meta?.text) {
                  dispatch({
                    type: "REMOVE_ANNOTATION",
                    payload: { page: pageNumber, id: editingTextbox.id },
                  });
                }
                setEditingTextbox(null);
              }
            }}
          />
        );
      })()}
    </div>
  );
}
