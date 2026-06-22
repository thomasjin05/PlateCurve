import Papa from 'papaparse'

import type { CurveSummary, ResultRow } from '../types'

export const RESULT_COLUMNS = [
  'well_id',
  'row',
  'column',
  'raw_absorbance',
  'corrected_absorbance',
  'assignment_type',
  'standard_concentration',
  'sample_name',
  'calculated_concentration',
  'dilution_factor',
  'final_concentration',
  'warning_status',
] as const

export function resultsToCsv(rows: ResultRow[]): string {
  const data = rows.map((row) => [
    row.wellId,
    row.row,
    row.column,
    row.rawAbsorbance,
    row.correctedAbsorbance,
    row.assignmentType,
    row.standardConcentration,
    row.sampleName,
    row.calculatedConcentration,
    row.dilutionFactor,
    row.finalConcentration,
    row.warningStatus,
  ])

  return Papa.unparse({ fields: [...RESULT_COLUMNS], data })
}

export function summaryToCsv(summary: CurveSummary): string {
  const data: Array<[string, string | number | undefined]> = [
    ['curve_model', summary.model],
    ['blank_mean', summary.blankMean],
    ['blank_well_count', summary.blankCount],
    ['standard_well_count', summary.standardWellCount],
    ['standard_range', summary.standardRange],
    ['warning_messages', summary.warnings.join('\n')],
  ]

  if (summary.model === 'linear') {
    data.push(
      ['slope', summary.slope],
      ['intercept', summary.intercept],
      ['r_squared', summary.rSquared],
    )
  } else if (summary.model === '4pl') {
    data.push(
      ['a', summary.a],
      ['b', summary.b],
      ['c', summary.c],
      ['d', summary.d],
    )
  } else {
    data.push(['slope', summary.slope], ['intercept', summary.intercept])
  }

  return Papa.unparse({ fields: ['metric', 'value'], data })
}

export function downloadCsv(filename: string, csv: string): void {
  if (!filename.trim()) {
    throw new Error('Filename is required.')
  }

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}
