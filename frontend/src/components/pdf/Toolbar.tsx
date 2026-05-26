import { useState, useEffect } from "react";
import { usePdfContext } from "./context/PdfContext";
import { searchInPdf, findInPdf } from "./utils/searchUtils";
import ColorPicker from "./ColorPicker";
import { saveAnnotatedPdf } from "./utils/savePdf";

import {
  Hand,
  Type,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Image as ImageIcon,
  Highlighter,
  ArrowRight,
  Square,
  Circle,
  Bookmark,
  LayoutDashboard,
  Maximize2,
  ArrowLeftRight,
  ChevronDown,
  X,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Eraser,
  Upload,
  Download,
  PanelLeft,
  PanelRight,
  Workflow,
} from "lucide-react";

type ToolButtonProps = {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  dropdown?: React.ReactNode;
  disabled?: boolean;
  showColorPicker?: boolean;
  currentColor?: string;
  onColorChange?: (color: string) => void;
  colorPickerId?: string;
  isColorPickerOpen?: boolean;
  onColorPickerToggle?: (id: string | null) => void;
};

function ToolButton({
  icon,
  label,
  active,
  onClick,
  dropdown,
  disabled,
  showColorPicker,
  currentColor,
  onColorChange,
  colorPickerId,
  isColorPickerOpen,
  onColorPickerToggle,
}: ToolButtonProps) {
  const hasColor = showColorPicker && currentColor;
  const baseBtn = active
    ? "border-brand-primary/35 bg-brand-primary/10 text-white shadow-sm"
    : "border-slate-700 bg-slate-900 text-slate-300";
  const hoverBtn = disabled
    ? "cursor-not-allowed opacity-40"
    : "hover:border-brand-primary/25 hover:bg-slate-800 hover:text-white";

  return (
    <div className="relative group shrink-0" style={{ zIndex: isColorPickerOpen ? 99999 : "auto" }}>
      <div className="flex items-center">
        <button
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onClick?.();
          }}
          className={`flex h-9 items-center gap-2 border px-3 text-sm font-medium transition-all duration-200
            ${hasColor ? "rounded-l-lg rounded-r-none border-r-0" : "rounded-lg"}
            ${baseBtn} ${hoverBtn}
          `}
        >
          {icon}
          <span className="text-[12px]">{label}</span>
          {dropdown && <ChevronDown className="w-3 h-3" />}
        </button>

        {hasColor && (
          <div
            className={`flex h-9 items-center px-1.5 rounded-r-lg border border-l-0 transition-all duration-200
              ${active ? "border-brand-primary/35 bg-brand-primary/10" : "border-slate-700 bg-slate-900"}
              ${disabled ? "opacity-40 pointer-events-none" : ""}
            `}
            onClick={(e) => e.stopPropagation()}
          >
            <ColorPicker
              currentColor={currentColor!}
              onColorChange={onColorChange || (() => {})}
              onClose={() => onColorPickerToggle?.(null)}
              isOpen={isColorPickerOpen || false}
              onToggle={() => {
                if (colorPickerId) {
                  onColorPickerToggle?.(isColorPickerOpen ? null : colorPickerId);
                }
              }}
            />
          </div>
        )}
      </div>

      {dropdown && (
        <div className="absolute top-full left-0 z-50 mt-2 hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-xl backdrop-blur-sm group-hover:block">
          {dropdown}
        </div>
      )}
    </div>
  );
}

