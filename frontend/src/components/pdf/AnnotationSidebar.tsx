import { Download, MessageSquare, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePdfContext } from "./context/PdfContext";
import type { Annotation } from "./context/PdfState";

type ReviewStatus = "open" | "resolved" | "rejected";

const inputClass =
  "h-7 w-full rounded-[3px] border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-xs text-[#cccccc] outline-none transition-colors placeholder:text-[#6a6a6a] focus:border-[#3794ff]";
const textAreaClass =
  "min-h-16 w-full resize-y rounded-[3px] border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1.5 text-xs text-[#cccccc] outline-none transition-colors placeholder:text-[#6a6a6a] focus:border-[#3794ff]";
const buttonClass =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded-[3px] px-2 text-xs font-medium text-[#cccccc] transition-colors hover:bg-[#2a2d2e] hover:text-white";

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getAnnotationTitle(annotation: Annotation): string {
  return annotation.meta?.label || annotation.meta?.text || annotation.type;
}

export default function AnnotationSidebar({ onClose }: { onClose?: () => void }) {
  const { annotations, dispatch, selectedAnnotationId } = usePdfContext();
  const [draftComment, setDraftComment] = useState("");

  const all = useMemo(
    () => Object.entries(annotations)
      .flatMap(([page, list]) => list.map((annotation) => ({ page: Number(page), annotation })))
      .sort((a, b) => a.page - b.page || a.annotation.createdAt - b.annotation.createdAt),
    [annotations],
  );

  const selected = all.find((item) => item.annotation.id === selectedAnnotationId) ?? null;
  const selectedMeta = selected?.annotation.meta ?? {};
  const selectedStatus = (selectedMeta.reviewStatus ?? "open") as ReviewStatus;

  const updateSelected = (updates: Partial<Annotation>, metaUpdates?: Record<string, unknown>) => {
    if (!selected) return;
    dispatch({
      type: "UPDATE_ANNOTATION",
      payload: {
        page: selected.page,
        id: selected.annotation.id,
        updates: {
          ...updates,
          meta: metaUpdates ? { ...selected.annotation.meta, ...metaUpdates } : updates.meta,
        },
      },
    });
  };

  const exportCsv = () => {
    const rows = [
      ["Page", "Type", "Status", "Title", "Field Name", "Value", "Required", "Comment", "Assignee", "Due Date", "X", "Y", "Width", "Height"],
      ...all.map(({ page, annotation }) => [
        page,
        annotation.type,
        annotation.meta?.reviewStatus ?? "open",
        getAnnotationTitle(annotation),
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
    ];
    downloadText(
      `precisionpdf-review-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((row) => row.map(csvEscape).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  };

  useEffect(() => {
    const onExport = () => exportCsv();
    window.addEventListener("precisionpdf:export-review", onExport);
    return () => window.removeEventListener("precisionpdf:export-review", onExport);
  }, [all]);

  const addComment = () => {
    if (!selected || !draftComment.trim()) return;
    const comments = Array.isArray(selectedMeta.comments) ? selectedMeta.comments : [];
    updateSelected({}, {
      reviewComment: draftComment.trim(),
      comments: [
        ...comments,
        {
          id: crypto.randomUUID?.() ?? Date.now().toString(),
          text: draftComment.trim(),
          createdAt: new Date().toISOString(),
        },
      ],
      reviewStatus: selectedStatus,
    });
    setDraftComment("");
  };

  return (
    <div className="flex h-full flex-col bg-[#181818] text-[#cccccc]">
      <div className="border-b border-[#2b2b2b] px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#858585]">Review</div>
            <h3 className="mt-1 text-sm font-semibold text-[#cccccc]">Annotations</h3>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={exportCsv} className={buttonClass} title="Export review CSV" aria-label="Export review CSV">
              <Download className="h-4 w-4" />
            </button>
            {onClose ? (
              <button type="button" onClick={onClose} className={buttonClass} title="Close review panel" aria-label="Close review panel">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="border-b border-[#2b2b2b] p-2">
          {all.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#858585]">
              <MessageSquare className="mx-auto mb-2 h-5 w-5" />
              No annotations yet.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {all.map(({ page, annotation }) => {
                const active = annotation.id === selectedAnnotationId;
                return (
                  <li key={annotation.id}>
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({ type: "SET_PAGE", payload: page });
                        dispatch({ type: "SELECT_ANNOTATION", payload: { page, id: annotation.id } });
                      }}
                      className={`w-full border px-2 py-1.5 text-left transition-colors ${
                        active
                          ? "border-[#3794ff]/60 bg-[#04395e]"
                          : "border-[#2b2b2b] bg-[#1e1e1e] hover:border-[#454545] hover:bg-[#252526]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-[#cccccc]">{getAnnotationTitle(annotation)}</span>
                        <span className="shrink-0 text-[10px] text-[#858585]">P{page}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[#858585]">
                        <span>{annotation.type}</span>
                        <span className={annotation.meta?.reviewStatus === "resolved" ? "text-[#89d185]" : annotation.meta?.reviewStatus === "rejected" ? "text-[#f48771]" : "text-[#cca700]"}>
                          {annotation.meta?.reviewStatus ?? "open"}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selected ? (
          <div className="space-y-3 p-3">
            <section className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#858585]">Properties</div>
              <label className="block text-[11px] text-[#858585]">
                Label
                <input
                  value={selectedMeta.label ?? selectedMeta.text ?? ""}
                  onChange={(event) => updateSelected(
                    {},
                    selected.annotation.type === "textbox" || selected.annotation.type === "stamp"
                      ? { text: event.target.value }
                      : { label: event.target.value },
                  )}
                  className={inputClass}
                />
              </label>
              {selected.annotation.type === "measure" ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[11px] text-[#858585]">
                    Value
                    <input
                      type="number"
                      step={0.01}
                      value={Number(selectedMeta.value ?? 0).toFixed(2)}
                      onChange={(event) => {
                        const value = Number(event.target.value) || 0;
                        updateSelected({}, {
                          value,
                          label: `${value.toFixed(2)} ${selectedMeta.unit ?? "m"}`,
                        });
                      }}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-[11px] text-[#858585]">
                    Unit
                    <input
                      value={selectedMeta.unit ?? "m"}
                      onChange={(event) => updateSelected({}, {
                        unit: event.target.value,
                        label: `${Number(selectedMeta.value ?? 0).toFixed(2)} ${event.target.value}`,
                      })}
                      className={inputClass}
                    />
                  </label>
                </div>
              ) : null}
              {selected.annotation.type.startsWith("form-") ? (
                <div className="space-y-2 border border-[#2b2b2b] bg-[#1e1e1e] p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#858585]">Form Field</div>
                  <label className="block text-[11px] text-[#858585]">
                    Field Name
                    <input
                      value={selectedMeta.fieldName ?? ""}
                      onChange={(event) => updateSelected({}, { fieldName: event.target.value })}
                      className={inputClass}
                    />
                  </label>
                  {selected.annotation.type === "form-checkbox" ? (
                    <label className="flex items-center gap-2 text-[11px] text-[#858585]">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedMeta.checked)}
                        onChange={(event) => updateSelected({}, {
                          checked: event.target.checked,
                          value: event.target.checked ? "Yes" : "",
                        })}
                        className="accent-[#3794ff]"
                      />
                      Checked
                    </label>
                  ) : (
                    <label className="block text-[11px] text-[#858585]">
                      Value
                      <input
                        type={selected.annotation.type === "form-date" ? "date" : "text"}
                        value={selectedMeta.value ?? ""}
                        onChange={(event) => updateSelected({}, { value: event.target.value })}
                        className={inputClass}
                      />
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] text-[#858585]">
                      Font
                      <input
                        type="number"
                        min={8}
                        max={32}
                        value={selectedMeta.fontSize ?? 12}
                        onChange={(event) => updateSelected({}, { fontSize: Number(event.target.value) })}
                        className={inputClass}
                      />
                    </label>
                    <label className="block text-[11px] text-[#858585]">
                      Border
                      <input
                        type="color"
                        value={selectedMeta.borderColor ?? selectedMeta.color ?? "#3794ff"}
                        onChange={(event) => updateSelected({}, { borderColor: event.target.value })}
                        className="h-7 w-full rounded-[3px] border border-[#3c3c3c] bg-[#1e1e1e]"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-[#858585]">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedMeta.required)}
                      onChange={(event) => updateSelected({}, { required: event.target.checked })}
                      className="accent-[#3794ff]"
                    />
                    Required
                  </label>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-[#858585]">
                  Color
                  <input
                    type="color"
                    value={selectedMeta.color ?? "#3794ff"}
                    onChange={(event) => updateSelected({}, { color: event.target.value })}
                    className="h-7 w-full rounded-[3px] border border-[#3c3c3c] bg-[#1e1e1e]"
                  />
                </label>
                <label className="block text-[11px] text-[#858585]">
                  Stroke
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={selectedMeta.strokeWidth ?? 2}
                    onChange={(event) => updateSelected({}, { strokeWidth: Number(event.target.value) })}
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="block text-[11px] text-[#858585]">
                Opacity
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round((selectedMeta.opacity ?? 1) * 100)}
                  onChange={(event) => updateSelected({}, { opacity: Number(event.target.value) / 100 })}
                  className="w-full accent-[#3794ff]"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key} className="block text-[11px] capitalize text-[#858585]">
                    {key}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={Number((selected.annotation.rect[key] * 100).toFixed(1))}
                      onChange={(event) => {
                        const next = Math.max(0, Math.min(100, Number(event.target.value))) / 100;
                        updateSelected({ rect: { ...selected.annotation.rect, [key]: next } });
                      }}
                      className={inputClass}
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-2 border-t border-[#2b2b2b] pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#858585]">Review Workflow</div>
              <label className="block text-[11px] text-[#858585]">
                Status
                <select
                  value={selectedStatus}
                  onChange={(event) => updateSelected({}, { reviewStatus: event.target.value })}
                  className={inputClass}
                >
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-[#858585]">
                  Assignee
                  <input
                    value={selectedMeta.assignee ?? ""}
                    onChange={(event) => updateSelected({}, { assignee: event.target.value })}
                    className={inputClass}
                    placeholder="Name"
                  />
                </label>
                <label className="block text-[11px] text-[#858585]">
                  Due
                  <input
                    type="date"
                    value={selectedMeta.dueDate ?? ""}
                    onChange={(event) => updateSelected({}, { dueDate: event.target.value })}
                    className={inputClass}
                  />
                </label>
              </div>
              <textarea
                value={draftComment}
                onChange={(event) => setDraftComment(event.target.value)}
                className={textAreaClass}
                placeholder="Add review comment..."
              />
              <button type="button" onClick={addComment} className="h-7 rounded-[3px] bg-[#0e639c] px-3 text-xs font-medium text-white transition-colors hover:bg-[#1177bb]">
                Add Comment
              </button>
              {Array.isArray(selectedMeta.comments) && selectedMeta.comments.length > 0 ? (
                <ul className="space-y-1.5">
                  {selectedMeta.comments.map((comment: { id: string; text: string; createdAt: string }) => (
                    <li key={comment.id} className="border border-[#2b2b2b] bg-[#1e1e1e] p-2 text-xs">
                      <div className="mb-1 text-[10px] text-[#858585]">{new Date(comment.createdAt).toLocaleString()}</div>
                      <div>{comment.text}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        ) : all.length > 0 ? (
          <div className="p-4 text-center text-xs text-[#858585]">Select an annotation to edit properties.</div>
        ) : null}
      </div>
    </div>
  );
}
