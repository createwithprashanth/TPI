import { usePdfContext } from "./context/PdfContext";
import PdfPage from "./PdfPage";

export default function PdfRenderer({ onPointerMove }: { onPointerMove?: (pt: { x: number; y: number }) => void }) {
  const { pdfDoc, numPages, currentPage, viewMode } = usePdfContext();

  if (!pdfDoc) {
    return (
      <div className="flex justify-center items-center h-full text-gray-500">
        No PDF Loaded
      </div>
    );
  }

  // Single Page Mode
  if (viewMode === "single") {
    return (
      <div className="flex justify-center">
        <PdfPage pageNumber={currentPage} onPointerMove={onPointerMove} />
      </div>
    );
  }

  // Continuous Mode
  const pages = [];
  for (let i = 1; i <= numPages; i++) {
    pages.push(<PdfPage key={i} pageNumber={i} onPointerMove={onPointerMove} />);
  }

  return <div>{pages}</div>;
}
