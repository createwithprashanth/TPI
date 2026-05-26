import { useRef, useState } from 'react';
import { generatePreview } from '../../../services/pid';
import type { ProjectInfo } from '../../../services/pid';
import type { MtoSession } from './useMtoSessions';

interface UseExportsOptions {
  mtoSessions: MtoSession[];
  pidFiles: File[];
  currentPidIndex: number;
  imageRef: React.RefObject<HTMLImageElement | null>;
  project: ProjectInfo;
  totalCount: number;
}

export function useMtoExports({
  mtoSessions,
  pidFiles,
  currentPidIndex,
  imageRef,
  project,
  totalCount,
}: UseExportsOptions) {
  const [mtoExportingPdf, setMtoExportingPdf] = useState(false);
  const [mtoImageDownloading, setMtoImageDownloading] = useState(false);
  const exportingRef = useRef(false);

  const exportAllMtoCsv = () => {
    if (!mtoSessions.length) return;
    const multiFile = pidFiles.length > 1;
    const meta: (string | number)[][] = [];
    if (project.project_name)    meta.push(['Project', project.project_name]);
    if (project.project_no)      meta.push(['Project No.', project.project_no]);
    if (project.client_name)     meta.push(['Client', project.client_name]);
    if (project.contractor_name) meta.push(['Contractor', project.contractor_name]);
    if (project.location)        meta.push(['Location', project.location]);
    if (meta.length) meta.push([]);

    let headers: (string | number)[], dataRows: (string | number)[][], totalRow: (string | number)[];
    if (multiFile) {
      headers = ['No.', 'Symbol', 'Drawing', 'Count']; let rowNo = 1;
      dataRows = mtoSessions.flatMap(s => s.fileResults.map(fr => [rowNo++, s.label, fr.fileName, fr.count]));
      totalRow = ['', 'TOTAL', '', totalCount];
    } else {
      const allPages = Array.from(new Set(mtoSessions.flatMap(s => (s.fileResults[0]?.pageCounts ?? []).map(pc => pc.page)))).sort((a, b) => a - b);
      const multiPage = allPages.length > 1;
      headers = multiPage ? ['No.', 'Symbol', ...allPages.map(p => `Page ${p}`), 'Total Count'] : ['No.', 'Symbol', 'Count'];
      dataRows = mtoSessions.map((s, i) => {
        const fr = s.fileResults[0];
        if (multiPage) return [i + 1, s.label, ...allPages.map(p => fr?.pageCounts.find(pc => pc.page === p)?.count ?? 0), s.count];
        return [i + 1, s.label, s.count];
      });
      totalRow = multiPage
        ? ['', 'TOTAL', ...allPages.map(p => mtoSessions.reduce((sum, s) => sum + (s.fileResults[0]?.pageCounts.find(pc => pc.page === p)?.count ?? 0), 0)), totalCount]
        : ['', 'TOTAL', totalCount];
    }

    const esc = (v: string | number) => { const s = String(v); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [...meta, headers, ...dataRows, [], totalRow].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `piping_mto_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const exportMtoExcel = async () => {
    if (!mtoSessions.length) return;
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Piping MTO'; workbook.created = new Date();
    const multiFile = pidFiles.length > 1;
    const imgColIdx = 3;
    const countColLetter = multiFile ? 'E' : 'D';
    const sheet = workbook.addWorksheet('Piping MTO', { pageSetup: { fitToPage: true, fitToWidth: 1 } });
    sheet.columns = [{ key: 'no', width: 6 }, { key: 'symbol', width: 28 }, { key: 'image', width: 14 }, ...(multiFile ? [{ key: 'drawing', width: 32 }] : []), { key: 'count', width: 8 }];

    const addMeta = (label: string, value: string) => {
      const r = sheet.addRow([label, value]);
      r.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF888888' } };
      r.getCell(2).font = { size: 9 }; r.height = 14;
    };
    if (project.project_name)    addMeta('Project',     project.project_name);
    if (project.project_no)      addMeta('Project No.', project.project_no);
    if (project.client_name)     addMeta('Client',      project.client_name);
    if (project.contractor_name) addMeta('Contractor',  project.contractor_name);
    if (project.location)        addMeta('Location',    project.location);
    if (sheet.rowCount > 0) sheet.addRow([]);

    const hdrValues = ['No.', 'Symbol', 'Image', ...(multiFile ? ['Drawing'] : []), 'Count'];
    const hdrRow = sheet.addRow(hdrValues); hdrRow.height = 18;
    hdrRow.eachCell(cell => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF374151' } } };
    });

    const ROW_H = 48; let rowNo = 1, firstDataRow = -1, lastDataRow = -1;
    for (const session of mtoSessions) {
      for (const fr of session.fileResults) {
        const values = [rowNo++, session.label, '', ...(multiFile ? [fr.fileName] : []), fr.count];
        const dataRow = sheet.addRow(values); dataRow.height = ROW_H;
        if (firstDataRow === -1) firstDataRow = dataRow.number;
        lastDataRow = dataRow.number;
        dataRow.eachCell((cell, col) => {
          cell.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' };
          cell.font = { size: 9 };
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
        });
        dataRow.getCell(2).font = { size: 9, color: { argb: 'FF' + session.color.replace('#', '') } };
        const imgBase64 = session.thumbnail || session.templateImage;
        if (imgBase64) {
          try {
            const ext = session.thumbnail ? 'png' : 'jpeg';
            const imgId = workbook.addImage({ base64: imgBase64, extension: ext });
            sheet.addImage(imgId, { tl: { col: imgColIdx - 1, row: dataRow.number - 1 }, br: { col: imgColIdx, row: dataRow.number }, editAs: 'oneCell' } as any);
          } catch { /* best effort */ }
        }
      }
    }

    sheet.addRow([]);
    const totalRow = sheet.addRow(['', 'TOTAL', '', ...(multiFile ? [''] : []), '']);
    totalRow.height = 18; totalRow.getCell(2).font = { bold: true, size: 10 };
    const totalCell = totalRow.getCell(multiFile ? 5 : 4);
    totalCell.font = { bold: true, size: 11 };
    if (firstDataRow > 0) {
      totalCell.value = { formula: `SUM(${countColLetter}${firstDataRow}:${countColLetter}${lastDataRow})`, result: totalCount } as any;
    } else { totalCell.value = 0; }
    totalCell.border = { top: { style: 'thin', color: { argb: 'FF374151' } } };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `piping_mto_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  };

  const downloadMtoImage = async () => {
    if (!mtoSessions.length || !pidFiles.length || mtoImageDownloading) return;
    setMtoImageDownloading(true);
    for (let fi = 0; fi < pidFiles.length; fi++) {
      let previewSrc: string;
      if (fi === currentPidIndex && imageRef.current?.src?.startsWith('data:')) {
        previewSrc = imageRef.current.src;
      } else {
        try { const { image } = await generatePreview(pidFiles[fi]); previewSrc = image; }
        catch { continue; }
      }
      const img = new Image(); img.src = previewSrc;
      await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); });
      if (!img.naturalWidth) continue;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0);
      for (const session of mtoSessions) {
        const fr = session.fileResults[fi];
        if (!fr?.matches.length) continue;
        const scaleX = fr.imageWidth ? canvas.width / fr.imageWidth : 1;
        const scaleY = fr.imageHeight ? canvas.height / fr.imageHeight : 1;
        ctx.strokeStyle = session.color;
        ctx.lineWidth = Math.max(6, Math.round(canvas.width / 600));
        for (const m of fr.matches) ctx.strokeRect(m.x1 * scaleX, m.y1 * scaleY, (m.x2 - m.x1) * scaleX, (m.y2 - m.y1) * scaleY);
      }
      const pad = 24, swatchW = 40, swatchH = 28, lineH = 44, fontSize = 28;
      ctx.font = `bold ${fontSize}px sans-serif`; let ly = pad;
      const fileTotal = mtoSessions.reduce((s, sess) => s + (sess.fileResults[fi]?.count ?? 0), 0);
      for (const session of mtoSessions) {
        const fr = session.fileResults[fi];
        ctx.fillStyle = session.color; ctx.fillRect(pad, ly, swatchW, swatchH);
        ctx.fillStyle = '#111111';
        ctx.fillText(`${session.label}: ${fr?.count ?? 0}`, pad + swatchW + 10, ly + swatchH - 4);
        ly += lineH;
      }
      ctx.fillStyle = '#111111'; ctx.fillText(`Total: ${fileTotal}`, pad, ly + swatchH - 4);
      await new Promise<void>(res => {
        canvas.toBlob(blob => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            const base = pidFiles[fi].name.replace(/\.pdf$/i, '');
            a.download = pidFiles.length > 1 ? `mto_${base}_annotated.jpg` : 'piping_mto_annotated.jpg';
            a.click(); URL.revokeObjectURL(url);
          }
          res();
        }, 'image/jpeg', 0.92);
      });
    }
    setMtoImageDownloading(false);
  };

  const exportMtoPDF = async () => {
    if (!mtoSessions.length || mtoExportingPdf) return;
    if (exportingRef.current) return;
    exportingRef.current = true;
    setMtoExportingPdf(true);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight(), M = 12;

      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.setTextColor(255, 255, 255);
      pdf.setFillColor(31, 41, 55); pdf.rect(0, 0, PW, 14, 'F');
      pdf.text('Piping MTO — Symbol Count Summary', M, 9.5);
      let y = 22;

      const metaPairs: [string, string][] = [];
      if (project.project_name)    metaPairs.push(['Project', project.project_name]);
      if (project.project_no)      metaPairs.push(['Project No.', project.project_no]);
      if (project.client_name)     metaPairs.push(['Client', project.client_name]);
      if (project.contractor_name) metaPairs.push(['Contractor', project.contractor_name]);
      if (project.location)        metaPairs.push(['Location', project.location]);
      pdf.setFontSize(9);
      for (const [k, v] of metaPairs) {
        pdf.setFont('helvetica', 'bold'); pdf.setTextColor(100, 116, 139); pdf.text(k, M, y);
        pdf.setFont('helvetica', 'normal'); pdf.setTextColor(30, 30, 30); pdf.text(v, M + 30, y);
        y += 5.5;
      }
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(160, 160, 160);
      pdf.text(`Generated ${new Date().toLocaleString()}`, M, metaPairs.length ? y + 2 : y);
      y += metaPairs.length ? 9 : 6;

      const multiFile = pidFiles.length > 1;
      const COL_NO = M, COL_SYM = M + 12, COL_DRW = M + 90, COL_CNT = PW - M - 16, ROW_H = 6.5;
      pdf.setFillColor(31, 41, 55); pdf.rect(M, y - ROW_H + 1.5, PW - M * 2, ROW_H, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(255, 255, 255);
      pdf.text('No.', COL_NO + 1, y); pdf.text('Symbol', COL_SYM, y);
      if (multiFile) pdf.text('Drawing', COL_DRW, y);
      pdf.text('Count', COL_CNT, y); y += ROW_H;

      let rowNo = 1;
      for (const session of mtoSessions) {
        const rows = multiFile ? session.fileResults : session.fileResults.slice(0, 1);
        for (const fr of rows) {
          if (!fr) continue;
          if (y > PH - M - 10) { pdf.addPage(); y = M + ROW_H; }
          if (rowNo % 2 === 0) { pdf.setFillColor(248, 250, 252); pdf.rect(M, y - ROW_H + 1.5, PW - M * 2, ROW_H, 'F'); }
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80, 80, 80);
          pdf.text(String(rowNo++), COL_NO + 1, y);
          const hx = parseInt(session.color.slice(1, 3), 16), hy = parseInt(session.color.slice(3, 5), 16), hz = parseInt(session.color.slice(5, 7), 16);
          pdf.setTextColor(hx, hy, hz);
          pdf.text(session.label.length > 40 ? session.label.slice(0, 39) + '…' : session.label, COL_SYM, y);
          pdf.setTextColor(30, 30, 30);
          if (multiFile) { const fn = fr.fileName.length > 32 ? fr.fileName.slice(0, 31) + '…' : fr.fileName; pdf.text(fn, COL_DRW, y); }
          pdf.setFont('helvetica', 'bold'); pdf.text(String(fr.count), COL_CNT, y); y += ROW_H;
        }
      }
      if (y > PH - M - 10) { pdf.addPage(); y = M + ROW_H; }
      pdf.setFillColor(31, 41, 55); pdf.rect(M, y - ROW_H + 1.5, PW - M * 2, ROW_H, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(255, 255, 255);
      pdf.text('TOTAL', COL_SYM, y); pdf.text(String(totalCount), COL_CNT, y);

      for (let fi = 0; fi < pidFiles.length; fi++) {
        let previewSrc: string;
        if (fi === currentPidIndex && imageRef.current?.src?.startsWith('data:')) {
          previewSrc = imageRef.current.src;
        } else {
          try { const { image } = await generatePreview(pidFiles[fi]); previewSrc = image; }
          catch { continue; }
        }
        const imgEl = new Image(); imgEl.src = previewSrc;
        await new Promise<void>(res => { imgEl.onload = () => res(); imgEl.onerror = () => res(); });
        if (!imgEl.naturalWidth) continue;
        const canvas = document.createElement('canvas');
        canvas.width = imgEl.naturalWidth; canvas.height = imgEl.naturalHeight;
        const ctx = canvas.getContext('2d'); if (!ctx) continue;
        ctx.drawImage(imgEl, 0, 0);
        for (const session of mtoSessions) {
          const fr = session.fileResults[fi]; if (!fr?.matches.length) continue;
          const sx = fr.imageWidth ? canvas.width / fr.imageWidth : 1;
          const sy = fr.imageHeight ? canvas.height / fr.imageHeight : 1;
          ctx.strokeStyle = session.color; ctx.lineWidth = Math.max(6, Math.round(canvas.width / 600));
          for (const m of fr.matches) ctx.strokeRect(m.x1 * sx, m.y1 * sy, (m.x2 - m.x1) * sx, (m.y2 - m.y1) * sy);
        }
        pdf.addPage();
        const TITLE_H = 10;
        pdf.setFillColor(31, 41, 55); pdf.rect(0, 0, PW, TITLE_H, 'F');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(255, 255, 255);
        const fn = pidFiles[fi].name; pdf.text(fn.length > 80 ? fn.slice(0, 79) + '…' : fn, M, 6.5);
        if (pidFiles.length > 1) { pdf.setTextColor(160, 160, 160); pdf.setFontSize(7.5); pdf.text(`Drawing ${fi + 1} / ${pidFiles.length}`, PW - M - 22, 6.5); }
        const maxW = PW - M * 2, maxH = PH - TITLE_H - M - 10;
        const aspect = canvas.width / canvas.height;
        let dw = maxW, dh = maxW / aspect;
        if (dh > maxH) { dh = maxH; dw = maxH * aspect; }
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.88), 'JPEG', M, TITLE_H + 2, dw, dh);
        const legendY = TITLE_H + 2 + dh + 5;
        if (legendY < PH - 4) {
          let lx = M; pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal');
          const fileTotal = mtoSessions.reduce((s, sess) => s + (sess.fileResults[fi]?.count ?? 0), 0);
          for (const session of mtoSessions) {
            const fr = session.fileResults[fi]; if (!fr) continue;
            const r = parseInt(session.color.slice(1, 3), 16), g = parseInt(session.color.slice(3, 5), 16), b = parseInt(session.color.slice(5, 7), 16);
            pdf.setFillColor(r, g, b); pdf.rect(lx, legendY - 3, 3.5, 3.5, 'F');
            pdf.setTextColor(30, 30, 30);
            const entry = `${session.label}: ${fr.count}`; pdf.text(entry, lx + 5, legendY);
            lx += pdf.getTextWidth(entry) + 10; if (lx > PW - M - 30) break;
          }
          pdf.setFont('helvetica', 'bold'); pdf.setTextColor(30, 30, 30); pdf.text(`Total: ${fileTotal}`, lx, legendY);
        }
      }
      pdf.save(`piping_mto_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err: any) {
      console.error('PDF export failed:', err);
    } finally {
      exportingRef.current = false;
      setMtoExportingPdf(false);
    }
  };

  return { exportAllMtoCsv, exportMtoExcel, downloadMtoImage, exportMtoPDF, mtoExportingPdf, mtoImageDownloading };
}
