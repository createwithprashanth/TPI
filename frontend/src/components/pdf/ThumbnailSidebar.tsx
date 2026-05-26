import { useEffect, useState } from "react";
import { usePdfContext } from "./context/PdfContext";

export default function ThumbnailSidebar() {
  const { pdfDoc, numPages, dispatch } = usePdfContext();
  const [thumbs, setThumbs] = useState<Record<number, string>>({});

  useEffect(() => {
    let mounted = true;
    if (!pdfDoc) return;

    const makeThumb = async (pageNum: number) => {
      try {
        // Yield to browser to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 0));
        
        if (!mounted) return;
        
        const page = await pdfDoc.getPage(pageNum);
        
        // Yield again after getting page
        await new Promise(resolve => setTimeout(resolve, 0));
        
        if (!mounted) return;
        
        // Increase scale to render a larger thumbnail preview
        const viewport = page.getViewport({ scale: 0.3 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        // Yield before rendering
        await new Promise(resolve => setTimeout(resolve, 0));
        
        if (!mounted) return;
        
        const renderTask = page.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
        
        // Yield after rendering
        await new Promise(resolve => setTimeout(resolve, 0));
        
        if (!mounted) return;
        
        const dataUrl = canvas.toDataURL("image/png");
        setThumbs(t => ({ ...t, [pageNum]: dataUrl }));
        dispatch({ type: "SET_THUMBNAIL_FOR_PAGE", payload: { page: pageNum, dataUrl } });
      } catch (err) {
        console.error(`Error generating thumbnail for page ${pageNum}:`, err);
      }
    };

    // Generate thumbnails one at a time with delays to prevent blocking
    const generateThumbnails = async () => {
      for (let i = 1; i <= numPages; i++) {
        if (!mounted) break;
        if (!thumbs[i]) {
          await makeThumb(i);
          // Small delay between thumbnails to keep UI responsive
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    };

    // Use requestIdleCallback if available, otherwise setTimeout
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        generateThumbnails();
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
        generateThumbnails();
      }, 100);
    }

    return () => { mounted = false; };
  }, [pdfDoc, numPages]);

  return (
    <div className="space-y-4 p-4">
      <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-slate-700 bg-slate-950/95 px-4 py-3 backdrop-blur-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pages</div>
      </div>
      {numPages === 0 && <div className="py-4 text-center text-xs text-slate-500">No pages</div>}
      {Array.from({ length: numPages }).map((_, idx) => {
        const p = idx + 1;
        return (
          <div
            key={p}
            className="cursor-pointer"
            onClick={() => dispatch({ type: "SET_PAGE", payload: p })}
          >
            <div className="w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-sm transition-all duration-200 hover:border-brand-primary/40 hover:bg-slate-800">
              {thumbs[p] ? (
                <img src={thumbs[p]} alt={`Page ${p}`} className="block w-full" />
              ) : (
                <div className="h-28 flex items-center justify-center text-xs text-gray-400">Loading…</div>
              )}
            </div>
            <div className="mt-2 text-center text-xs font-medium text-slate-400">Pg {p}</div>
          </div>
        );
      })}
    </div>
  );
}
