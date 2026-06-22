import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

import type { CurveSummary, ResultRow } from '../types'
import { downloadCsv, resultsToCsv, summaryToCsv } from './export'

const expectedResultColumns = [
  'well_id',
  'raw_absorbance',
  'corrected_absorbance',
  'assignment_type',
  'calculated_concentration',
  'final_concentration',
  'dilution_factor',
]

function parseCsv(csv: string): string[][] {
  const result = Papa.parse<string[]>(csv)
  expect(result.errors).toEqual([])
  return result.data
}

function resultRow(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    wellId: 'A1',
    row: 'A',
    column: 1,
    rawAbsorbance: 1.25,
    correctedAbsorbance: 1.15,
    assignmentType: 'sample',
    standardConcentration: null,
    sampleName: 'Patient 1',
    calculatedConcentration: 12.5,
    dilutionFactor: 4,
    finalConcentration: 50,
    warningStatus: 'Above standard range',
    ...overrides,
  }
}

function summary(overrides: Partial<CurveSummary> = {}): CurveSummary {
  return {
    model: 'linear',
    blankMean: 0.1,
    blankCount: 2,
    standardWellCount: 4,
    standardRange: '0 to 100',
    warnings: [],
    slope: 2,
    intercept: 0.5,
    rSquared: 0.99,
    ...overrides,
  }
}

function parseMetrics(csv: string): Map<string, string> {
  const [header, ...rows] = parseCsv(csv)
  expect(header).toEqual(['metric', 'value'])
  return new Map(rows.map(([metric, value]) => [metric, value]))
}

