import ExcelJS, { type Worksheet, type Workbook } from 'exceljs'

import type { AnalysisResult, CurveSummary, ResultRow } from '../types'
import { RESULT_COLUMNS, downloadBlob, resultToExportRow } from './export'
import type { ImportedTable } from './spreadsheet'

export interface ExcelExportInput {
  imported: ImportedTable
  result: AnalysisResult
}

const FILLS = {
  blank: 'FFDBEAFE',
  standard: 'FFEDE9FE',
  sample: 'FFDCFCE7',
  unused: 'FFFEE2E2',
} as const

function formatNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error('Curve equation requires finite parameters.')
  }
  return Number(value.toPrecision(8)).toString()
}

export function formatCurveEquation(summary: CurveSummary): string {
  if (summary.model === '4pl') {
    return `y = ${formatNumber(summary.d)} + (${formatNumber(summary.a)} - ${formatNumber(summary.d)}) / (1 + (x / ${formatNumber(summary.c)})^${formatNumber(summary.b)})`
  }

  const slope = formatNumber(summary.slope)
  const intercept = summary.intercept
  if (intercept === undefined || !Number.isFinite(intercept)) {
    throw new Error('Curve equation requires finite parameters.')
  }
  const sign = intercept < 0 ? '-' : '+'
  return `y = ${slope}x ${sign} ${formatNumber(Math.abs(intercept))}`
}

function uniqueSheetName(workbook: Workbook, base: string): string {
  if (!workbook.getWorksheet(base)) return base
  let suffix = 2
  while (workbook.getWorksheet(`${base} (${suffix})`)) suffix += 1
  return `${base} (${suffix})`
}

function styleHeader(row: ReturnType<Worksheet['getRow']>): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F38' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
}

function addPlateHeaders(sheet: Worksheet, headerRow: number): void {
  sheet.getCell(headerRow, 1).value = 'Row'
  for (let column = 1; column <= 12; column += 1) {
    sheet.getCell(headerRow, column + 1).value = column
  }
  styleHeader(sheet.getRow(headerRow))
  for (let row = 0; row < 8; row += 1) {
    const cell = sheet.getCell(headerRow + row + 1, 1)
    cell.value = String.fromCharCode(65 + row)
    cell.font = { bold: true }
    cell.alignment = { horizontal: 'center' }
  }
}

function fillFor(row: ResultRow): string {
  return FILLS[row.assignmentType]
}

function writePlate(
  sheet: Worksheet,
  rows: ResultRow[],
  headerRow: number,
  value: (row: ResultRow) => number,
): void {
  addPlateHeaders(sheet, headerRow)
  for (const row of rows) {
    const rowIndex = row.row.charCodeAt(0) - 65
    const cell = sheet.getCell(headerRow + rowIndex + 1, row.column + 1)
    cell.value = value(row)
    cell.numFmt = '0.0000'
    cell.alignment = { horizontal: 'center' }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: fillFor(row) },
    }
  }
}

function concentrationFor(row: ResultRow): number {
  if (row.assignmentType === 'standard') return row.standardConcentration ?? 0
  if (row.assignmentType === 'sample') return row.calculatedConcentration ?? 0
  return 0
}

function addAnalysisSheet(workbook: Workbook, result: AnalysisResult): void {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, 'Analysis Results'))
  sheet.mergeCells('A1:M1')
  sheet.getCell('A1').value = 'PlateCurve Analysis Results'
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
  sheet.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF173F38' },
  }
  sheet.getCell('A3').value = 'Curve model'
  sheet.getCell('B3').value = result.summary.model
  sheet.getCell('A4').value = 'Variables'
  sheet.getCell('B4').value = 'x = concentration; y = corrected absorbance'
  sheet.getCell('A5').value = 'Equation'
  sheet.getCell('B5').value = formatCurveEquation(result.summary)
  sheet.getCell('A6').value = 'R²'
  sheet.getCell('B6').value = result.summary.rSquared ?? null
  sheet.getCell('A7').value = 'Blank mean average'
  sheet.getCell('B7').value = result.summary.blankMean
  for (const row of [3, 4, 5, 6, 7]) sheet.getCell(row, 1).font = { bold: true }

  sheet.getCell('A8').value = 'Corrected absorbance'
  sheet.getCell('A8').font = { bold: true, size: 12 }
  writePlate(sheet, result.rows, 9, (row) =>
    row.assignmentType === 'unused' ? 0 : (row.correctedAbsorbance ?? 0),
  )

  sheet.getCell('A19').value = 'Calculated concentration (before dilution)'
  sheet.getCell('A19').font = { bold: true, size: 12 }
  writePlate(sheet, result.rows, 20, concentrationFor)

  sheet.getColumn(1).width = 12
  for (let column = 2; column <= 13; column += 1) sheet.getColumn(column).width = 12
  sheet.getColumn(2).width = 18
  sheet.views = [{ state: 'frozen', ySplit: 2 }]
}

function addWellDataSheet(workbook: Workbook, result: AnalysisResult): void {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, 'Well Data'))
  sheet.addRow([...RESULT_COLUMNS])
  styleHeader(sheet.getRow(1))
  for (const row of result.rows) sheet.addRow(resultToExportRow(row))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + RESULT_COLUMNS.length)}1` }
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 12 : 24
  })
}

function addOriginalDataSheet(workbook: Workbook, rows: string[][]): void {
  const sheet = workbook.addWorksheet('Original Data')
  sheet.addRows(rows.map((row) => [...row]))
}

export async function buildExcelWorkbook(input: ExcelExportInput): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()

  addOriginalDataSheet(workbook, input.imported.rows)
  addAnalysisSheet(workbook, input.result)
  addWellDataSheet(workbook, input.result)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

export function downloadExcel(filename: string, bytes: Uint8Array): void {
  downloadBlob(
    filename,
    new Blob([bytes as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
}
