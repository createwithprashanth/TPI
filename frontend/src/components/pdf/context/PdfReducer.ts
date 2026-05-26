// src/context/pdf/PdfReducer.ts
import { initialPdfState } from "./PdfState";
import type { PdfState } from "./PdfState";
import type { PdfAction } from "./PdfActions";

// Helper function to apply an action forward (for undo/redo)
function applyForward(state: PdfState, action: PdfAction): Partial<PdfState> {
  switch (action.type) {
    case "ADD_ANNOTATION": {
      const page = action.payload.page;
      return {
        annotations: {
          ...state.annotations,
          [page]: [...(state.annotations[page] || []), action.payload],
        },
      };
    }

    case "REMOVE_ANNOTATION": {
      const { page, id } = action.payload;
      return {
        annotations: {
          ...state.annotations,
          [page]: (state.annotations[page] || []).filter(
            (a) => a.id !== id
          ),
        },
      };
    }

    case "UPDATE_ANNOTATION": {
      const { page, id, updates } = action.payload;
      return {
        annotations: {
          ...state.annotations,
          [page]: (state.annotations[page] || []).map((a) =>
            a.id === id ? { ...a, ...updates, updatedAt: Date.now() } : a
          ),
        },
      };
    }

    default:
      return {};
  }
}

export function pdfReducer(state: PdfState, action: PdfAction): PdfState {
  switch (action.type) {
    case "LOAD_PDF_START":
      return { ...state, loading: true, error: null };

    case "LOAD_PDF_SUCCESS":
      return {
        ...state,
        loading: false,
        error: null,
        pdfDoc: action.payload.pdfDoc,
        pdfBytes: action.payload.pdfBytes,
        numPages: action.payload.numPages,
        pageViewports: { 1: action.payload.firstViewport },
        pageSizes: { 1: action.payload.firstPageSize },
        currentPage: 1,
      };

    case "LOAD_PDF_ERROR":
      return { ...state, loading: false, error: action.payload };

    case "UNLOAD_PDF":
      return { ...initialPdfState };

    case "SET_PAGE":
      return { ...state, currentPage: action.payload };
    
    case "SET_CURRENT_PAGE":
      return { ...state, currentPage: action.payload };

    case "NEXT_PAGE":
      return { ...state, currentPage: Math.min(state.currentPage + 1, state.numPages) };

    case "PREV_PAGE":
      return { ...state, currentPage: Math.max(state.currentPage - 1, 1) };

    case "SET_SCALE":
      return { ...state, scale: action.payload };

    case "SET_ROTATION":
      return { ...state, rotation: action.payload };

    case "SET_FIT_MODE":
      return { ...state, fitMode: action.payload };

    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.payload };

    case "SET_SELECTED_TOOL":
      return { ...state, selectedTool: action.payload };

    case "SET_THUMBNAIL_FOR_PAGE":
      return {
        ...state,
        thumbnails: { ...state.thumbnails, [action.payload.page]: action.payload.dataUrl },
      };

    case "TOGGLE_NIGHT_MODE":
      return { ...state, nightMode: !state.nightMode };

    case "SET_BACKGROUND_MODE":
      return { ...state, backgroundMode: action.payload };

    case "ADD_BOOKMARK":
      return { ...state, bookmarks: [...state.bookmarks, action.payload] };

    case "REMOVE_BOOKMARK":
      return { ...state, bookmarks: state.bookmarks.filter((p) => p !== action.payload) };

    case "SET_DIRTY_STATE":
      return { ...state, isDirty: action.payload };

    case "ADD_ANNOTATION": {
      const page = action.payload.page;
      const newState = {
        ...state,
        annotations: {
          ...state.annotations,
          [page]: [...(state.annotations[page] || []), action.payload],
        },
        isDirty: true,
        // Store the inverse action (REMOVE) in undo stack
        undoStack: [
          ...state.undoStack,
          {
            type: "REMOVE_ANNOTATION",
            payload: { page, id: action.payload.id },
          } as PdfAction,
        ],
        redoStack: [],
      };
      return newState;
    }

    case "UPDATE_ANNOTATION": {
      const { page, id, updates } = action.payload;
      // Store the previous annotation state for undo
      const previousAnnotation = state.annotations[page]?.find((a) => a.id === id);
      if (!previousAnnotation) return state;

      const newState = {
        ...state,
        annotations: {
          ...state.annotations,
          [page]: (state.annotations[page] || []).map((a) =>
            a.id === id ? { ...a, ...updates, updatedAt: Date.now() } : a
          ),
        },
        isDirty: true,
        // Push to undo stack with previous state
        undoStack: [
          ...state.undoStack,
          {
            type: "UPDATE_ANNOTATION",
            payload: {
              page,
              id,
              updates: {
                rect: previousAnnotation.rect,
                meta: previousAnnotation.meta,
              },
            },
          } as PdfAction,
        ],
        redoStack: [],
      };
      return newState;
    }

    case "REMOVE_ANNOTATION": {
      const { page, id } = action.payload;
      // Store the annotation being removed for undo
      const annotationToRemove = state.annotations[page]?.find((a) => a.id === id);
      if (!annotationToRemove) return state;

      const newState = {
        ...state,
        annotations: {
          ...state.annotations,
          [page]: (state.annotations[page] || []).filter((a) => a.id !== id),
        },
        isDirty: true,
        // Push to undo stack with the removed annotation
        undoStack: [
          ...state.undoStack,
          {
            type: "ADD_ANNOTATION",
            payload: annotationToRemove,
          } as PdfAction,
        ],
        redoStack: [],
      };
      return newState;
    }

    case "UNDO": {
      if (state.undoStack.length === 0) return state;

      const lastAction = state.undoStack[state.undoStack.length - 1];
      
      // The undo stack contains inverse actions, so we apply them forward
      const undoState = applyForward(state, lastAction);
      
      // Create the redo action (inverse of what we just undid)
      let redoAction: PdfAction;
      if (lastAction.type === "REMOVE_ANNOTATION") {
        // We're undoing an ADD (by removing), so redo should be ADD
        // We need to get the annotation that was just removed
        const { page, id } = lastAction.payload;
        // The annotation should still exist in the current state (before we apply undo)
        const annotation = state.annotations[page]?.find(a => a.id === id);
        if (annotation) {
          redoAction = {
            type: "ADD_ANNOTATION",
            payload: annotation,
          } as PdfAction;
        } else {
          // Fallback - shouldn't happen
          redoAction = lastAction;
        }
      } else if (lastAction.type === "ADD_ANNOTATION") {
        // We're undoing a REMOVE (by adding back), so redo should be REMOVE
        redoAction = {
          type: "REMOVE_ANNOTATION",
          payload: {
            page: lastAction.payload.page,
            id: lastAction.payload.id,
          },
        } as PdfAction;
      } else if (lastAction.type === "UPDATE_ANNOTATION") {
        // We're undoing an UPDATE, so redo should be UPDATE with current values
        const { page, id } = lastAction.payload;
        const currentAnnotation = state.annotations[page]?.find(a => a.id === id);
        if (currentAnnotation) {
          redoAction = {
            type: "UPDATE_ANNOTATION",
            payload: {
              page,
              id,
              updates: {
                rect: currentAnnotation.rect,
                meta: currentAnnotation.meta,
              },
            },
          } as PdfAction;
        } else {
          redoAction = lastAction;
        }
      } else {
        redoAction = lastAction;
      }

      return {
        ...state,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, redoAction],
        ...undoState,
        isDirty: true,
      };
    }

    case "REDO": {
      if (state.redoStack.length === 0) return state;

      const nextAction = state.redoStack[state.redoStack.length - 1];
      const forwardState = applyForward(state, nextAction);
      
      // Create the inverse action to store in undo stack
      let undoAction: PdfAction;
      if (nextAction.type === "ADD_ANNOTATION") {
        undoAction = {
          type: "REMOVE_ANNOTATION",
          payload: {
            page: nextAction.payload.page,
            id: nextAction.payload.id,
          },
        } as PdfAction;
      } else if (nextAction.type === "REMOVE_ANNOTATION") {
        // For redo of remove, the annotation should exist in current state
        // (because we just undid the remove, which added it back)
        // Get it from state before we apply the remove
        const { page, id } = nextAction.payload;
        const annotationToRemove = state.annotations[page]?.find(a => a.id === id);
        
        if (annotationToRemove) {
          // Store ADD action in undo stack so we can undo the redo
          undoAction = {
            type: "ADD_ANNOTATION",
            payload: annotationToRemove,
          } as PdfAction;
        } else {
          // Fallback - shouldn't happen
          undoAction = nextAction;
        }
      } else if (nextAction.type === "UPDATE_ANNOTATION") {
        // For redo of update, store the current state (before update) in undo stack
        const { page, id } = nextAction.payload;
        const currentAnnotation = state.annotations[page]?.find(a => a.id === id);
        if (currentAnnotation) {
          undoAction = {
            type: "UPDATE_ANNOTATION",
            payload: {
              page,
              id,
              updates: {
                rect: currentAnnotation.rect,
                meta: currentAnnotation.meta,
              },
            },
          } as PdfAction;
        } else {
          undoAction = nextAction;
        }
      } else {
        undoAction = nextAction;
      }

      return {
        ...state,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, undoAction],
        ...forwardState,
        isDirty: true,
      };
    }

    case "CLEAR_REDO":
      return {
        ...state,
        redoStack: [],
      };

    case "SET_SEARCH_TERM":
      return { ...state, searchTerm: action.payload, currentMatchIndex: -1 };

    case "SET_CURRENT_MATCH":
      return { ...state, currentMatchIndex: action.payload };

    case "NEXT_MATCH": {
      if (state.searchResults.length === 0) return state;
      const nextIndex = (state.currentMatchIndex + 1) % state.searchResults.length;
      const nextMatch = state.searchResults[nextIndex];
      return {
        ...state,
        currentMatchIndex: nextIndex,
        currentPage: nextMatch.page,
      };
    }

    case "PREV_MATCH": {
      if (state.searchResults.length === 0) return state;
      const prevIndex = state.currentMatchIndex <= 0 
        ? state.searchResults.length - 1 
        : state.currentMatchIndex - 1;
      const prevMatch = state.searchResults[prevIndex];
      return {
        ...state,
        currentMatchIndex: prevIndex,
        currentPage: prevMatch.page,
      };
    }

    case "SET_TOOL_COLOR": {
      return {
        ...state,
        toolColors: {
          ...state.toolColors,
          [action.payload.tool]: action.payload.color,
        },
      };
    }

    case "SET_SIGNATURE_IMAGE":
      return { ...state, signatureImage: action.payload };

    case "SET_SEARCH_QUERY":
      return {
        ...state,
        search: {
          ...state.search,
          query: action.payload,
          activeIndex: 0,
        },
      };

    case "SET_SEARCH_RESULTS":
      // Handle both old and new search results format
      // Type guard: check if it's the new format (has 'rect' property)
      if (Array.isArray(action.payload) && action.payload.length > 0 && 'rect' in action.payload[0]) {
        // New format: matches array with page and rect
        return {
          ...state,
          search: {
            ...state.search,
            matches: action.payload as PdfState["search"]["matches"],
            activeIndex: 0,
          },
        };
      } else if (Array.isArray(action.payload)) {
        // Old format: keep for backward compatibility
        return { 
          ...state, 
          searchResults: action.payload as Array<{ page: number; index: number; text: string; x: number; y: number; width: number; height: number }>, 
          currentMatchIndex: action.payload.length > 0 ? 0 : -1 
        };
      } else {
        // Fallback: empty array
        return { ...state, searchResults: [], currentMatchIndex: -1 };
      }

    case "SET_ACTIVE_SEARCH_INDEX":
      return {
        ...state,
        search: {
          ...state.search,
          activeIndex: action.payload,
        },
      };

    case "CLEAR_SEARCH":
      return {
        ...state,
        search: {
          query: "",
          matches: [],
          activeIndex: 0,
        },
      };

    case "SELECT_ANNOTATION":
      return {
        ...state,
        selectedAnnotationId: action.payload.id,
      };

    case "SET_PID_SYMBOL":
      return { ...state, pidSelectedSymbolId: action.payload };

    case "SET_PID_COLOR":
      return { ...state, pidColor: action.payload };

    case "TOGGLE_PID_PANEL":
      return { ...state, showPidPanel: !state.showPidPanel };

    case "SET_SHOW_PID_PANEL":
      return { ...state, showPidPanel: action.payload };

    default:
      return state;
  }
}
