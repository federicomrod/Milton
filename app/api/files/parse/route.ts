import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic'; // ensure Node.js runtime for xlsx

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No valid file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json({ error: 'Empty file uploaded' }, { status: 400 });
    }

    // Optional: reject very large files (>10MB)
    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 });
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const sheets = workbook.SheetNames.slice(0, 10).map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as any[][];
      let headers = (rows[0] || []).map((h: any, idx: number) => {
        const headerName = String(h).trim();
        return headerName === '' ? `Column_${idx + 1}` : headerName;
      });

      const sampleRowsRaw = rows.slice(1, 26);

      // Adjust headers and rows to align columns
      sampleRowsRaw.forEach(row => {
        if (row.length > headers.length) {
          for (let i = headers.length; i < row.length; i++) {
            headers.push(`Column_${i + 1}`);
          }
        }
      });

      const sampleRows = sampleRowsRaw.map(row => {
        const obj: any = {};
        for (let i = 0; i < headers.length; i++) {
          obj[headers[i]] = i < row.length ? row[i] : '';
        }
        return obj;
      });

      return {
        name: sheetName,
        columns: headers,
        sampleRows,
      };
    });

    const response = {
      fileName: file.name,
      sheets,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('File parse error:', error);
    return NextResponse.json({ error: 'Failed to parse file' }, { status: 500 });
  }
}