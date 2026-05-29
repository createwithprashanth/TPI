import { useEffect, useRef, useState } from "react";
import { usePdfContext } from "./context/PdfContext";
import type { Annotation, PdfState } from "./context/PdfState";

type ReviewSessionState = Partial<
  Pick<
    PdfState,
    | "annotations"
    | "bookmarks"
    | "currentPage"
    | "scale"
    | "rotation"
    | "viewMode"
    | "fitMode"
    | "toolColors"
    | "signatureImage"
    | "pidSelectedSymbolId"
    | "pidColor"
    | "showPidPanel"
    | "stampText"
    | "measureUnit"
    | "measureScale"
  >
>;

type PrecisionPdfReviewSession = {
  app: "PrecisionPDF";
  version: 1;
  savedAt: string;
  document: {
    name: string | null;
    pageCount: number;
  };
  state: ReviewSessionState;
};

function safeSessionName(documentName?: string) {
  const base = (documentName || "review-session")
    .replace(/\.pdf$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "review-session"}.precisionpdf.json`;
}

function isAnnotationList(value: unknown): value is Annotation[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const annotation = item as Partial<Annotation>;
    return (
      typeof annotation.id === "string" &&
      typeof annotation.type === "string" &&
      typeof annotation.page === "number" &&
      typeof annotation.rect === "object" &&
      typeof annotation.createdAt === "number" &&
      typeof annotation.updatedAt === "number"
    );
  });
}

function normalizeAnnotations(value: unknown): Record<number, Annotation[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Session is missing annotations.");
  }

  const normalized: Record<number, Annotation[]> = {};
  for (const [page, list] of Object.entries(value)) {
    const pageNumber = Number(page);
    if (!Number.isFinite(pageNumber) || pageNumber < 1 || !isAnnotationList(list)) {
      throw new Error("Session annotations are not valid.");
    }
    normalized[pageNumber] = list;
  }
  return normalized;
}

function parseReviewSession(raw: string): PrecisionPdfReviewSession {
  const parsed = JSON.parse(raw) as PrecisionPdfReviewSession;
  if (!parsed || parsed.app !== "PrecisionPDF" || parsed.version !== 1 || !parsed.state) {
    throw new Error("This is not a PrecisionPDF review session.");
  }

  return {
    ...parsed,
    state: {
      ...parsed.state,
      annotations: normalizeAnnotations(parsed.state.annotations),
    },
  };
}

export default function ReviewSessionBridge({ documentName }: { documentName?: string }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const {
    annotations,
    bookmarks,
    currentPage,
    scale,
    rotation,
    viewMode,
    fitMode,
    toolColors,
    signatureImage,
    pidSelectedSymbolId,
    pidColor,
    showPidPanel,
    stampText,
    measureUnit,
    measureScale,
    numPages,
    pdfDoc,
    dispatch,
  } = usePdfContext();

  const showMessage = (nextMessage: string) => {
    setMessage(nextMessage);
    window.setTimeout(() => setMessage(null), 2800);
  };

  const saveSession = () => {
    if (!pdfDoc) return;

    const session: PrecisionPdfReviewSession = {
      app: "PrecisionPDF",
      version: 1,
      savedAt: new Date().toISOString(),
      document: {
        name: documentName ?? null,
        pageCount: numPages,
      },
      state: {
        annotations,
        bookmarks,
        currentPage,
        scale,
        rotation,
        viewMode,
        fitMode,
        toolColors,
        signatureImage,
        pidSelectedSymbolId,
        pidColor,
        showPidPanel,
        stampText,
        measureUnit,
        measureScale,
      },
    };

    const blob = new Blob([JSON.stringify(session, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeSessionName(documentName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage("Review session saved.");
  };

  const openSessionPicker = () => {
    if (!pdfDoc) return;
    fileInputRef.current?.click();
  };

  const importSession = async (file: File) => {
    try {
      const session = parseReviewSession(await file.text());
      dispatch({
        type: "IMPORT_REVIEW_SESSION",
        payload: {
          ...session.state,
          showPidPanel: false,
        },
      });
      showMessage("Review session loaded.");
    } catch (error: any) {
      console.error("Failed to open PrecisionPDF session:", error);
      showMessage(error?.message || "Failed to open review session.");
    }
  };

  useEffect(() => {
    const onSave = () => saveSession();
    const onOpen = () => openSessionPicker();

    window.addEventListener("precisionpdf:save-session", onSave);
    window.addEventListener("precisionpdf:open-session", onOpen);
    return () => {
      window.removeEventListener("precisionpdf:save-session", onSave);
      window.removeEventListener("precisionpdf:open-session", onOpen);
    };
  });

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".precisionpdf.json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importSession(file);
        }}
      />
      {message ? (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-[9999] -translate-x-1/2 border border-[#454545] bg-[#252526] px-3 py-2 text-xs text-[#cccccc] shadow-2xl">
          {message}
        </div>
      ) : null}
    </>
  );
}
