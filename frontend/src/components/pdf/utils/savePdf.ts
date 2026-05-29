import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Annotation } from "../context/PdfState";
import { findSymbol } from "../pid/ISASymbols";

// Helper to convert hex color to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}

export async function saveAnnotatedPdf(
  originalPdfBytes: ArrayBuffer,
  annotations: Record<number, Annotation[]>
): Promise<Uint8Array> {
  try {
    // The buffer should already be cloned before being passed here
    // But we'll use it directly since it's guaranteed to be a valid, non-detached buffer
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();

    // If no annotations, just return the original PDF
    if (!annotations || Object.keys(annotations).length === 0) {
      return await pdfDoc.save();
    }

    // Embed standard font once for text rendering
    let helveticaFont: any = null;
    const needsFont = Object.values(annotations).some(pageAnns =>
      pageAnns?.some(ann =>
        ann.type === "textbox" ||
        ann.type === "stamp" ||
        ann.type === "measure" ||
        ann.type.startsWith("form-") ||
        (ann.type === "pid-symbol" && ann.meta?.label)
      )
    );
    
    if (needsFont) {
      try {
        helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      } catch (fontError) {
        console.warn('Failed to embed font, textboxes may not render:', fontError);
      }
    }

    for (const [pageIndexStr, pageAnnotations] of Object.entries(annotations)) {
      const pageIndex = Number(pageIndexStr) - 1; // 1-based → 0-based
      
      // Validate page index
      if (pageIndex < 0 || pageIndex >= pages.length) {
        console.warn(`Invalid page index: ${pageIndexStr} (0-based: ${pageIndex})`);
        continue;
      }

      const page = pages[pageIndex];
      if (!page) {
        console.warn(`Page ${pageIndex} not found`);
        continue;
      }

      const { width, height } = page.getSize();

      // Validate pageAnnotations is an array
      if (!Array.isArray(pageAnnotations)) {
        console.warn(`Invalid annotations for page ${pageIndexStr}: not an array`);
        continue;
      }

      for (const ann of pageAnnotations) {
        if (!ann || !ann.type || !ann.rect) {
          console.warn('Skipping invalid annotation:', ann);
          continue;
        }

        try {
          const x = ann.rect.x * width;
          const y = height - (ann.rect.y + ann.rect.height) * height;
          const w = ann.rect.width * width;
          const h = ann.rect.height * height;

          // Validate coordinates
          if (isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) {
            console.warn('Skipping annotation with invalid coordinates:', ann);
            continue;
          }

          switch (ann.type) {
        case "highlight": {
          const color = hexToRgb(ann.meta?.color || "#ffff00");
          page.drawRectangle({
            x,
            y,
            width: w,
            height: h,
            color: rgb(color.r, color.g, color.b),
            opacity: 0.4,
          });
          break;
        }

        case "shape-rect": {
          const color = hexToRgb(ann.meta?.color || "#ef4444");
          page.drawRectangle({
            x,
            y,
            width: w,
            height: h,
            borderWidth: ann.meta?.strokeWidth ?? 2,
            borderColor: rgb(color.r, color.g, color.b),
          });
          break;
        }

        case "shape-circle": {
          const color = hexToRgb(ann.meta?.color || "#3b82f6");
          page.drawEllipse({
            x: x + w / 2,
            y: y + h / 2,
            xScale: w / 2,
            yScale: h / 2,
            borderColor: rgb(color.r, color.g, color.b),
            borderWidth: ann.meta?.strokeWidth ?? 2,
          });
          break;
        }

        case "arrow": {
          const color = hexToRgb(ann.meta?.color || "#10b981");
          const startX = x;
          const startY = y + h;
          const endX = x + w;
          const endY = y;
          
          // Draw arrow line
          page.drawLine({
            start: { x: startX, y: startY },
            end: { x: endX, y: endY },
            thickness: ann.meta?.strokeWidth ?? 2,
            color: rgb(color.r, color.g, color.b),
          });
          
          // Draw arrowhead using lines (simple triangle)
          const angle = Math.atan2(endY - startY, endX - startX);
          const arrowheadSize = 10;
          const arrowheadAngle1 = angle + Math.PI - Math.PI / 6;
          const arrowheadAngle2 = angle + Math.PI + Math.PI / 6;
          
          page.drawLine({
            start: { x: endX, y: endY },
            end: {
              x: endX + Math.cos(arrowheadAngle1) * arrowheadSize,
              y: endY + Math.sin(arrowheadAngle1) * arrowheadSize,
            },
            thickness: ann.meta?.strokeWidth ?? 2,
            color: rgb(color.r, color.g, color.b),
          });
          
          page.drawLine({
            start: { x: endX, y: endY },
            end: {
              x: endX + Math.cos(arrowheadAngle2) * arrowheadSize,
              y: endY + Math.sin(arrowheadAngle2) * arrowheadSize,
            },
            thickness: ann.meta?.strokeWidth ?? 2,
            color: rgb(color.r, color.g, color.b),
          });
          break;
        }

        case "textbox": {
          const text = ann.meta?.text || "";
          if (!text) break;
          try {
            const color = hexToRgb(ann.meta?.color || "#000000");
            const fontSize = ann.meta?.fontSize || 14;
            
            page.drawText(text, {
              x,
              y: y + h - fontSize,
              size: fontSize,
              color: rgb(color.r, color.g, color.b),
              font: helveticaFont || undefined, // Use embedded font if available
            });
          } catch (textError) {
            console.warn('Failed to draw textbox:', textError);
          }
          break;
        }

        case "stamp": {
          const color = hexToRgb(ann.meta?.color || "#d16969");
          const text = String(ann.meta?.text || "APPROVED").toUpperCase();
          page.drawRectangle({
            x,
            y,
            width: w,
            height: h,
            borderWidth: ann.meta?.strokeWidth ?? 2,
            borderColor: rgb(color.r, color.g, color.b),
            opacity: ann.meta?.opacity ?? 0.92,
          });
          if (helveticaFont) {
            const fontSize = Math.max(8, Math.min(18, h * 0.42));
            page.drawText(text, {
              x: x + 8,
              y: y + h / 2 - fontSize / 2,
              size: fontSize,
              color: rgb(color.r, color.g, color.b),
              font: helveticaFont,
            });
          }
          break;
        }

        case "measure": {
          const color = hexToRgb(ann.meta?.color || "#4ec9b0");
          const startX = ann.rect.x * width;
          const startY = height - ann.rect.y * height;
          const endX = (ann.rect.x + ann.rect.width) * width;
          const endY = height - (ann.rect.y + ann.rect.height) * height;
          const thickness = ann.meta?.strokeWidth ?? 2;

          page.drawLine({
            start: { x: startX, y: startY },
            end: { x: endX, y: endY },
            thickness,
            color: rgb(color.r, color.g, color.b),
          });

          page.drawLine({
            start: { x: startX, y: startY - 5 },
            end: { x: startX, y: startY + 5 },
            thickness,
            color: rgb(color.r, color.g, color.b),
          });
          page.drawLine({
            start: { x: endX, y: endY - 5 },
            end: { x: endX, y: endY + 5 },
            thickness,
            color: rgb(color.r, color.g, color.b),
          });

          if (helveticaFont) {
            const label = ann.meta?.label || `${Number(ann.meta?.value ?? 0).toFixed(2)} ${ann.meta?.unit || "m"}`;
            page.drawText(label, {
              x: (startX + endX) / 2 - label.length * 2.5,
              y: (startY + endY) / 2 + 8,
              size: 9,
              color: rgb(color.r, color.g, color.b),
              font: helveticaFont,
            });
          }
          break;
        }

        case "form-text":
        case "form-date": {
          const borderColor = hexToRgb(ann.meta?.borderColor || "#3794ff");
          const textColor = hexToRgb(ann.meta?.color || "#111827");
          const value = String(ann.meta?.value || "");
          const fontSize = ann.meta?.fontSize || 12;

          page.drawRectangle({
            x,
            y,
            width: w,
            height: h,
            borderWidth: 1,
            borderColor: rgb(borderColor.r, borderColor.g, borderColor.b),
          });

          if (value && helveticaFont) {
            page.drawText(value, {
              x: x + 4,
              y: y + h / 2 - fontSize / 2 + 2,
              size: fontSize,
              color: rgb(textColor.r, textColor.g, textColor.b),
              font: helveticaFont,
            });
          }
          break;
        }

        case "form-checkbox": {
          const borderColor = hexToRgb(ann.meta?.borderColor || "#3794ff");
          const size = Math.min(w, h);
          page.drawRectangle({
            x,
            y,
            width: size,
            height: size,
            borderWidth: 1.5,
            borderColor: rgb(borderColor.r, borderColor.g, borderColor.b),
          });

          if (ann.meta?.checked) {
            page.drawLine({
              start: { x: x + size * 0.22, y: y + size * 0.52 },
              end: { x: x + size * 0.42, y: y + size * 0.28 },
              thickness: 2,
              color: rgb(borderColor.r, borderColor.g, borderColor.b),
            });
            page.drawLine({
              start: { x: x + size * 0.42, y: y + size * 0.28 },
              end: { x: x + size * 0.8, y: y + size * 0.78 },
              thickness: 2,
              color: rgb(borderColor.r, borderColor.g, borderColor.b),
            });
          }
          break;
        }

        case "form-signature": {
          const borderColor = hexToRgb(ann.meta?.borderColor || "#c586c0");
          const value = String(ann.meta?.value || ann.meta?.label || "Signature");
          page.drawRectangle({
            x,
            y,
            width: w,
            height: h,
            borderWidth: 1,
            borderColor: rgb(borderColor.r, borderColor.g, borderColor.b),
          });
          page.drawLine({
            start: { x: x + 8, y: y + 12 },
            end: { x: x + w - 8, y: y + 12 },
            thickness: 1,
            color: rgb(borderColor.r, borderColor.g, borderColor.b),
          });
          if (helveticaFont) {
            page.drawText(value, {
              x: x + 10,
              y: y + 16,
              size: ann.meta?.fontSize || 10,
              color: rgb(borderColor.r, borderColor.g, borderColor.b),
              font: helveticaFont,
            });
          }
          break;
        }

        case "draw": {
          if (!ann.meta?.points || ann.meta.points.length < 2) break;
          const color = hexToRgb(ann.meta?.color || "#7c3aed");
          const points = ann.meta.points as { x: number; y: number }[];
          
          // Convert normalized points to absolute coordinates
          const absPoints = points.map(p => ({
            x: x + p.x * w,
            y: y + (1 - p.y) * h, // Flip Y coordinate
          }));

          // Draw polyline
          for (let i = 0; i < absPoints.length - 1; i++) {
            page.drawLine({
              start: absPoints[i],
              end: absPoints[i + 1],
              thickness: ann.meta?.strokeWidth ?? 2,
              color: rgb(color.r, color.g, color.b),
            });
          }
          break;
        }

        case "signature": {
          if (!ann.meta?.imageData) break;
          try {
            // Convert base64 data URL to image
            const imageData = ann.meta.imageData;
            const base64Data = imageData.split(',')[1] || imageData;
            const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
            
            // Try to detect image format and embed accordingly
            let image;
            // Check if it's PNG (starts with PNG signature) or JPEG
            if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
              // PNG
              image = await pdfDoc.embedPng(imageBytes);
            } else if (imageBytes[0] === 0xFF && imageBytes[1] === 0xD8) {
              // JPEG
              image = await pdfDoc.embedJpg(imageBytes);
            } else {
              // Default to PNG
              image = await pdfDoc.embedPng(imageBytes);
            }
            
            page.drawImage(image, {
              x,
              y,
              width: w,
              height: h,
            });
          } catch (err) {
            console.warn('Failed to embed signature image:', err);
            // Continue without signature if embedding fails
          }
          break;
        }

        case "pid-symbol": {
          if (!ann.meta?.symbolId) break;
          try {
            const sym = findSymbol(ann.meta.symbolId);
            if (!sym) break;

            const color = ann.meta.color || "#ef4444";
            // Replace currentColor with actual color for rasterisation
            const svgInner = sym.svg.replace(/currentColor/g, color);
            const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${svgInner}</svg>`;
            const blob = new Blob([svgString], { type: "image/svg+xml" });
            const url = URL.createObjectURL(blob);

            const canvas = document.createElement("canvas");
            canvas.width = 100;
            canvas.height = 100;
            const ctx = canvas.getContext("2d");
            if (!ctx) { URL.revokeObjectURL(url); break; }

            await new Promise<void>((resolve, reject) => {
              const img = new Image();
              img.onload = () => { ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url); resolve(); };
              img.onerror = () => { URL.revokeObjectURL(url); reject(); };
              img.src = url;
            });

            const pngDataUrl = canvas.toDataURL("image/png");
            const pngBytes = Uint8Array.from(atob(pngDataUrl.split(",")[1]), c => c.charCodeAt(0));
            const image = await pdfDoc.embedPng(pngBytes);
            page.drawImage(image, { x, y, width: w, height: h });

            if (ann.meta.label && helveticaFont) {
              const lc = hexToRgb(color);
              page.drawText(ann.meta.label, {
                x: x + w / 2 - (ann.meta.label.length * 2.5),
                y: y - 11,
                size: 8,
                color: rgb(lc.r, lc.g, lc.b),
                font: helveticaFont,
              });
            }
          } catch (err) {
            console.warn("Failed to render pid-symbol to PDF:", err);
          }
          break;
        }

        default:
          console.warn(`Unknown annotation type: ${ann.type}`);
          break;
        }
        } catch (annError) {
          console.error(`Error processing annotation on page ${pageIndexStr}:`, annError, ann);
          // Continue with next annotation
        }
      }
    }

    return await pdfDoc.save();
  } catch (error) {
    console.error('Error in saveAnnotatedPdf:', error);
    throw error;
  }
}
