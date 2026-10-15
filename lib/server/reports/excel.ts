import 'server-only';
import ExcelJS from 'exceljs';

export interface SheetSpec {
  name: string;
  title: string;
  meta: [string, string][];
  columns: { header: string; width: number; numFmt?: string }[];
  rows: (string | number | null)[][];
}

/** مصنف Excel باتجاه من اليمين لليسار وبألوان الهوية */
export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'جُودِكس';
  wb.created = new Date();
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.slice(0, 31), {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: spec.meta.length + 3 }],
      properties: { defaultRowHeight: 18 },
    });
    ws.columns = spec.columns.map((c) => ({ width: c.width }));
    const titleRow = ws.addRow([spec.title]);
    titleRow.font = { bold: true, size: 14, color: { argb: 'FF2F4F44' }, name: 'Arial' };
    ws.mergeCells(titleRow.number, 1, titleRow.number, Math.max(1, spec.columns.length));
    for (const [k, v] of spec.meta) {
      const r = ws.addRow([`${k}: ${v}`]);
      r.font = { size: 10, color: { argb: 'FF44665A' }, name: 'Arial' };
      ws.mergeCells(r.number, 1, r.number, Math.max(1, spec.columns.length));
    }
    ws.addRow([]);
    const header = ws.addRow(spec.columns.map((c) => c.header));
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF55957A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE3EAE6' } } };
    });
    header.height = 22;
    for (const values of spec.rows) {
      const row = ws.addRow(values);
      row.eachCell((cell, col) => {
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF2F4F44' } };
        cell.alignment = { vertical: 'top', horizontal: 'right', wrapText: true };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFEDF2EF' } } };
        const fmt = spec.columns[col - 1]?.numFmt;
        if (fmt && typeof cell.value === 'number') cell.numFmt = fmt;
      });
    }
    if (spec.rows.length === 0) {
      const r = ws.addRow(['لا توجد بيانات في هذه الفترة.']);
      r.font = { italic: true, color: { argb: 'FF687D74' }, name: 'Arial' };
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
