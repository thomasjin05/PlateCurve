import { expect, test } from 'vitest'

import { extractPlate, parsePlateCsv } from './plate'

test('parses quoted comma-containing cells and trims every cell', () => {
  const rows = parsePlateCsv(' metadata,"quoted, value"\n A, 1 ')

  expect(rows).toEqual([
    ['metadata', 'quoted, value'],
    ['A', '1'],
  ])
})

test('preserves rows in a valid single-column metadata file', () => {
  expect(parsePlateCsv('Report title\nInstrument name')).toEqual([
    ['Report title'],
    ['Instrument name'],
  ])
})

test('throws a useful error for malformed CSV', () => {
  expect(() => parsePlateCsv('A,"unterminated')).toThrow(/Malformed CSV:.*quote/i)
})

test('extracts a manual region into 96 row-major A1 through H12 wells', () => {
  const plateRows = Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 12 }, (_, column) => String(row * 12 + column + 1)),
  )
  const rows = [['metadata'], ...plateRows.map((row) => ['label', ...row])]

  const plate = extractPlate(rows, { sourceRow: 1, sourceColumn: 1 })

  expect(plate.sourceRow).toBe(1)
  expect(plate.sourceColumn).toBe(1)
  expect(plate.wells).toHaveLength(96)
  expect(plate.wells[0]).toEqual({ id: 'A1', row: 'A', column: 1, rawAbsorbance: 1 })
  expect(plate.wells[95]).toEqual({ id: 'H12', row: 'H', column: 12, rawAbsorbance: 96 })
  expect(plate.wells.map(({ id }) => id)).toEqual(
    Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 12 }, (_, column) => `${String.fromCharCode(65 + row)}${column + 1}`),
    ).flat(),
  )
})

test('maps empty and nonnumeric plate cells to null instead of zero', () => {
  const rows = Array.from({ length: 8 }, () => Array(12).fill('1'))
  rows[0][0] = ''
  rows[7][11] = 'not measured'

  const plate = extractPlate(rows, { sourceRow: 0, sourceColumn: 0 })

  expect(plate.wells[0].rawAbsorbance).toBeNull()
  expect(plate.wells[95].rawAbsorbance).toBeNull()
})

test('throws a clear error when a manual region extends outside the CSV grid', () => {
  const rows = Array.from({ length: 8 }, () => Array(12).fill('1'))

  expect(() => extractPlate(rows, { sourceRow: 1, sourceColumn: 0 })).toThrow(
    'The selected 8 by 12 plate region extends outside the CSV grid.',
  )
})

test('rejects invalid manual source coordinates', () => {
  const rows = Array.from({ length: 8 }, () => Array(12).fill('1'))

  expect(() => extractPlate(rows, { sourceRow: -1, sourceColumn: 0 })).toThrow(
    'Manual plate coordinates must be non-negative integers.',
  )
})

test('automatically detects a labeled 8 by 12 numeric region after metadata', () => {
  const headers = Array.from({ length: 12 }, (_, column) => String(column + 1))
  const plateRows = Array.from({ length: 8 }, (_, row) => [
    '',
    String.fromCharCode(65 + row),
    ...Array.from({ length: 12 }, (_, column) => String(row * 12 + column + 1)),
  ])
  const rows = [
    ['ELISA export'],
    ['Instrument', 'Reader 1'],
    ['', '', ...headers],
    ...plateRows,
  ]

  const plate = extractPlate(rows)

  expect(plate.sourceRow).toBe(3)
  expect(plate.sourceColumn).toBe(2)
  expect(plate.wells[0].rawAbsorbance).toBe(1)
  expect(plate.wells[95].rawAbsorbance).toBe(96)
})

test('throws when no automatic candidate has at least 72 numeric cells', () => {
  const rows = Array.from({ length: 8 }, () => Array(12).fill('not numeric'))

  expect(() => extractPlate(rows)).toThrow('No likely 8 by 12 plate region was found.')
})
