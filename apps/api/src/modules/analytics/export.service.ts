import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface ExportResult {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

@Injectable()
export class ExportService {
  async toFile(rows: Record<string, unknown>[], metric: string, format: 'xlsx' | 'csv'): Promise<ExportResult> {
    const normalized = rows.map((row) => normalizeRow(row));
    if (format === 'csv') {
      return { buffer: Buffer.from(toCsv(normalized), 'utf8'), contentType: 'text/csv', filename: `${metric}.csv` };
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(metric);
    if (normalized.length > 0) {
      sheet.columns = Object.keys(normalized[0]).map((key) => ({ header: key, key, width: 20 }));
      sheet.addRows(normalized);
    }
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${metric}.xlsx`,
    };
  }
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'bigint' ? value.toString() : value;
  }
  return out;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