describe('results CSV export', () => {
  it('emits the standardized columns in their exact order', () => {
    expect(parseCsv(resultsToCsv([]))[0]).toEqual(expectedResultColumns)
  })

  it('exports every result field in standardized column order', () => {
    expect(parseCsv(resultsToCsv([resultRow()]))[1]).toEqual([
      'A1',
      '1.25',
      '1.15',
      'Patient 1',
      '12.5',
      '50',
      '4',
    ])
  })

  it('exports null numbers as empty fields without dropping numeric zero', () => {
    const row = resultRow({
      rawAbsorbance: null,
      correctedAbsorbance: 0,
      standardConcentration: 0,
      calculatedConcentration: null,
      dilutionFactor: 0,
      finalConcentration: 0,
    })

    const parsed = parseCsv(resultsToCsv([row]))[1]
    expect(parsed[1]).toBe('')
    expect(parsed[2]).toBe('0')
    expect(parsed[4]).toBe('')
    expect(parsed[5]).toBe('0')
    expect(parsed[6]).toBe('0')
  })

  it('round-trips commas, quotes, and newlines while preserving row order', () => {
    const rows = [
      resultRow({
        sampleName: 'Doe, "Jane"\nFollow-up',
        warningStatus: 'Check, repeat\nOperator said "urgent"',
      }),
      resultRow({ wellId: 'B2', row: 'B', column: 2, sampleName: 'Second' }),
    ]

    const parsed = parseCsv(resultsToCsv(rows))
    expect(parsed[1][0]).toBe('A1')
    expect(parsed[1][3]).toBe('Doe, "Jane"\nFollow-up')
    expect(parsed[2][0]).toBe('B2')
  })

  it('uses sample names, standard concentrations, and blank unused fields', () => {
    const rows = [
      resultRow({ sampleName: 'protein' }),
      resultRow({
        wellId: 'A2',
        assignmentType: 'standard',
        sampleName: '',
        standardConcentration: 10,
        calculatedConcentration: 10,
      }),
      resultRow({
        wellId: 'A3',
        assignmentType: 'unused',
        rawAbsorbance: 0,
        correctedAbsorbance: null,
        sampleName: '',
        calculatedConcentration: null,
        finalConcentration: null,
        warningStatus: '',
      }),
    ]

    const parsed = parseCsv(resultsToCsv(rows))
    expect(parsed[1][3]).toBe('protein')
    expect(parsed[2][3]).toBe('standard')
    expect(parsed[2][4]).toBe('10')
    expect(parsed[3]).toEqual(['A3', '0', '', '', '', '', ''])
  })

  it('escapes formula-leading result text without changing negative numbers', () => {
    const formulas = ['=1+1', '+2', '-3', '@SUM(A1)']
    const rows = formulas.map((formula, index) =>
      resultRow({
        wellId: `A${index + 1}`,
        column: index + 1,
        rawAbsorbance: -1.25,
        correctedAbsorbance: -0.5,
        standardConcentration: -10,
        sampleName: formula,
        calculatedConcentration: -2,
        finalConcentration: -8,
        warningStatus: formula,
      }),
    )

    const csv = resultsToCsv(rows)
    const parsed = parseCsv(csv)
    const rawRows = csv.split(/\r?\n/).slice(1)

    formulas.forEach((formula, index) => {
      const parsedRow = parsed[index + 1]
      const rawCells = rawRows[index].split(',')
      expect(parsedRow[3]).toBe(`'${formula}`)
      expect(rawCells[3]).not.toMatch(/^"?[=+\-@]/)
      expect(parsedRow[1]).toBe('-1.25')
      expect(parsedRow[2]).toBe('-0.5')
      expect(parsedRow[4]).toBe('-2')
      expect(parsedRow[5]).toBe('-8')
    })
  })
})

describe('summary CSV export', () => {
  it('exports linear metrics without 4PL parameters', () => {
    const metrics = parseMetrics(summaryToCsv(summary()))

    expect(Object.fromEntries(metrics)).toEqual({
      curve_model: 'linear',
      blank_mean: '0.1',
      blank_well_count: '2',
      standard_well_count: '4',
      standard_range: '0 to 100',
      warning_messages: '',
      slope: '2',
      intercept: '0.5',
      r_squared: '0.99',
    })
    expect(metrics.has('a')).toBe(false)
    expect(metrics.has('b')).toBe(false)
    expect(metrics.has('c')).toBe(false)
    expect(metrics.has('d')).toBe(false)
  })

  it('exports 4PL parameters without linear-only fit metrics', () => {
    const metrics = parseMetrics(
      summaryToCsv(
        summary({
          model: '4pl',
          slope: undefined,
          intercept: undefined,
          rSquared: 0.995,
          a: 2.4,
          b: 1.3,
          c: 10,
          d: 0.2,
        }),
      ),
    )

    expect(metrics.get('a')).toBe('2.4')
    expect(metrics.get('b')).toBe('1.3')
    expect(metrics.get('c')).toBe('10')
    expect(metrics.get('d')).toBe('0.2')
    expect(metrics.get('r_squared')).toBe('0.995')
    expect(metrics.has('slope')).toBe(false)
    expect(metrics.has('intercept')).toBe(false)
  })

  it('exports custom equation parameters and retains every provenance warning', () => {
    const warnings = [
      'Custom equation supplied by operator: y = 3x + 0.25.',
      'Blank correction was skipped.',
    ]
    const metrics = parseMetrics(
      summaryToCsv(
        summary({
          model: 'custom',
          slope: 3,
          intercept: 0.25,
          rSquared: undefined,
          warnings,
        }),
      ),
    )

    expect(metrics.get('slope')).toBe('3')
    expect(metrics.get('intercept')).toBe('0.25')
    expect(metrics.has('r_squared')).toBe(false)
    expect(metrics.get('warning_messages')).toBe(warnings.join('\n'))
  })

  it('escapes formula-leading summary warnings', () => {
    for (const warning of ['=1+1', '+2', '-3', '@SUM(A1)']) {
      const csv = summaryToCsv(summary({ warnings: [warning] }))
      const warningRow = csv.split(/\r?\n/).find((row) => row.startsWith('warning_messages,'))

      expect(parseMetrics(csv).get('warning_messages')).toBe(`'${warning}`)
      expect(warningRow).not.toMatch(/^warning_messages,"?[=+\-@]/)
    }
  })
})

describe('CSV download', () => {
  it('rejects an empty filename before accessing browser APIs', () => {
    expect(() => downloadCsv('', 'metric,value')).toThrow('Filename is required.')
    expect(() => downloadCsv('   ', 'metric,value')).toThrow('Filename is required.')
  })
})
