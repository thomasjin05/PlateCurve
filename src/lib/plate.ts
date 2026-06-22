import Papa from 'papaparse'

import type { PlateData } from '../types'

export function parsePlateCsv(csv: string): string[][] {
  const result = Papa.parse<string[]>(csv)
  const parseError = result.errors.find((error) => error.code !== 'UndetectableDelimiter')

  if (parseError) {
    throw new Error(`Malformed CSV: ${parseError.message}`)
  }

  return result.data.map((row) => row.map((cell) => cell.trim()))
}

export function extractPlate(
  rows: string[][],
  manual?: { sourceRow: number; sourceColumn: number },
): PlateData {
  let coordinates = manual

  if (!coordinates) {
    let best: { sourceRow: number; sourceColumn: number; score: number } | undefined
    const widestRow = Math.max(0, ...rows.map((row) => row.length))

    for (let sourceRow = 0; sourceRow <= rows.length - 8; sourceRow += 1) {
      for (let sourceColumn = 0; sourceColumn <= widestRow - 12; sourceColumn += 1) {
        const region = rows.slice(sourceRow, sourceRow + 8)
        if (region.some((row) => row.length < sourceColumn + 12)) continue

        const numericCount = region.reduce(
          (count, row) =>
            count +
            row
              .slice(sourceColumn, sourceColumn + 12)
              .filter((cell) => cell.trim() !== '' && Number.isFinite(Number(cell))).length,
          0,
        )
        if (numericCount < 72) continue

        const hasColumnHeaders = Array.from(
          { length: 12 },
          (_, column) => rows[sourceRow - 1]?.[sourceColumn + column] === String(column + 1),
        ).every(Boolean)
        const hasRowHeaders = Array.from(
          { length: 8 },
          (_, row) => rows[sourceRow + row]?.[sourceColumn - 1] === String.fromCharCode(65 + row),
        ).every(Boolean)
        const score = numericCount + (hasColumnHeaders ? 100 : 0) + (hasRowHeaders ? 100 : 0)

        if (!best || score > best.score) best = { sourceRow, sourceColumn, score }
      }
    }

    if (!best) {
      throw new Error('No likely 8 by 12 plate region was found.')
    }

    coordinates = best
  }

  if (
    !Number.isInteger(coordinates.sourceRow) ||
    !Number.isInteger(coordinates.sourceColumn) ||
    coordinates.sourceRow < 0 ||
    coordinates.sourceColumn < 0
  ) {
    throw new Error('Manual plate coordinates must be non-negative integers.')
  }

  const selectedRows = rows.slice(coordinates.sourceRow, coordinates.sourceRow + 8)
  if (
    selectedRows.length !== 8 ||
    selectedRows.some((row) => row.length < coordinates.sourceColumn + 12)
  ) {
    throw new Error('The selected 8 by 12 plate region extends outside the CSV grid.')
  }

  const wells = Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => {
      const row = String.fromCharCode(65 + rowIndex)
      const column = columnIndex + 1
      const cell = rows[coordinates.sourceRow + rowIndex][coordinates.sourceColumn + columnIndex]
      const value = Number(cell)

      return {
        id: `${row}${column}`,
        row,
        column,
        rawAbsorbance: cell.trim() !== '' && Number.isFinite(value) ? value : null,
      }
    }),
  ).flat()

  return { sourceRow: coordinates.sourceRow, sourceColumn: coordinates.sourceColumn, wells }
}
