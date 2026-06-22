import { expect, test } from 'vitest'

import { normalizeSpreadsheetRows, parseInputFile } from './spreadsheet'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

test('parses a CSV File with quoted metadata and reports its format', async () => {
  const file = new File([' metadata,"quoted, value"\n A, 0\n B, 1 '], 'reader.CSV', {
    type: 'text/csv',
  })

  await expect(parseInputFile(file)).resolves.toEqual({
    format: 'csv',
    rows: [
      ['metadata', 'quoted, value'],
      ['A', '0'],
      ['B', '1'],
    ],
  })
})

test('normalizes Excel cell values without changing row or cell positions', () => {
  const measuredAt = new Date('2026-06-22T03:04:05.000Z')
  const customValue = { toString: () => ' custom value ' }

  expect(
    normalizeSpreadsheetRows([
      [' metadata ', 1.25, 0, null, true, measuredAt],
      [undefined, false, customValue],
      [],
    ]),
  ).toEqual([
    ['metadata', '1.25', '0', '', 'true', '2026-06-22T03:04:05.000Z'],
    ['', 'false', 'custom value'],
    [],
  ])
})

test('uses the CSV MIME type when the filename has no recognized extension', async () => {
  const file = new File(['Label, 2'], 'reader.upload', { type: 'text/csv' })

  await expect(parseInputFile(file)).resolves.toEqual({
    format: 'csv',
    rows: [['Label', '2']],
  })
})

test('routes an uppercase XLSX extension to the Excel reader', async () => {
  const file = new File(['not a workbook'], 'reader.XLSX')

  await expect(parseInputFile(file)).rejects.toThrow(/^Could not read the Excel workbook: .+/)
})

test('uses the official XLSX MIME type when the filename has no recognized extension', async () => {
  const file = new File(['not a workbook'], 'reader.upload', { type: XLSX_MIME })

  await expect(parseInputFile(file)).rejects.toThrow(/^Could not read the Excel workbook: .+/)
})

test('rejects legacy .xls files', async () => {
  const file = new File(['legacy workbook'], 'reader.xls', { type: 'application/vnd.ms-excel' })

  await expect(parseInputFile(file)).rejects.toThrow('Choose a CSV or .xlsx Excel file.')
})

test('rejects a zero-byte file before parsing', async () => {
  const file = new File([], 'empty.xlsx', { type: XLSX_MIME })

  await expect(parseInputFile(file)).rejects.toThrow('The selected file is empty.')
})
