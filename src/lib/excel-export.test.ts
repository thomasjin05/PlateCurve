import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import type { AnalysisResult, ResultRow } from '../types'
import { buildExcelWorkbook, formatCurveEquation } from './excel-export'

function resultRow(wellId: string, overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    wellId,
    row: wellId[0],
    column: Number(wellId.slice(1)),
    rawAbsorbance: 0,
    correctedAbsorbance: null,
    assignmentType: 'unused',
    standardConcentration: null,
    sampleName: '',
    calculatedConcentration: null,
    dilutionFactor: 1,
    finalConcentration: null,
    warningStatus: '',
    ...overrides,
  }
}

function analysisResult(): AnalysisResult {
  const rows = Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => {
      const row = String.fromCharCode(65 + rowIndex)
      return resultRow(`${row}${columnIndex + 1}`)
    }),
  ).flat()
  rows[0] = resultRow('A1', {
    rawAbsorbance: 0.1,
    correctedAbsorbance: -0.01,
    assignmentType: 'blank',
  })
  rows[1] = resultRow('A2', {
    rawAbsorbance: 0.5,
    correctedAbsorbance: 0.39,
    assignmentType: 'standard',
    standardConcentration: 10,
    calculatedConcentration: 10,
  })
  rows[2] = resultRow('A3', {
    rawAbsorbance: 0.9,
    correctedAbsorbance: 0.79,
    assignmentType: 'sample',
    sampleName: 'protein',
    calculatedConcentration: 2,
    dilutionFactor: 10,
    finalConcentration: 20,
  })

  return {
    rows,
    warnings: [],
    summary: {
      model: 'linear',
      blankMean: 0.11,
      blankCount: 1,
      standardWellCount: 1,
      standardRange: '10 to 10',
      warnings: [],
      slope: 2,
      intercept: 0.5,
      rSquared: 0.99,
    },
    fit: { model: 'linear', slope: 2, intercept: 0.5, rSquared: 0.99 },
  }
}

async function openWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  )
  return workbook
}

describe('Excel export', () => {
  it('creates source, analysis, and well-data sheets for CSV input', async () => {
    const bytes = await buildExcelWorkbook({
      imported: {
        format: 'csv',
        rows: [['Instrument', 'Reader'], ['Row', '1'], ['A', '0.1']],
      },
      result: analysisResult(),
    })
    const workbook = await openWorkbook(bytes)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Original Data',
      'Analysis Results',
      'Well Data',
    ])
    expect(workbook.getWorksheet('Original Data')!.getCell('A1').value).toBe('Instrument')
    expect(workbook.getWorksheet('Original Data')!.getCell('B3').value).toBe('0.1')

    const analysis = workbook.getWorksheet('Analysis Results')!
    expect(analysis.getCell('A1').value).toBe('ELISA Analysis Results')
    expect(analysis.getCell('B3').value).toBe('linear')
    expect(analysis.getCell('B5').value).toBe('y = 2x + 0.5')
    expect(analysis.getCell('B6').value).toBe(0.99)
    expect(analysis.getCell('B10').value).toBe(-0.01)
    expect(analysis.getCell('C10').value).toBe(0.39)
    expect(analysis.getCell('D10').value).toBe(0.79)
    expect(analysis.getCell('E10').value).toBe(0)
    expect(analysis.getCell('B21').value).toBe(0)
    expect(analysis.getCell('C21').value).toBe(10)
    expect(analysis.getCell('D21').value).toBe(2)
    expect(analysis.getCell('E21').value).toBe(0)
    expect((analysis.getCell('B10').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFDBEAFE')
    expect((analysis.getCell('C10').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFEDE9FE')
    expect((analysis.getCell('D10').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFDCFCE7')
    expect((analysis.getCell('E10').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFEE2E2')

    const detail = workbook.getWorksheet('Well Data')!
    expect(detail.getRow(1).values).toEqual([
      undefined,
      'well_id',
      'raw_absorbance',
      'corrected_absorbance',
      'assignment_type',
      'calculated_concentration',
      'final_concentration',
      'dilution_factor',
    ])
    expect(detail.getRow(4).values).toEqual([
      undefined,
      'A3',
      0.9,
      0.79,
      'protein',
      2,
      20,
      10,
    ])
    expect(detail.getRow(5).values).toEqual([undefined, 'A4', 0])
  })

  it('creates source, analysis, and well-data sheets from parsed XLSX rows', async () => {
    const output = await buildExcelWorkbook({
      imported: {
        format: 'xlsx',
        rows: [['Instrument', 'Reader'], ['Row', '1'], ['A', '0.1']],
      },
      result: analysisResult(),
    })
    const workbook = await openWorkbook(output)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Original Data',
      'Analysis Results',
      'Well Data',
    ])
    expect(workbook.getWorksheet('Original Data')!.getCell('A1').value).toBe('Instrument')
    expect(workbook.getWorksheet('Original Data')!.getCell('B3').value).toBe('0.1')
  })

  it('formats linear, custom, and 4PL equations', () => {
    const base = analysisResult().summary

    expect(formatCurveEquation(base)).toBe('y = 2x + 0.5')
    expect(formatCurveEquation({ ...base, model: 'custom', slope: 3, intercept: -1 })).toBe(
      'y = 3x - 1',
    )
    expect(
      formatCurveEquation({
        ...base,
        model: '4pl',
        a: 2.4,
        b: 1.3,
        c: 10,
        d: 0.2,
      }),
    ).toBe('y = 0.2 + (2.4 - 0.2) / (1 + (x / 10)^1.3)')
  })
})
