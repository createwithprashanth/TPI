// src/context/pdf/PdfActions.ts
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import type { Annotation, PdfState, ToolName } from "./PdfState";

export type PdfAction =
    | { type: "LOAD_PDF_START" }
    | {
        type: "LOAD_PDF_SUCCESS";
        payload: {
            pdfDoc: PDFDocumentProxy;
            pdfBytes: ArrayBuffer;
            numPages: number;
            firstViewport: PageViewport;
            firstPageSize: { width: number; height: number };
        };
    }
    | { type: "LOAD_PDF_ERROR"; payload: string }
    | { type: "UNLOAD_PDF" }

    | { type: "SET_PAGE"; payload: number }
    | { type: "SET_CURRENT_PAGE"; payload: number }
    | { type: "NEXT_PAGE" }
    | { type: "PREV_PAGE" }

    | { type: "SET_SCALE"; payload: number }
    | { type: "SET_ROTATION"; payload: number }
     | { type: "SET_FIT_MODE"; payload: "custom" | "fit-width" | "fit-page" }
    | { type: "SET_VIEW_MODE"; payload: "single" | "continuous" }

    | { type: "SET_SELECTED_TOOL"; payload: ToolName }

    | { type: "SET_THUMBNAIL_FOR_PAGE"; payload: { page: number; dataUrl: string } }

    | { type: "TOGGLE_NIGHT_MODE" }
    | { type: "SET_BACKGROUND_MODE"; payload: "white" | "light" | "dark" }

    | { type: "ADD_BOOKMARK"; payload: number }
    | { type: "REMOVE_BOOKMARK"; payload: number }

    | { type: "SET_DIRTY_STATE"; payload: boolean }

    | { type: "ADD_ANNOTATION"; payload: Annotation }
    | { type: "UPDATE_ANNOTATION"; payload: { page: number; id: string; updates: Partial<Annotation> } }
    | { type: "REMOVE_ANNOTATION"; payload: { page: number; id: string } }

    | { type: "SET_SEARCH_TERM"; payload: string }
    | { type: "SET_SEARCH_RESULTS"; payload: Array<{ page: number; index: number; text: string; x: number; y: number; width: number; height: number }> | PdfState["search"]["matches"] }
    | { type: "SET_CURRENT_MATCH"; payload: number }
    | { type: "NEXT_MATCH" }
    | { type: "PREV_MATCH" }

    | { type: "UNDO" }
    | { type: "REDO" }
    | {type: "PUSH_HISTORY"; payload: PdfAction}
    | { type: "CLEAR_REDO"}

    | { type: "SET_TOOL_COLOR"; payload: { tool: ToolName; color: string } }
    | { type: "SET_SIGNATURE_IMAGE"; payload: string | null }
    | { type: "SET_SEARCH_QUERY"; payload: string}
    | { type: "SET_ACTIVE_SEARCH_INDEX"; payload: number}
    | { type: "CLEAR_SEARCH" }
    | { type: "SELECT_ANNOTATION"; payload: { page: number; id: string | null } }
    | { type: "SET_PID_SYMBOL"; payload: string | null }
    | { type: "SET_PID_COLOR"; payload: string }
    | { type: "TOGGLE_PID_PANEL" }
    | { type: "SET_SHOW_PID_PANEL"; payload: boolean };
