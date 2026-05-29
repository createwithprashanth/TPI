// src/context/pdf/PdfState.ts
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import type { PdfAction } from "./PdfActions";

export type ToolName =
  | "pan"
  | "select"
  | "highlight"
  | "draw"
  | "shape-rect"
  | "shape-circle"
  | "textbox"
  | "signature"
  | "erase"
  | "arrow"
  | "pid-symbol"
  | "stamp"
  | "measure"
  | "form-text"
  | "form-checkbox"
  | "form-date"
  | "form-signature";

export interface Annotation {
  id: string;
  type: string;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  meta?: any;
  createdAt: number;
  updatedAt: number;
  
}

export type FitMode = "custom" | "fit-width" | "fit-page";

export interface PdfState {
  pdfBytes: ArrayBuffer | null;
  pdfDoc: PDFDocumentProxy | null;
  numPages: number;

  currentPage: number;
  scale: number;
  rotation: number;

  viewMode: "single" | "continuous";
  fitMode: FitMode;

  loading: boolean;
  error: string | null;

  pageViewports: Record<number, PageViewport>;
  pageSizes: Record<number, { width: number; height: number }>;

  selectedTool: ToolName;
  thumbnails: Record<number, string>;
  bookmarks: number[];
  backgroundMode: "white" | "light" | "dark";
  nightMode: boolean;

  isDirty: boolean;

  selectedAnnotationId: string | null;
  annotations: Record<number, Annotation[]>;

  search:{
    query:string;
    matches:{
      page:number;
      rect:{
        x:number;
        y:number;
        width:number;
        height:number;
      }[];
    }[];
    activeIndex:number;
  };

  // Search state
  searchTerm: string;
  searchResults: Array<{ page: number; index: number; text: string; x: number; y: number; width: number; height: number }>;
  currentMatchIndex: number;

  // Tool colors
  toolColors: Record<ToolName, string>;

  // Signature image (base64 data URL)
  signatureImage: string | null;
  undoStack:PdfAction[];
  redoStack:PdfAction[];

  // P&ID markup state
  pidSelectedSymbolId: string | null;
  pidColor: string;
  showPidPanel: boolean;

  // Editor tools
  stampText: string;
  measureUnit: string;
  measureScale: number;
}

export const initialPdfState: PdfState = {

  undoStack:[],
  redoStack:[],
  pdfBytes: null,
  pdfDoc: null,
  numPages: 0,

  currentPage: 1,
  scale: 1.0,
  rotation: 0,

  viewMode: "single",
  fitMode: 'custom',

  loading: false,
  error: null,

  pageViewports: {},
  pageSizes: {},

  search:{
    query:"",
    matches:[],
    activeIndex:0,
  },

  selectedTool: "select",
  thumbnails: {},
  bookmarks: [],
  backgroundMode: "white",
  nightMode: false,

  isDirty: false,

  annotations: {},

  // Search state
  searchTerm: "",
  searchResults: [],
  currentMatchIndex: -1,

  // Tool colors - default colors for each tool
  toolColors: {
    pan: "#000000",
    select: "#000000",
    highlight: "#ffff00",
    draw: "#7c3aed",
    "shape-rect": "#ef4444",
    "shape-circle": "#3b82f6",
    arrow: "#10b981",
    textbox: "#000000",
    signature: "#000000",
    erase: "#000000",
    "pid-symbol": "#ef4444",
    stamp: "#d16969",
    measure: "#4ec9b0",
    "form-text": "#3794ff",
    "form-checkbox": "#3794ff",
    "form-date": "#3794ff",
    "form-signature": "#c586c0",
  },
  selectedAnnotationId: null,
  // Signature image
  signatureImage: null,

  // P&ID markup
  pidSelectedSymbolId: null,
  pidColor: "#ef4444",
  showPidPanel: false,

  // Editor tools
  stampText: "APPROVED",
  measureUnit: "m",
  measureScale: 1,
};
