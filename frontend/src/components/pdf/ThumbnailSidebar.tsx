import { useEffect, useState } from "react";
import { Bookmark, Download, FilePlus, FileText, GripVertical, RotateCw, Trash2 } from "lucide-react";
import { degrees, PDFDocument } from "pdf-lib";
import { usePdfContext } from "./context/PdfContext";
import type { Annotation } from "./context/PdfState";

function bytesToArrayBuffer(bytes: Uint8Array) {
  const arrayBuffer = new ArrayBuffer(bytes.length);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

function remapAnnotationsByOrder(
  annotations: Record<number, Annotation[]>,
  order: number[],
): Record<number, Annotation[]> {
  return order.reduce<Record<number, Annotation[]>>((next, oldPage, index) => {
    const list = annotations[oldPage] ?? [];
    if (list.length > 0) {
      next[index + 1] = list.map((annotation) => ({ ...annotation, page: index + 1 }));
    }
    return next;
  }, {});
}

function remapBookmarksByOrder(bookmarks: number[], order: number[]) {
  return order
    .map((oldPage, index) => bookmarks.includes(oldPage) ? index + 1 : null)
    .filter((page): page is number => page !== null);
}

export default function ThumbnailSidebar() {
  const { pdfDoc, numPages, currentPage, annotations, bookmarks, pdfBytes, dispatch, loadPdf } = usePdfContext();
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [dragPage, setDragPage] = useState<number | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const reloadEditedPdf = async (
    bytes: Uint8Array,
    nextAnnotations: Record<number, Annotation[]>,
    nextBookmarks: number[],
    nextPage: number,
  ) => {
    setThumbs({});
    await loadPdf(bytesToArrayBuffer(bytes));
    dispatch({
      type: "IMPORT_REVIEW_SESSION",
      payload: {
        annotations: nextAnnotations,
        bookmarks: nextBookmarks,
        currentPage: nextPage,
      },
    });
  };

  const extractPage = async (pageNumber: number) => {
    if (!pdfBytes) return;
    try {
      const source = await PDFDocument.load(pdfBytes.slice(0));
      const target = await PDFDocument.create();
      const [page] = await target.copyPages(source, [pageNumber - 1]);
      target.addPage(page);
      const bytes = await target.save();
      const blob = new Blob([bytesToArrayBuffer(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `page-${pageNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to extract page:", error);
    }
  };

  const reorderPage = async (fromPage: number, toPage: number) => {
    if (!pdfBytes || fromPage === toPage) return;
    setIsApplying(true);
    try {
      const order = Array.from({ length: numPages }, (_, index) => index + 1);
      const [moved] = order.splice(fromPage - 1, 1);
      order.splice(toPage - 1, 0, moved);

      const source = await PDFDocument.load(pdfBytes.slice(0));
      const target = await PDFDocument.create();
      const copiedPages = await target.copyPages(source, order.map((page) => page - 1));
      copiedPages.forEach((page) => target.addPage(page));

      await reloadEditedPdf(
        await target.save(),
        remapAnnotationsByOrder(annotations, order),
        remapBookmarksByOrder(bookmarks, order),
        toPage,
      );
    } catch (error) {
      console.error("Failed to reorder page:", error);
    } finally {
      setIsApplying(false);
      setDragPage(null);
    }
  };

  const deletePage = async (pageNumber: number) => {
    if (!pdfBytes || numPages <= 1) return;
    const confirmed = window.confirm(`Delete page ${pageNumber}?`);
    if (!confirmed) return;

    setIsApplying(true);
    try {
      const order = Array.from({ length: numPages }, (_, index) => index + 1).filter((page) => page !== pageNumber);
      const source = await PDFDocument.load(pdfBytes.slice(0));
      const target = await PDFDocument.create();
      const copiedPages = await target.copyPages(source, order.map((page) => page - 1));
      copiedPages.forEach((page) => target.addPage(page));

      await reloadEditedPdf(
        await target.save(),
        remapAnnotationsByOrder(annotations, order),
        remapBookmarksByOrder(bookmarks, order),
        Math.min(pageNumber, order.length),
      );
    } catch (error) {
      console.error("Failed to delete page:", error);
    } finally {
      setIsApplying(false);
    }
  };

  const rotatePage = async (pageNumber: number) => {
    if (!pdfBytes) return;
    setIsApplying(true);
    try {
      const doc = await PDFDocument.load(pdfBytes.slice(0));
      const page = doc.getPage(pageNumber - 1);
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees((currentRotation + 90) % 360));
      await reloadEditedPdf(await doc.save(), annotations, bookmarks, pageNumber);
    } catch (error) {
      console.error("Failed to rotate page:", error);
    } finally {
      setIsApplying(false);
    }
  };

  const insertBlankPage = async (pageNumber: number, placement: "before" | "after") => {
    if (!pdfBytes) return;
    setIsApplying(true);
    try {
      const source = await PDFDocument.load(pdfBytes.slice(0));
      const target = await PDFDocument.create();
      const insertAt = placement === "before" ? pageNumber : pageNumber + 1;
      const sourcePages = source.getPages();
      const selectedSize = sourcePages[pageNumber - 1]?.getSize() ?? { width: 612, height: 792 };
      const copiedPages = await target.copyPages(source, sourcePages.map((_, index) => index));

      for (let index = 1; index <= numPages; index += 1) {
        if (insertAt === index) target.addPage([selectedSize.width, selectedSize.height]);
        target.addPage(copiedPages[index - 1]);
      }
      if (insertAt === numPages + 1) {
        target.addPage([selectedSize.width, selectedSize.height]);
      }

      const nextAnnotations: Record<number, Annotation[]> = {};
      for (const [page, list] of Object.entries(annotations)) {
        const pageNumberValue = Number(page);
        const nextPage = pageNumberValue >= insertAt ? pageNumberValue + 1 : pageNumberValue;
        nextAnnotations[nextPage] = list.map((annotation) => ({ ...annotation, page: nextPage }));
      }
      const nextBookmarks = bookmarks.map((bookmark) => bookmark >= insertAt ? bookmark + 1 : bookmark);

      await reloadEditedPdf(await target.save(), nextAnnotations, nextBookmarks, insertAt);
    } catch (error) {
      console.error("Failed to insert blank page:", error);
    } finally {
      setIsApplying(false);
    }
  };

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
    <div className="space-y-3 p-3">
      <div className="sticky top-0 z-10 -mx-3 -mt-3 border-b border-[#2b2b2b] bg-[#181818] px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#858585]">Page Manager</div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-[#858585]">
          <FileText className="h-3.5 w-3.5" />
          <span>{numPages} pages</span>
        </div>
      </div>
      {numPages === 0 && <div className="py-4 text-center text-xs text-[#858585]">No pages</div>}
      {Array.from({ length: numPages }).map((_, idx) => {
        const p = idx + 1;
        return (
          <div
            key={p}
            className="group cursor-pointer"
            draggable={!isApplying}
            onDragStart={() => setDragPage(p)}
            onDragOver={(event) => {
              if (dragPage && dragPage !== p) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragPage) void reorderPage(dragPage, p);
            }}
            onDragEnd={() => setDragPage(null)}
            onClick={() => dispatch({ type: "SET_PAGE", payload: p })}
          >
            <div className={`w-full overflow-hidden rounded-[3px] border bg-[#1e1e1e] transition-colors hover:border-[#3794ff]/60 hover:bg-[#252526] ${
              currentPage === p ? "border-[#3794ff]" : "border-[#2b2b2b]"
            }`}>
              {thumbs[p] ? (
                <img src={thumbs[p]} alt={`Page ${p}`} className="block w-full" />
              ) : (
                <div className="flex h-28 items-center justify-center text-xs text-[#858585]">Loading…</div>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-1 text-[11px] font-medium text-[#858585]">
              <span className="inline-flex items-center gap-1">
                <GripVertical className="h-3 w-3" />
                Pg {p}
              </span>
              <span>{annotations[p]?.length ?? 0} marks</span>
            </div>
            <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white"
                title={bookmarks.includes(p) ? "Remove bookmark" : "Bookmark page"}
                aria-label={bookmarks.includes(p) ? "Remove bookmark" : "Bookmark page"}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatch({ type: bookmarks.includes(p) ? "REMOVE_BOOKMARK" : "ADD_BOOKMARK", payload: p });
                }}
              >
                <Bookmark className={`h-3.5 w-3.5 ${bookmarks.includes(p) ? "fill-[#cca700] text-[#cca700]" : ""}`} />
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="Rotate page"
                aria-label="Rotate page"
                disabled={!pdfBytes || isApplying}
                onClick={(event) => {
                  event.stopPropagation();
                  void rotatePage(p);
                }}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="Insert blank page before"
                aria-label="Insert blank page before"
                disabled={!pdfBytes || isApplying}
                onClick={(event) => {
                  event.stopPropagation();
                  void insertBlankPage(p, "before");
                }}
              >
                <FilePlus className="h-3.5 w-3.5 rotate-180" />
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="Insert blank page after"
                aria-label="Insert blank page after"
                disabled={!pdfBytes || isApplying}
                onClick={(event) => {
                  event.stopPropagation();
                  void insertBlankPage(p, "after");
                }}
              >
                <FilePlus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="Extract page"
                aria-label="Extract page"
                disabled={!pdfBytes}
                onClick={(event) => {
                  event.stopPropagation();
                  void extractPage(p);
                }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-[#f48771] hover:bg-[#5a1d1d] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title="Delete page"
                aria-label="Delete page"
                disabled={!pdfBytes || isApplying || numPages <= 1}
                onClick={(event) => {
                  event.stopPropagation();
                  void deletePage(p);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
