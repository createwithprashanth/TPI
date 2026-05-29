import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckSquare, Download, FileUp, FolderOpen, Maximize2, PanelLeft, PanelRight, PenLine, Ruler, Save, Search, Stamp, Type, Workflow } from "lucide-react";
import { usePdfContext } from "./context/PdfContext";

type CommandPaletteProps = {
  onOpenFile?: () => void;
  onTogglePages?: () => void;
  onToggleAnnotations?: () => void;
  showPages: boolean;
  showAnnotations: boolean;
};

export default function CommandPalette({
  onOpenFile,
  onTogglePages,
  onToggleAnnotations,
  showPages,
  showAnnotations,
}: CommandPaletteProps) {
  const { annotations, dispatch, pdfDoc, showPidPanel } = usePdfContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const hasDocument = Boolean(pdfDoc);

  const exportReviewSummary = () => {
    const rows = [
      ["Page", "Type", "Status", "Title", "Field Name", "Value", "Required", "Comment", "Assignee", "Due Date", "X", "Y", "Width", "Height"],
      ...Object.entries(annotations).flatMap(([page, list]) =>
        list.map((annotation) => [
          page,
          annotation.type,
          annotation.meta?.reviewStatus ?? "open",
          annotation.meta?.label ?? annotation.meta?.text ?? annotation.type,
          annotation.meta?.fieldName ?? "",
          annotation.type === "form-checkbox" ? (annotation.meta?.checked ? "Yes" : "") : annotation.meta?.value ?? "",
          annotation.meta?.required ? "Yes" : "",
          annotation.meta?.reviewComment ?? "",
          annotation.meta?.assignee ?? "",
          annotation.meta?.dueDate ?? "",
          annotation.rect.x.toFixed(4),
          annotation.rect.y.toFixed(4),
          annotation.rect.width.toFixed(4),
          annotation.rect.height.toFixed(4),
        ]),
      ),
    ];
    const csv = rows
      .map((row) => row.map((value) => {
        const text = String(value ?? "");
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      }).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `precisionpdf-review-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const commands = useMemo(() => [
    {
      id: "open",
      label: "Open PDF",
      hint: "Load a document",
      icon: FileUp,
      enabled: true,
      run: () => onOpenFile?.(),
    },
    {
      id: "find",
      label: "Find in Document",
      hint: "Toggle search",
      icon: Search,
      enabled: hasDocument,
      run: () => window.dispatchEvent(new CustomEvent("precisionpdf:toggle-search")),
    },
    {
      id: "fit-page",
      label: "Fit Page",
      hint: "View whole page",
      icon: Maximize2,
      enabled: hasDocument,
      run: () => dispatch({ type: "SET_FIT_MODE", payload: "fit-page" }),
    },
    {
      id: "fit-width",
      label: "Fit Width",
      hint: "Use available width",
      icon: Maximize2,
      enabled: hasDocument,
      run: () => dispatch({ type: "SET_FIT_MODE", payload: "fit-width" }),
    },
    {
      id: "pages",
      label: showPages ? "Hide Pages Panel" : "Show Pages Panel",
      hint: "Toggle thumbnails",
      icon: PanelLeft,
      enabled: hasDocument,
      run: () => onTogglePages?.(),
    },
    {
      id: "review",
      label: showAnnotations ? "Hide Review Panel" : "Show Review Panel",
      hint: "Toggle review properties",
      icon: PanelRight,
      enabled: hasDocument,
      run: () => onToggleAnnotations?.(),
    },
    {
      id: "pid-symbols",
      label: showPidPanel ? "Hide P&ID Symbols" : "Show P&ID Symbols",
      hint: "Open symbol library",
      icon: Workflow,
      enabled: hasDocument,
      run: () => {
        const opening = !showPidPanel;
        dispatch({ type: "SET_SHOW_PID_PANEL", payload: opening });
        dispatch({ type: "SET_SELECTED_TOOL", payload: opening ? "pid-symbol" : "select" });
      },
    },
    {
      id: "stamp",
      label: "Stamp Tool",
      hint: "Place review stamp",
      icon: Stamp,
      enabled: hasDocument,
      run: () => dispatch({ type: "SET_SELECTED_TOOL", payload: "stamp" }),
    },
    {
      id: "measure",
      label: "Measure Tool",
      hint: "Draw calibrated measure",
      icon: Ruler,
      enabled: hasDocument,
      run: () => dispatch({ type: "SET_SELECTED_TOOL", payload: "measure" }),
    },
    {
      id: "form-text",
      label: "Form Text Field",
      hint: "Place fillable text",
      icon: Type,
      enabled: hasDocument,
      run: () => dispatch({ type: "SET_SELECTED_TOOL", payload: "form-text" }),
    },
    {
      id: "form-checkbox",
      label: "Form Checkbox",
      hint: "Place checkbox",
      icon: CheckSquare,
      enabled: hasDocument,
      run: () => dispatch({ type: "SET_SELECTED_TOOL", payload: "form-checkbox" }),
    },
    {
      id: "form-date",
      label: "Form Date Field",
      hint: "Place date input",
      icon: CalendarDays,
      enabled: hasDocument,
      run: () => dispatch({ type: "SET_SELECTED_TOOL", payload: "form-date" }),
    },
    {
      id: "form-signature",
      label: "Form Signature Field",
      hint: "Place signature box",
      icon: PenLine,
      enabled: hasDocument,
      run: () => dispatch({ type: "SET_SELECTED_TOOL", payload: "form-signature" }),
    },
    {
      id: "export-review",
      label: "Export Review Summary",
      hint: "Use review panel export",
      icon: Download,
      enabled: hasDocument,
      run: exportReviewSummary,
    },
    {
      id: "open-session",
      label: "Open Review Session",
      hint: ".precisionpdf.json",
      icon: FolderOpen,
      enabled: hasDocument,
      run: () => window.dispatchEvent(new CustomEvent("precisionpdf:open-session")),
    },
    {
      id: "save-session",
      label: "Save Review Session",
      hint: ".precisionpdf.json",
      icon: Save,
      enabled: hasDocument,
      run: () => window.dispatchEvent(new CustomEvent("precisionpdf:save-session")),
    },
  ], [annotations, dispatch, hasDocument, onOpenFile, onToggleAnnotations, onTogglePages, showAnnotations, showPages, showPidPanel]);

  const visible = commands.filter((command) => {
    const haystack = `${command.label} ${command.hint}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === "k" || (event.shiftKey && key === "p"))) {
        event.preventDefault();
        setOpen(true);
        setQuery("");
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/30 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div
        className="mx-auto w-[min(640px,calc(100vw-32px))] border border-[#454545] bg-[#252526] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
          placeholder="Type a command..."
          className="h-10 w-full border-b border-[#2b2b2b] bg-[#1e1e1e] px-3 text-sm text-[#cccccc] outline-none placeholder:text-[#858585] focus:border-[#3794ff]"
        />
        <div className="max-h-[360px] overflow-auto py-1">
          {visible.map((command) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                type="button"
                disabled={!command.enabled}
                onClick={() => {
                  command.run();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#cccccc] transition-colors hover:bg-[#04395e] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                <span className="shrink-0 text-xs text-[#858585]">{command.hint}</span>
              </button>
            );
          })}
          {visible.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[#858585]">No commands found.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
