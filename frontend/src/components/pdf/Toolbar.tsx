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
  FolderOpen,
  Save,
  Stamp,
  Ruler,
  CheckSquare,
  CalendarDays,
  PenLine,
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
    ? "bg-[#04395e] text-white ring-1 ring-[#3794ff]/45"
    : "text-[#cccccc]";
  const hoverBtn = disabled
    ? "cursor-not-allowed opacity-35"
    : "hover:bg-[#2a2d2e] hover:text-white";

  return (
    <div className="relative group shrink-0" style={{ zIndex: isColorPickerOpen ? 99999 : "auto" }}>
      <div className="flex items-center">
        <button
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onClick?.();
          }}
          title={label}
          aria-label={label}
          className={`relative inline-flex h-8 w-8 items-center justify-center text-[13px] transition-colors
            ${hasColor ? "rounded-l-[3px] rounded-r-none" : "rounded-[3px]"}
            ${baseBtn} ${hoverBtn}
          `}
        >
          {icon}
          <span className="sr-only">{label}</span>
          {dropdown && <ChevronDown className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 opacity-70" />}
        </button>

        {hasColor && (
          <div
            className={`flex h-8 items-center rounded-r-[3px] px-1 transition-colors
              ${active ? "bg-[#04395e] ring-1 ring-[#3794ff]/45" : "bg-transparent hover:bg-[#2a2d2e]"}
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
        <div className="absolute top-full left-0 z-50 mt-1 hidden min-w-40 border border-[#454545] bg-[#252526] py-1 shadow-2xl group-hover:block">
          {dropdown}
        </div>
      )}
    </div>
  );
}

const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-[#cccccc] transition-colors hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-35";

const activeIconButtonClass =
  "bg-[#04395e] text-white ring-1 ring-[#3794ff]/45";

const toolbarGroupClass =
  "flex h-9 items-center gap-0.5 border-r border-[#2b2b2b] px-1.5";

const commandInputClass =
  "h-7 rounded-[3px] border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-xs text-[#cccccc] outline-none transition-colors placeholder:text-[#6a6a6a] focus:border-[#3794ff]";

const menuButtonClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#cccccc] transition-colors hover:bg-[#04395e] hover:text-white";

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
    stampText,
    measureUnit,
    measureScale,
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

  useEffect(() => {
    const toggleSearch = () => setSearchOpen((value) => !value);
    window.addEventListener("precisionpdf:toggle-search", toggleSearch);
    return () => window.removeEventListener("precisionpdf:toggle-search", toggleSearch);
  }, []);

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
      className="relative w-full border-b border-[#2b2b2b] bg-[#181818] text-[#cccccc]"
      style={{ zIndex: 2000 }}
    >
      <div className="w-full overflow-x-auto md:overflow-visible">
        <div className="flex min-w-max items-center md:min-w-0">
          <div className={toolbarGroupClass}>
            <button
              type="button"
              onClick={onOpenFile}
              className="inline-flex h-8 items-center gap-1.5 rounded-[3px] bg-[#0e639c] px-2.5 text-xs font-medium text-white transition-colors hover:bg-[#1177bb]"
              title="Open PDF"
            >
              <Upload className="h-4 w-4" />
              Open
            </button>
          </div>

          <div className={toolbarGroupClass}>
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

          <div className={toolbarGroupClass}>
            <ToolButton
              icon={<Search className="w-4 h-4" />}
              label="Find"
              active={searchOpen}
              disabled={!hasDocument}
              onClick={() => setSearchOpen((s) => !s)}
            />
          </div>

          <div className={toolbarGroupClass}>
            <ToolButton
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Layout"
              disabled={!hasDocument}
              dropdown={
                <div>
                  <button
                    className={menuButtonClass}
                    onClick={() => dispatch({ type: "SET_VIEW_MODE", payload: "single" })}
                  >
                    Single Page
                  </button>
                  <button
                    className={menuButtonClass}
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
              className={`${commandInputClass} w-[72px]`}
              title="Zoom level"
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
              className={iconButtonClass}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => updateZoom(Math.min(400, zoomLocal + 25))}
              disabled={!hasDocument}
              className={iconButtonClass}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            {/* Fit modes */}
            <button
              onClick={() => dispatch({ type: "SET_FIT_MODE", payload: "fit-page" })}
              disabled={!hasDocument}
              className={`${iconButtonClass} ${fitMode === "fit-page" ? activeIconButtonClass : ""}`}
              title="Fit page"
              aria-label="Fit page"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => dispatch({ type: "SET_FIT_MODE", payload: "fit-width" })}
              disabled={!hasDocument}
              className={`${iconButtonClass} ${fitMode === "fit-width" ? activeIconButtonClass : ""}`}
              title="Fit width"
              aria-label="Fit width"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>

            {/* Rotate */}
            <button
              onClick={() => rotate("left")}
              disabled={!hasDocument}
              className={iconButtonClass}
              title="Rotate left"
              aria-label="Rotate left"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => rotate("right")}
              disabled={!hasDocument}
              className={iconButtonClass}
              title="Rotate right"
              aria-label="Rotate right"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>

          <div className="ml-auto flex h-9 items-center gap-1 border-l border-[#2b2b2b] px-1.5">
            <button
              disabled={!hasDocument || currentPage <= 1}
              onClick={() => dispatch({ type: "PREV_PAGE" })}
              className={iconButtonClass}
              title="Previous page"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-1.5">
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
                className={`${commandInputClass} w-14 text-center`}
              />
              <span className="text-xs font-medium text-[#858585]">/ {hasDocument ? numPages : 1}</span>
            </div>

            <button
              disabled={!hasDocument || currentPage >= numPages}
              onClick={() => dispatch({ type: "NEXT_PAGE" })}
              className={iconButtonClass}
              title="Next page"
              aria-label="Next page"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex min-w-max items-center border-t border-[#2b2b2b] md:min-w-0">
          <div className={toolbarGroupClass}>
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
              icon={<Circle className="w-4 h-4 text-[#cccccc]" />}
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
              icon={<Pencil className="w-4 h-4 text-[#cccccc]" />}
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
              icon={<Eraser className="w-4 h-4 text-[#cccccc]" />}
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

            <ToolButton
              icon={<Stamp className="w-4 h-4 text-[#d16969]" />}
              label="Stamp"
              active={selectedTool === "stamp"}
              disabled={!hasDocument}
              onClick={() => dispatch({ type: "SET_SELECTED_TOOL", payload: "stamp" })}
              dropdown={
                <div>
                  {["APPROVED", "REVIEWED", "REJECTED", "VOID", "DRAFT"].map((label) => (
                    <button
                      key={label}
                      className={menuButtonClass}
                      onClick={() => {
                        dispatch({ type: "SET_STAMP_TEXT", payload: label });
                        dispatch({ type: "SET_SELECTED_TOOL", payload: "stamp" });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <div className="border-t border-[#3c3c3c] p-2">
                    <input
                      value={stampText}
                      onChange={(event) => dispatch({ type: "SET_STAMP_TEXT", payload: event.target.value.toUpperCase() })}
                      className={commandInputClass}
                      placeholder="Custom stamp"
                    />
                  </div>
                </div>
              }
            />

            <ToolButton
              icon={<Ruler className="w-4 h-4 text-[#4ec9b0]" />}
              label="Measure"
              active={selectedTool === "measure"}
              disabled={!hasDocument}
              onClick={() => dispatch({ type: "SET_SELECTED_TOOL", payload: "measure" })}
              dropdown={
                <div className="w-52 p-2">
                  <label className="mb-2 block text-[11px] text-[#858585]">
                    Unit
                    <input
                      value={measureUnit}
                      onChange={(event) => dispatch({ type: "SET_MEASURE_SETTINGS", payload: { unit: event.target.value } })}
                      className={commandInputClass}
                      placeholder="m"
                    />
                  </label>
                  <label className="block text-[11px] text-[#858585]">
                    Units per page width
                    <input
                      type="number"
                      min={0.01}
                      step={0.1}
                      value={measureScale}
                      onChange={(event) => dispatch({ type: "SET_MEASURE_SETTINGS", payload: { scale: Number(event.target.value) || 1 } })}
                      className={commandInputClass}
                    />
                  </label>
                </div>
              }
            />

            <ToolButton
              icon={<Type className="w-4 h-4 text-[#3794ff]" />}
              label="Form Text Field"
              active={selectedTool === "form-text"}
              disabled={!hasDocument}
              onClick={() => dispatch({ type: "SET_SELECTED_TOOL", payload: "form-text" })}
            />

            <ToolButton
              icon={<CheckSquare className="w-4 h-4 text-[#3794ff]" />}
              label="Form Checkbox"
              active={selectedTool === "form-checkbox"}
              disabled={!hasDocument}
              onClick={() => dispatch({ type: "SET_SELECTED_TOOL", payload: "form-checkbox" })}
            />

            <ToolButton
              icon={<CalendarDays className="w-4 h-4 text-[#3794ff]" />}
              label="Form Date Field"
              active={selectedTool === "form-date"}
              disabled={!hasDocument}
              onClick={() => dispatch({ type: "SET_SELECTED_TOOL", payload: "form-date" })}
            />

            <ToolButton
              icon={<PenLine className="w-4 h-4 text-[#c586c0]" />}
              label="Form Signature Field"
              active={selectedTool === "form-signature"}
              disabled={!hasDocument}
              onClick={() => dispatch({ type: "SET_SELECTED_TOOL", payload: "form-signature" })}
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
                  className="absolute left-0 top-full z-50 mt-1 min-w-[220px] border border-[#454545] bg-[#252526] p-2 shadow-2xl"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {signatureImage ? (
                    <>
                      <div className="mb-2 border border-[#3c3c3c] bg-[#1e1e1e] p-2">
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
                        <div className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-[#cccccc] transition-colors hover:bg-[#04395e] hover:text-white">
                          <Upload className="w-4 h-4" />
                          <span>Change Image</span>
                        </div>
                      </label>
                      <button
                        onClick={() => {
                          dispatch({ type: "SET_SIGNATURE_IMAGE", payload: null });
                          setSignatureDropdownOpen(false);
                        }}
                        className="mt-1 w-full px-2 py-1.5 text-left text-xs text-[#f48771] transition-colors hover:bg-[#5a1d1d] hover:text-white"
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
                      <div className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-[#cccccc] transition-colors hover:bg-[#04395e] hover:text-white">
                        <Upload className="w-4 h-4" />
                        <span>Upload Image</span>
                      </div>
                    </label>
                  )}
                  {signatureImage && (
                    <div className="mt-2 border-t border-[#3c3c3c] pt-2 text-[11px] text-[#858585]">
                      Click on PDF to place signature
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={toolbarGroupClass}>
            <ToolButton
              icon={<Bookmark className="w-4 h-4 text-[#cccccc]" />}
              label="Bookmark"
              disabled={!hasDocument}
              onClick={() =>
                dispatch({ type: "ADD_BOOKMARK", payload: currentPage })
              }
            />

            <ToolButton
              icon={<FolderOpen className="w-4 h-4" />}
              label="Open Review Session"
              disabled={!hasDocument}
              onClick={() => window.dispatchEvent(new CustomEvent("precisionpdf:open-session"))}
            />

            <ToolButton
              icon={<Save className="w-4 h-4" />}
              label="Save Review Session"
              disabled={!hasDocument}
              onClick={() => window.dispatchEvent(new CustomEvent("precisionpdf:save-session"))}
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

          <div className={toolbarGroupClass}>
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
        <div className="border-t border-[#2b2b2b] bg-[#1f1f1f] px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className={`${commandInputClass} flex-1`}
              placeholder="Search in document..."
              autoFocus
            />
            <button 
              onClick={handleFind}
              disabled={isSearching}
              className="h-7 rounded-[3px] bg-[#0e639c] px-3 text-xs font-medium text-white transition-colors hover:bg-[#1177bb] disabled:cursor-not-allowed disabled:opacity-50"
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
                    className={iconButtonClass}
                    title="Previous match"
                    aria-label="Previous match"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleNextMatch}
                    disabled={isSearching}
                    className={iconButtonClass}
                    title="Next match"
                    aria-label="Next match"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="px-2 text-xs font-medium text-[#858585]">
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
              className={iconButtonClass}
              title="Close search"
              aria-label="Close search"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {searchTerm && searchResults.length === 0 && !isSearching && (
            <div className="mt-1 px-1 text-xs text-[#858585]">
              No matches found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
