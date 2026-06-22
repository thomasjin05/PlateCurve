import { readFile } from 'node:fs/promises'

import { DOMParser as XmlDomParser } from '@xmldom/xmldom'
import { expect, test } from 'vitest'

import { MAX_INPUT_BYTES, normalizeSpreadsheetRows, parseInputFile } from './spreadsheet'

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

test('rejects files larger than 10 MB before parsing', async () => {
  const file = {
    name: 'oversized.csv',
    type: 'text/csv',
    size: 10 * 1024 * 1024 + 1,
    text: () => {
      throw new Error('CSV parser was called')
    },
  } as unknown as File

  await expect(parseInputFile(file)).rejects.toThrow('The selected file is larger than 10 MB.')
})

test('exports the 10 MB input limit', () => {
  expect(MAX_INPUT_BYTES).toBe(10 * 1024 * 1024)
})

test('reads only the first Excel worksheet and preserves numeric lexical text', async () => {
  const bytes = await readFile(new URL('../fixtures/two-sheet-plate.xlsx', import.meta.url))
  const file = new File([bytes], 'two-sheet-plate.xlsx', { type: XLSX_MIME })
  const browserDOMParser = globalThis.DOMParser
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: XmlDomParser })

  try {
    const imported = await parseInputFile(file)

    expect(imported).toEqual({
      format: 'xlsx',
      rows: [
        ['FIRST_SHEET', 'metadata', '', ''],
        ['0', '', '1.25', '1e-07'],
        ['true', '', '', ''],
      ],
    })
    expect(imported.rows.flat()).not.toContain('SECOND_SHEET')
  } finally {
    Object.defineProperty(globalThis, 'DOMParser', {
      configurable: true,
      value: browserDOMParser,
    })
  }
})

test('treats typed empty Excel cells as blank cells', async () => {
  const bytes = await readFile(new URL('../fixtures/labeled-plate.xlsx', import.meta.url))
  const file = new File([bytes], 'labeled-plate.xlsx', { type: XLSX_MIME })
  const browserDOMParser = globalThis.DOMParser
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: XmlDomParser })

  try {
    const imported = await parseInputFile(file)

    expect(imported.rows[0].slice(0, 3)).toEqual(['ELISA absorbance report', '', ''])
    expect(imported.rows[5].slice(0, 3)).toEqual(['A', '0.106', '0.112'])
    expect(imported.rows.flat()).not.toContain('This sheet must be ignored')
  } finally {
    Object.defineProperty(globalThis, 'DOMParser', {
      configurable: true,
      value: browserDOMParser,
    })
  }
})
