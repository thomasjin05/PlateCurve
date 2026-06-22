import { readSheet } from 'read-excel-file/browser'

import { parsePlateCsv } from './plate'

export type ImportedTable = {
  rows: string[][]
  format: 'csv' | 'xlsx'
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const UNSUPPORTED_FILE_MESSAGE = 'Choose a CSV or .xlsx Excel file.'
export const MAX_INPUT_BYTES = 10 * 1024 * 1024

export function normalizeSpreadsheetRows(
  rows: readonly (readonly unknown[])[],
): string[][] {
  return rows.map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) return ''
      if (typeof cell === 'string') return cell.trim()
      if (typeof cell === 'number' && Number.isFinite(cell)) return String(cell)
      if (typeof cell === 'boolean') return String(cell)
      if (cell instanceof Date) return cell.toISOString()
      return String(cell).trim()
    }),
  )
}

export async function parseInputFile(file: File): Promise<ImportedTable> {
  if (file.size === 0) throw new Error('The selected file is empty.')
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('The selected file is larger than 10 MB.')
  }

  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()

  if (name.endsWith('.xls')) throw new Error(UNSUPPORTED_FILE_MESSAGE)

  if (name.endsWith('.csv') || (!name.endsWith('.xlsx') && mime === 'text/csv')) {
    return { rows: parsePlateCsv(await file.text()), format: 'csv' }
  }

  if (name.endsWith('.xlsx') || mime === XLSX_MIME) {
    try {
      const rows = await readSheet<string>(file, { parseNumber: (value) => value })
      return { rows: normalizeSpreadsheetRows(rows), format: 'xlsx' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not read the Excel workbook: ${message}`)
    }
  }

  throw new Error(UNSUPPORTED_FILE_MESSAGE)
}
