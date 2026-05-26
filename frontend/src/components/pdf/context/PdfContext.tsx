// src/components/pdf/context/PdfContext.tsx

import React, { createContext, useContext, useReducer, useCallback } from "react";
import { initialPdfState } from "./PdfState";
import type { PdfState } from "./PdfState";
import type { PdfAction } from "./PdfActions";
import { pdfReducer } from "./PdfReducer";

import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";

// Worker configuration (correct for pdfjs-dist v5)
if (!GlobalWorkerOptions.workerSrc || GlobalWorkerOptions.workerSrc === '') {
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

// Verify worker is accessible (only in browser)
if (typeof window !== 'undefined') {
  // Use requestIdleCallback or setTimeout to avoid blocking initial load
  const checkWorker = () => {
    const workerUrl = GlobalWorkerOptions.workerSrc;
    fetch(workerUrl, { method: 'HEAD', cache: 'no-cache' })
      .then(() => console.log('PDF.js worker found at:', workerUrl))
      .catch(() => console.warn('PDF.js worker not found at:', workerUrl, '- PDF loading may fail'));
  };
  
  if ('requestIdleCallback' in window) {
    requestIdleCallback(checkWorker, { timeout: 1000 });
  } else {
    setTimeout(checkWorker, 100);
  }
}

export interface PdfContextType extends PdfState {
  dispatch: React.Dispatch<PdfAction>;
  loadPdf: (bytes: ArrayBuffer) => Promise<void>;
}

const PdfContext = createContext<PdfContextType | null>(null);

export function PdfProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(pdfReducer, initialPdfState);

  const loadPdf = useCallback(async (bytes: ArrayBuffer) => {
    try {
      dispatch({ type: "LOAD_PDF_START" });

      // Clone the buffer before passing to pdf.js to prevent detachment issues
      // pdf.js may transfer/detach the buffer, so we keep a copy for saving later
      let clonedBytes: ArrayBuffer;
      try {
        clonedBytes = bytes.slice(0);
      } catch (e) {
        // If slice fails (detached buffer), create a new buffer and copy
        const sourceView = new Uint8Array(bytes);
        const newBuffer = new ArrayBuffer(sourceView.length);
        const newView = new Uint8Array(newBuffer);
        newView.set(sourceView);
        clonedBytes = newBuffer;
      }

      // Add timeout to prevent infinite hangs (30 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('PDF loading timeout: The PDF took too long to load')), 30000);
      });

      // Use Promise.race to add timeout protection
      const task = getDocument({ 
        data: bytes, // Use original bytes for pdf.js
        // Optimize for performance
        useSystemFonts: false,
        disableAutoFetch: false,
        disableStream: false,
      });
      
      const pdfDoc = await Promise.race([
        task.promise,
        timeoutPromise
      ]) as PDFDocumentProxy;

      // Use setTimeout to yield to the browser and prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));

      const firstPage = await pdfDoc.getPage(1);
      
      // Yield again after getting the page
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const firstViewport = firstPage.getViewport({ scale: 1 });
      const firstSize = {
        width: firstViewport.width,
        height: firstViewport.height,
      };

      dispatch({
        type: "LOAD_PDF_SUCCESS",
        payload: {
          pdfDoc,
          pdfBytes: clonedBytes, // Store the cloned buffer, not the original
          numPages: pdfDoc.numPages,
          firstViewport,
          firstPageSize: firstSize,
        },
      });
    } catch (err: any) {
      console.error('PDF loading error:', err);
      dispatch({ type: "LOAD_PDF_ERROR", payload: err.message || 'Failed to load PDF' });
    }
  }, [dispatch]);

  return (
    <PdfContext.Provider value={{ ...state, dispatch, loadPdf }}>
      {children}
    </PdfContext.Provider>
  );
}

export function usePdfContext() {
  const ctx = useContext(PdfContext);
  if (!ctx) {
    throw new Error("usePdfContext must be used inside <PdfProvider>");
  }
  return ctx;
}
