import React, { useState, useEffect, useRef } from 'react';
import { PdfProvider, usePdfContext } from '../components/pdf/context/PdfContext';
import ViewerContainer from '../components/pdf/ViewerContainer';

// Inner component that uses PDF context
function PrecisionPDFViewer({ 
  selectedPdfFile, 
  onClose 
}: { 
  selectedPdfFile: File; 
  onClose: () => void;
}) {
  const { loadPdf, dispatch, pdfDoc, loading, error: pdfError } = usePdfContext();
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const loadingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedPdfFile) return;
    
    // Create a unique identifier for this file
    const fileId = `${selectedPdfFile.name}-${selectedPdfFile.size}-${selectedPdfFile.lastModified}`;
    
    // Prevent loading the same file multiple times
    if (loadingRef.current === fileId) {
      return;
    }
    
    loadingRef.current = fileId;
    setFileLoading(true);
    setFileError(null);
    
    // Clear previous PDF first
    dispatch({ type: "UNLOAD_PDF" });
    
    // Use setTimeout to ensure this doesn't block the initial render
    const loadTimeout = setTimeout(() => {
        const reader = new FileReader();
        
        // Add timeout for file reading (10 seconds)
        const fileReadTimeout = setTimeout(() => {
          if (reader.readyState !== FileReader.DONE) {
            reader.abort();
            setFileError('File reading timeout: The file is too large or corrupted');
            setFileLoading(false);
          }
        }, 10000);
        
        reader.onload = async (e) => {
          clearTimeout(fileReadTimeout);
          try {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            if (arrayBuffer && arrayBuffer.byteLength > 0) {
              // Yield to browser before loading PDF
              await new Promise(resolve => setTimeout(resolve, 0));
              await loadPdf(arrayBuffer);
              // Don't set fileLoading to false here - let the context loading state handle it
            } else {
              console.error('No data received from file');
              setFileError('Failed to read file: No data received');
              setFileLoading(false);
            }
          } catch (err: any) {
            console.error('Error loading PDF:', err);
            setFileError(err.message || 'Failed to load PDF');
            setFileLoading(false);
          }
        };
        
        reader.onerror = (e) => {
          clearTimeout(fileReadTimeout);
          console.error('FileReader error:', e);
          setFileError('Failed to read PDF file');
          setFileLoading(false);
        };
        
        
        reader.readAsArrayBuffer(selectedPdfFile);
      }, 100);

      return () => {
        clearTimeout(loadTimeout);
        loadingRef.current = null;
      };
  }, [selectedPdfFile?.name, selectedPdfFile?.size, selectedPdfFile?.lastModified, loadPdf, dispatch]);

  // Update fileLoading based on context loading state
  useEffect(() => {
    if (pdfDoc && !loading) {
      setFileLoading(false);
      loadingRef.current = null;
    }
  }, [pdfDoc, loading]);

  // Show loading or error state
  if (fileLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900">
        <div className="rounded-3xl border border-slate-700 bg-slate-950/80 px-8 py-10 text-center shadow-2xl">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-brand-primary" />
          <p className="text-sm font-medium text-slate-100">Loading PDF workspace...</p>
          <p className="mt-2 text-xs text-slate-400">{selectedPdfFile.name}</p>
        </div>
      </div>
    );
  }

  if (fileError || pdfError) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900">
        <div className="max-w-md rounded-3xl border border-red-500/30 bg-slate-950 px-8 py-10 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <svg className="h-8 w-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-white">Error loading PDF</h3>
          <p className="mb-4 text-sm text-red-300">{fileError || pdfError}</p>
          <button
            onClick={onClose}
            className="rounded-[3px] bg-[#0e639c] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#1177bb]"
          >
            Back to Files
          </button>
        </div>
      </div>
    );
  }

  // If PDF is loaded, show the viewer
  if (pdfDoc) {
    return <ViewerContainer />;
  }

  // If no PDF is loaded yet, show waiting state
  return (
    <div className="flex h-full items-center justify-center bg-slate-900">
      <div className="max-w-md rounded-3xl border border-slate-700 bg-slate-950/80 px-8 py-10 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-slate-800">
          <svg className="h-10 w-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-white">Preparing workspace...</h3>
        <p className="text-sm text-slate-400">{selectedPdfFile.name}</p>
      </div>
    </div>
  );
}

const PrecisionPDFPage: React.FC = () => {
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // PrecisionPDF should always open as an empty editor shell.
  useEffect(() => {
    setPdfFiles([]);
    setSelectedPdfFile(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Handlers
  const handlePdfFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      const pdfFilesOnly = files.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
      if (pdfFilesOnly.length === 0) {
        setError("Please select valid PDF files.");
        return;
      }
      setPdfFiles(pdfFilesOnly);
      setSelectedPdfFile(pdfFilesOnly[0]);
      setError(null);
    }
  };

  return (
    <PdfProvider>
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0f172a]">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={handlePdfFileChange}
        />

        <div className="flex-1 overflow-hidden bg-slate-900">
          {selectedPdfFile ? (
            <PrecisionPDFViewer
              key={selectedPdfFile.name + selectedPdfFile.size + selectedPdfFile.lastModified}
              selectedPdfFile={selectedPdfFile}
              onClose={() => setSelectedPdfFile(null)}
            />
          ) : (
            <ViewerContainer onOpenFile={() => fileInputRef.current?.click()} />
          )}
        </div>

        {error && (
          <div className="absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 border border-[#5a1d1d] bg-[#252526] px-3 py-2 shadow-2xl">
            <span className="text-xs text-[#f48771]">{error}</span>
            <button
              onClick={() => setError(null)}
              className="rounded-[3px] p-1 text-[#f48771] transition-colors hover:bg-[#5a1d1d] hover:text-white"
              aria-label="Dismiss error"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </PdfProvider>
  );
};

export default PrecisionPDFPage;