export default function Toolbar({
  onOpenFile,
  isEmptyState = false,
  showPages = true,
  showAnnotations = true,
  onTogglePages,
  onToggleAnnotations,
}: {
  onOpenFile?: () => void;
  isEmptyState?: boolean;
  showPages?: boolean;
  showAnnotations?: boolean;
  onTogglePages?: () => void;
  onToggleAnnotations?: () => void;
}) {
  const {
    currentPage,
    numPages,
    scale,
    rotation,
    fitMode,
    dispatch,
    selectedTool,
    pdfDoc,
    pdfBytes,
    annotations,
    searchTerm: globalSearchTerm,
    searchResults,
    currentMatchIndex,
    search,
    toolColors,
    signatureImage,
    showPidPanel,
  } = usePdfContext();

  const [zoomLocal, setZoomLocal] = useState(Math.round(scale * 100));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(globalSearchTerm);
  const [isSearching, setIsSearching] = useState(false);
  const [signatureDropdownOpen, setSignatureDropdownOpen] = useState(false);
  const [openColorPickerId, setOpenColorPickerId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const hasDocument = !!pdfDoc && !isEmptyState;

  const zoomLevels = [50, 75, 100, 125, 150, 200, 300, 400];

  // Sync zoom input with global scale
  useEffect(() => {
    setZoomLocal(Math.round(scale * 100));
  }, [scale]);

  const updateZoom = (percent: number) => {
    const newScale = percent / 100;
    setZoomLocal(percent);
    dispatch({ type: "SET_SCALE", payload: newScale });
    dispatch({ type: "SET_FIT_MODE", payload: "custom" });
  };

  const rotate = (dir: "left" | "right") => {
    const next = rotation + (dir === "right" ? 90 : -90);
    dispatch({ type: "SET_ROTATION", payload: next });
  };

  const handleSearch = async () => {
    if (!pdfDoc || !searchTerm.trim()) {
      dispatch({ type: "SET_SEARCH_TERM", payload: "" });
      dispatch({ type: "SET_SEARCH_RESULTS", payload: [] });
      return;
    }

    setIsSearching(true);
    dispatch({ type: "SET_SEARCH_TERM", payload: searchTerm });

    try {
      const matches = await searchInPdf(pdfDoc, searchTerm, numPages);
      dispatch({ type: "SET_SEARCH_RESULTS", payload: matches });
      
      // Navigate to first match if found
      if (matches.length > 0) {
        dispatch({ type: "SET_PAGE", payload: matches[0].page });
      }
    } catch (error) {
      console.error("Search error:", error);
      dispatch({ type: "SET_SEARCH_RESULTS", payload: [] });
    } finally {
      setIsSearching(false);
    }
  };

  // New find function using the new search state structure
  const handleFind = async () => {
    if (!pdfDoc || !searchTerm.trim()) {
      dispatch({ type: "SET_SEARCH_QUERY", payload: "" });
      dispatch({ type: "SET_SEARCH_RESULTS", payload: [] });
      dispatch({ type: "CLEAR_SEARCH" });
      return;
    }

    setIsSearching(true);
    dispatch({ type: "SET_SEARCH_QUERY", payload: searchTerm });

    try {
      const matches = await findInPdf(pdfDoc, searchTerm, numPages);
      dispatch({ type: "SET_SEARCH_RESULTS", payload: matches });
      
      // Navigate to first match if found
      if (matches.length > 0 && matches[0].rect.length > 0) {
        dispatch({ type: "SET_PAGE", payload: matches[0].page });
        dispatch({ type: "SET_ACTIVE_SEARCH_INDEX", payload: 0 });
      }
    } catch (error) {
      console.error("Find error:", error);
      dispatch({ type: "SET_SEARCH_RESULTS", payload: [] });
      dispatch({ type: "CLEAR_SEARCH" });
    } finally {
      setIsSearching(false);
    }
  };

  // Scroll active search match into view
  const scrollToActiveMatch = () => {
    // Find the active match highlight element
    const activeMatch = document.querySelector('[data-active-search-match="true"]') as HTMLElement;
    if (!activeMatch) return;

    // Find the scrollable container (the main content area)
    let scrollContainer: HTMLElement | null = activeMatch.closest('.overflow-auto');
    if (!scrollContainer) {
      // Fallback: find the main content area
      scrollContainer = document.querySelector('.flex-1.overflow-auto') as HTMLElement;
    }
    
    if (!scrollContainer) return;

    // Get the position of the active match relative to the scroll container
    const containerRect = scrollContainer.getBoundingClientRect();
    const matchRect = activeMatch.getBoundingClientRect();
    
    // Calculate the position relative to the scroll container
    const relativeTop = matchRect.top - containerRect.top + scrollContainer.scrollTop;
    const relativeLeft = matchRect.left - containerRect.left + scrollContainer.scrollLeft;
    
    // Calculate center position for better visibility
    const centerY = relativeTop - (containerRect.height / 2) + (matchRect.height / 2);
    const centerX = relativeLeft - (containerRect.width / 2) + (matchRect.width / 2);
    
    // Scroll to center the match in view
    scrollContainer.scrollTo({
      top: Math.max(0, centerY),
      left: Math.max(0, centerX),
      behavior: 'smooth'
    });
  };

  const handleNextMatch = () => {
    // Use old format if available
    if (searchResults.length > 0) {
      dispatch({ type: "NEXT_MATCH" });
      // Scroll to match after state update
      setTimeout(() => scrollToActiveMatch(), 100);
      return;
    }
    
    // Use new format
    const totalMatches = search.matches.reduce((sum, match) => sum + match.rect.length, 0);
    if (totalMatches === 0) return;
    
    const nextIndex = (search.activeIndex + 1) % totalMatches;
    dispatch({ type: "SET_ACTIVE_SEARCH_INDEX", payload: nextIndex });
    
    // Find which page this match is on and navigate to it
    let currentIndex = 0;
    for (const match of search.matches) {
      if (nextIndex < currentIndex + match.rect.length) {
        dispatch({ type: "SET_PAGE", payload: match.page });
        break;
      }
      currentIndex += match.rect.length;
    }
    
    // Scroll to match after page navigation
    setTimeout(() => scrollToActiveMatch(), 100);
  };

  const handlePrevMatch = () => {
    // Use old format if available
    if (searchResults.length > 0) {
      dispatch({ type: "PREV_MATCH" });
      // Scroll to match after state update
      setTimeout(() => scrollToActiveMatch(), 100);
      return;
    }
    
    // Use new format
    const totalMatches = search.matches.reduce((sum, match) => sum + match.rect.length, 0);
    if (totalMatches === 0) return;
    
    const prevIndex = search.activeIndex <= 0 ? totalMatches - 1 : search.activeIndex - 1;
    dispatch({ type: "SET_ACTIVE_SEARCH_INDEX", payload: prevIndex });
    
    // Find which page this match is on and navigate to it
    let currentIndex = 0;
    for (const match of search.matches) {
      if (prevIndex < currentIndex + match.rect.length) {
        dispatch({ type: "SET_PAGE", payload: match.page });
        break;
      }
      currentIndex += match.rect.length;
    }
    
    // Scroll to match after page navigation
    setTimeout(() => scrollToActiveMatch(), 100);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleFind();
    }
  };

  // Sync local search term with global when it changes externally
  useEffect(() => {
    setSearchTerm(globalSearchTerm);
  }, [globalSearchTerm]);

  // Handle signature image upload
  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if it's an image
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      dispatch({ type: "SET_SIGNATURE_IMAGE", payload: dataUrl });
      setSignatureDropdownOpen(false);
    };
    reader.onerror = () => {
      alert('Failed to read image file');
    };
    reader.readAsDataURL(file);
    
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Close signature dropdown when tool changes away from signature
  useEffect(() => {
    if (selectedTool !== "signature") {
      setSignatureDropdownOpen(false);
    }
  }, [selectedTool]);

  // Close color picker when tool changes (unless it's a tool with a color picker)
  useEffect(() => {
    const toolsWithColorPickers = ["highlight", "shape-rect", "shape-circle", "arrow", "textbox", "draw"];
    if (!toolsWithColorPickers.includes(selectedTool)) {
      setOpenColorPickerId(null);
    }
  }, [selectedTool]);

  // Close signature dropdown when clicking outside
  useEffect(() => {
    if (!signatureDropdownOpen) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.signature-dropdown-container')) {
        setSignatureDropdownOpen(false);
      }
    };
    
    // Use setTimeout to avoid immediate closure when opening
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [signatureDropdownOpen]);

  return (
    <div
      className="relative w-full border-b border-slate-700 bg-slate-950 px-3 py-2 text-slate-200"
      style={{ zIndex: 2000 }}
    >
      <div className="w-full space-y-2 overflow-x-auto md:overflow-visible">
        <div className="flex min-w-max items-center gap-2 md:min-w-0">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2 py-1">
            <button
              type="button"
              onClick={onOpenFile}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-primary px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-brand-primary-hover"
            >
              <Upload className="h-4 w-4" />
              File
            </button>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2 py-1">
            <ToolButton
              icon={<Hand className="w-4 h-4" />}
              label="Hand"
              active={selectedTool === "pan"}
              disabled={!hasDocument}
              onClick={() => dispatch({ type: "SET_SELECTED_TOOL", payload: "pan" })}
            />
            <ToolButton
              icon={<Type className="w-4 h-4" />}
              label="Select Text"
              active={selectedTool === "select"}
              disabled={!hasDocument}
              onClick={() => dispatch({ type: "SET_SELECTED_TOOL", payload: "select" })}
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2 py-1">
            <ToolButton
              icon={<Search className="w-4 h-4" />}
              label="Find"
              active={searchOpen}
              disabled={!hasDocument}
              onClick={() => setSearchOpen((s) => !s)}
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2 py-1">
            <ToolButton
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Layout"
              disabled={!hasDocument}
              dropdown={
                <div className="p-2">
                  <button
                    className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-brand-primary/10"
                    onClick={() => dispatch({ type: "SET_VIEW_MODE", payload: "single" })}
                  >
                    Single Page
                  </button>
                  <button
                    className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-brand-primary/10"
                    onClick={() => dispatch({ type: "SET_VIEW_MODE", payload: "continuous" })}
                  >
                    Continuous
                  </button>
                </div>
              }
            />

            <select
              value={zoomLocal}
              onChange={(e) => updateZoom(Number(e.target.value))}
              disabled={!hasDocument}
              className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 transition-all duration-200"
            >
              {zoomLevels.map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
            </select>

            <button
              onClick={() => updateZoom(Math.max(50, zoomLocal - 25))}
              disabled={!hasDocument}
              className="rounded-lg border border-gray-200 bg-white p-2 transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => updateZoom(Math.min(400, zoomLocal + 25))}
              disabled={!hasDocument}
              className="rounded-lg border border-gray-200 bg-white p-2 transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            {/* Fit modes */}
            <button
              onClick={() => dispatch({ type: "SET_FIT_MODE", payload: "fit-page" })}
              disabled={!hasDocument}
              className={`rounded-lg border p-2 transition-all duration-200 ${
                fitMode === "fit-page"
                  ? "border-brand-primary/35 bg-brand-primary/10 text-brand-primary"
                  : "border-gray-200 bg-white text-gray-700 hover:border-brand-primary/25 hover:bg-brand-primary/5"
              }`}
              title="Fit page"
              aria-label="Fit page"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => dispatch({ type: "SET_FIT_MODE", payload: "fit-width" })}
              disabled={!hasDocument}
              className={`rounded-lg border p-2 transition-all duration-200 ${
                fitMode === "fit-width"
                  ? "border-brand-primary/35 bg-brand-primary/10 text-brand-primary"
                  : "border-gray-200 bg-white text-gray-700 hover:border-brand-primary/25 hover:bg-brand-primary/5"
              }`}
              title="Fit width"
              aria-label="Fit width"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>

            {/* Rotate */}
            <button
              onClick={() => rotate("left")}
              disabled={!hasDocument}
              className="rounded-lg border border-gray-200 bg-white p-2 transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5"
              title="Rotate left"
              aria-label="Rotate left"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => rotate("right")}
              disabled={!hasDocument}
              className="rounded-lg border border-gray-200 bg-white p-2 transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5"
              title="Rotate right"
              aria-label="Rotate right"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-2 py-1">
            <button
              disabled={!hasDocument || currentPage <= 1}
              onClick={() => dispatch({ type: "PREV_PAGE" })}
              className="rounded-lg border border-gray-200 bg-white p-2 transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5 disabled:opacity-40"
              title="Previous page"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              <input
                type="number"
                value={currentPage}
                min={1}
                max={numPages}
                disabled={!hasDocument}
                onChange={(e) =>
                  dispatch({
                    type: "SET_PAGE",
                    payload: Number(e.target.value),
                  })
                }
                className="h-9 w-16 rounded-lg border border-gray-200 bg-white px-2 text-center text-sm font-medium focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 transition-all duration-200"
              />
              <span className="text-sm font-medium text-gray-400">/ {hasDocument ? numPages : 1}</span>
            </div>

            <button
              disabled={!hasDocument || currentPage >= numPages}
              onClick={() => dispatch({ type: "NEXT_PAGE" })}
              className="rounded-lg border border-gray-200 bg-white p-2 transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5 disabled:opacity-40"
              title="Next page"
              aria-label="Next page"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex min-w-max items-center gap-2 md:min-w-0">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2 py-1">
            <ToolButton
              icon={<Highlighter className="w-4 h-4 text-yellow-500" />}
              label="Highlight"
              active={selectedTool === "highlight"}
              disabled={!hasDocument}
              onClick={() => {
                dispatch({ type: "SET_SELECTED_TOOL", payload: "highlight" });
                setOpenColorPickerId(null);
              }}
              showColorPicker={true}
              currentColor={toolColors.highlight}
              onColorChange={(color) =>
                dispatch({ type: "SET_TOOL_COLOR", payload: { tool: "highlight", color } })
              }
              colorPickerId="highlight"
              isColorPickerOpen={openColorPickerId === "highlight"}
              onColorPickerToggle={setOpenColorPickerId}
            />

            <ToolButton
              icon={<Square className="w-4 h-4 text-red-500" />}
              label="Rectangle"
              active={selectedTool === "shape-rect"}
              disabled={!hasDocument}
              onClick={() => {
                dispatch({ type: "SET_SELECTED_TOOL", payload: "shape-rect" });
                setOpenColorPickerId(null);
              }}
              showColorPicker={true}
              currentColor={toolColors["shape-rect"]}
              onColorChange={(color) =>
                dispatch({ type: "SET_TOOL_COLOR", payload: { tool: "shape-rect", color } })
              }
              colorPickerId="shape-rect"
              isColorPickerOpen={openColorPickerId === "shape-rect"}
              onColorPickerToggle={setOpenColorPickerId}
            />

            <ToolButton
              icon={<Circle className="w-4 h-4 text-gray-600" />}
              label="Circle"
              active={selectedTool === "shape-circle"}
              disabled={!hasDocument}
              onClick={() => {
                dispatch({ type: "SET_SELECTED_TOOL", payload: "shape-circle" });
                setOpenColorPickerId(null);
              }}
              showColorPicker={true}
              currentColor={toolColors["shape-circle"]}
              onColorChange={(color) =>
                dispatch({ type: "SET_TOOL_COLOR", payload: { tool: "shape-circle", color } })
              }
              colorPickerId="shape-circle"
              isColorPickerOpen={openColorPickerId === "shape-circle"}
              onColorPickerToggle={setOpenColorPickerId}
            />

            <ToolButton
              icon={<ArrowRight className="w-4 h-4 text-green-500" />}
              label="Arrow"
              active={selectedTool === "arrow"}
              disabled={!hasDocument}
              onClick={() => {
                dispatch({ type: "SET_SELECTED_TOOL", payload: "arrow" });
                setOpenColorPickerId(null);
              }}
              showColorPicker={true}
              currentColor={toolColors.arrow}
              onColorChange={(color) =>
                dispatch({ type: "SET_TOOL_COLOR", payload: { tool: "arrow", color } })
              }
              colorPickerId="arrow"
              isColorPickerOpen={openColorPickerId === "arrow"}
              onColorPickerToggle={setOpenColorPickerId}
            />

            <ToolButton
              icon={<Type className="w-4 h-4" />}
              label="Text Box"
              active={selectedTool === "textbox"}
              disabled={!hasDocument}
              onClick={() => {
                dispatch({ type: "SET_SELECTED_TOOL", payload: "textbox" });
                setOpenColorPickerId(null);
              }}
              showColorPicker={true}
              currentColor={toolColors.textbox}
              onColorChange={(color) =>
                dispatch({ type: "SET_TOOL_COLOR", payload: { tool: "textbox", color } })
              }
              colorPickerId="textbox"
              isColorPickerOpen={openColorPickerId === "textbox"}
              onColorPickerToggle={setOpenColorPickerId}
            />

            <ToolButton
              icon={<Pencil className="w-4 h-4 text-gray-600" />}
              label="Draw"
              active={selectedTool === "draw"}
              disabled={!hasDocument}
              onClick={() => {
                dispatch({ type: "SET_SELECTED_TOOL", payload: "draw" });
                setOpenColorPickerId(null);
              }}
              showColorPicker={true}
              currentColor={toolColors.draw}
              onColorChange={(color) =>
                dispatch({ type: "SET_TOOL_COLOR", payload: { tool: "draw", color } })
              }
              colorPickerId="draw"
              isColorPickerOpen={openColorPickerId === "draw"}
              onColorPickerToggle={setOpenColorPickerId}
            />

            <ToolButton
              icon={<Eraser className="w-4 h-4 text-gray-700" />}
              label="Erase"
              active={selectedTool === "erase"}
              disabled={!hasDocument}
              onClick={() =>
                dispatch({ type: "SET_SELECTED_TOOL", payload: "erase" })
              }
            />

            <ToolButton
              icon={<Workflow className="w-4 h-4 text-red-400" />}
              label="P&ID"
              active={showPidPanel || selectedTool === "pid-symbol"}
              disabled={!hasDocument}
              onClick={() => {
                const opening = !showPidPanel;
                dispatch({ type: "SET_SHOW_PID_PANEL", payload: opening });
                dispatch({ type: "SET_SELECTED_TOOL", payload: opening ? "pid-symbol" : "select" });
              }}
            />

            <div className="relative signature-dropdown-container">
              <ToolButton
                icon={<ImageIcon className="w-4 h-4" />}
                label="Signature"
                active={selectedTool === "signature"}
                disabled={!hasDocument}
                onClick={() => {
                  dispatch({ type: "SET_SELECTED_TOOL", payload: "signature" });
                  setSignatureDropdownOpen(!signatureDropdownOpen);
                }}
              />
              {signatureDropdownOpen && (
                <div 
                  className="absolute top-full left-0 mt-2 bg-white/95 backdrop-blur-sm border-2 border-gray-200 shadow-xl rounded-2xl z-50 p-4 min-w-[200px]"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {signatureImage ? (
                    <>
                      <div className="mb-3 p-3 border-2 border-gray-200 rounded-xl bg-gray-50">
                        <img 
                          src={signatureImage} 
                          alt="Signature" 
                          className="max-w-full max-h-24 mx-auto object-contain"
                        />
                      </div>
                      <label className="block w-full">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleSignatureUpload}
                          className="hidden"
                        />
                        <div className="flex items-center gap-2 px-3 py-2 hover:bg-brand-primary/10 text-sm cursor-pointer rounded-xl transition-colors font-medium">
                          <Upload className="w-4 h-4" />
                          <span>Change Image</span>
                        </div>
                      </label>
                      <button
                        onClick={() => {
                          dispatch({ type: "SET_SIGNATURE_IMAGE", payload: null });
                          setSignatureDropdownOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-red-50 text-sm text-red-600 rounded-xl mt-2 transition-colors font-medium"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <label className="block w-full">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleSignatureUpload}
                        className="hidden"
                      />
                      <div className="flex items-center gap-2 px-3 py-2 hover:bg-brand-primary/10 text-sm cursor-pointer rounded-xl transition-colors font-medium">
                        <Upload className="w-4 h-4" />
                        <span>Upload Image</span>
                      </div>
                    </label>
                  )}
                  {signatureImage && (
                    <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
                      Click on PDF to place signature
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2 py-1">
            <ToolButton
              icon={<Bookmark className="w-4 h-4 text-gray-600" />}
              label="Bookmark"
              disabled={!hasDocument}
              onClick={() =>
                dispatch({ type: "ADD_BOOKMARK", payload: currentPage })
              }
            />

            <ToolButton
              icon={<Download className="w-4 h-4" />}
              label="Save PDF"
              disabled={!hasDocument || !pdfBytes || isSaving}
              onClick={async () => {
                if (!pdfBytes || isSaving) return;

                try {
                  setIsSaving(true);
                  
                  // Clone the ArrayBuffer before passing to save function
                  // This prevents issues with detached buffers
                  let clonedBytes: ArrayBuffer;
                  try {
                    clonedBytes = pdfBytes.slice(0);
                  } catch (e) {
                    // If slice fails, create a new buffer and copy the data
                    const sourceView = new Uint8Array(pdfBytes);
                    const newBuffer = new ArrayBuffer(sourceView.length);
                    const newView = new Uint8Array(newBuffer);
                    newView.set(sourceView);
                    clonedBytes = newBuffer;
                  }
                  
                  const bytes = await saveAnnotatedPdf(clonedBytes, annotations);
                  // Convert Uint8Array to regular ArrayBuffer
                  const arrayBuffer = new ArrayBuffer(bytes.length);
                  const view = new Uint8Array(arrayBuffer);
                  view.set(bytes);
                  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
                  
                  // Use File System Access API if available (shows save dialog)
                  let useFallback = true;
                  // @ts-ignore - File System Access API types may not be available
                  if ("showSaveFilePicker" in window) {
                    try {
                      // @ts-ignore
                      const fileHandle = await window.showSaveFilePicker({
                        suggestedName: `annotated-${new Date().getTime()}.pdf`,
                        types: [{
                          description: "PDF files",
                          accept: { "application/pdf": [".pdf"] },
                        }],
                      });
                      
                      const writable = await fileHandle.createWritable();
                      await writable.write(blob);
                      await writable.close();
                      useFallback = false; // Success, don't use fallback
                    } catch (saveError: any) {
                      // User cancelled the dialog - don't show error, just return
                      if (saveError.name === "AbortError") {
                        return;
                      }
                      // For other errors, fall back to download method
                      console.warn("File System Access API failed, falling back to download:", saveError);
                      useFallback = true; // Use fallback
                    }
                  }
                  
                  // Fallback for browsers that don't support File System Access API
                  // or if the API call failed (but user didn't cancel)
                  if (useFallback) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `annotated-${new Date().getTime()}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }
                  
                  // Mark as saved
                  dispatch({ type: "SET_DIRTY_STATE", payload: false });
                } catch (error: any) {
                  console.error("Error saving PDF:", error);
                  const errorMessage = error?.message || "Unknown error occurred";
                  alert(`Failed to save PDF: ${errorMessage}\n\nPlease check the console for more details.`);
                } finally {
                  setIsSaving(false);
                }
              }}
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2 py-1">
            <ToolButton
              icon={<PanelLeft className="w-4 h-4" />}
              label="Pages"
              active={showPages}
              disabled={!hasDocument}
              onClick={onTogglePages}
            />
            <ToolButton
              icon={<PanelRight className="w-4 h-4" />}
              label="Review"
              active={showAnnotations}
              disabled={!hasDocument}
              onClick={onToggleAnnotations}
            />
          </div>
        </div>
      </div>

      {/* SEARCH BOX */}
      {searchOpen && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <div className="flex items-center gap-2">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="h-11 flex-1 rounded-xl border border-gray-200 bg-white px-4 text-sm focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20 transition-all duration-200"
              placeholder="Search in document..."
              autoFocus
            />
            <button 
              onClick={handleFind}
              disabled={isSearching}
              className="h-11 rounded-xl bg-brand-primary px-4 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-brand-primary-hover hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSearching ? "Searching..." : "Find"}
            </button>
            {(searchResults.length > 0 || search.matches.length > 0) && (() => {
              const totalMatches = search.matches.length > 0 
                ? search.matches.reduce((sum, match) => sum + match.rect.length, 0)
                : searchResults.length;
              const currentMatch = search.matches.length > 0 
                ? search.activeIndex + 1
                : currentMatchIndex + 1;
              
              return (
                <>
                  <button
                    onClick={handlePrevMatch}
                    disabled={isSearching}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5 disabled:opacity-50"
                    title="Previous match"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleNextMatch}
                    disabled={isSearching}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5 disabled:opacity-50"
                    title="Next match"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600 px-2 font-medium">
                    {currentMatch} of {totalMatches}
                  </span>
                </>
              );
            })()}
            <button
              onClick={() => {
                setSearchOpen(false);
                dispatch({ type: "SET_SEARCH_TERM", payload: "" });
                dispatch({ type: "SET_SEARCH_RESULTS", payload: [] });
                dispatch({ type: "CLEAR_SEARCH" });
              }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 transition-all duration-200 hover:border-brand-primary/25 hover:bg-brand-primary/5"
              title="Close search"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {searchTerm && searchResults.length === 0 && !isSearching && (
            <div className="text-sm text-gray-500 mt-2 px-1">
              No matches found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
