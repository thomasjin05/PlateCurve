import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CurveChart } from './components/CurveChart'
import { PlateGrid } from './components/PlateGrid'
import { ResultsView } from './components/ResultsView'
import type { AnalysisResult, Assignment, Well } from './types'

function makePlate(): Well[] {
  return Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => {
      const row = String.fromCharCode(65 + rowIndex)
      const column = columnIndex + 1
      return {
        id: `${row}${column}`,
        row,
        column,
        rawAbsorbance: rowIndex + column / 100,
      }
    }),
  ).flat()
}

describe('PlateGrid', () => {
  it('renders explicit coordinates and all 96 labeled assignment wells', () => {
    const assignments: Record<string, Assignment> = {
      A1: { type: 'blank' },
      B2: { type: 'standard', groupId: 'standard-1' },
      H12: { type: 'sample', groupId: 'sample-1' },
    }

    const markup = renderToStaticMarkup(
      <PlateGrid wells={makePlate()} assignments={assignments} />,
    )

    expect(markup).toContain('<table aria-label="96-well plate"')
    expect(markup).not.toContain('role="gridcell"')
    expect(markup).toContain('>Row<')
    for (const header of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      expect(markup).toContain(`>${header}<`)
    }
    for (let column = 1; column <= 12; column += 1) {
      expect(markup).toContain(`>${column}<`)
    }
    expect(markup.match(/data-well-id=/g)).toHaveLength(96)
    expect(markup).toContain('aria-label="A1, absorbance 0.01, assigned as blank"')
    expect(markup).toContain(
      'aria-label="B2, absorbance 1.02, assigned as standard group standard-1"',
    )
    expect(markup).toContain('plate-well blank')
    expect(markup).toContain('plate-well standard')
    expect(markup).toContain('plate-well sample')
  })
})

describe('CurveChart', () => {
  it('renders standard points, a fitted curve, and both axis labels', () => {
    const markup = renderToStaticMarkup(
      <CurveChart
        points={[
          { x: 0, y: 0.1 },
          { x: 5, y: 0.6 },
          { x: 10, y: 1.1 },
        ]}
        fit={{ model: 'linear', slope: 0.1, intercept: 0.1, rSquared: 1 }}
      />,
    )

    expect(markup).toContain('<svg')
    expect(markup).toContain('<path')
    expect(markup.match(/class="standard-point"/g)).toHaveLength(3)
    expect(markup).toContain('Standard concentration')
    expect(markup).toContain('Corrected absorbance')
  })
})

describe('ResultsView', () => {
  it('shows warnings before summary and the complete standardized result table', () => {
    const result: AnalysisResult = {
      warnings: ['Linear R² is below 0.98.'],
      summary: {
        model: 'linear',
        blankMean: 0.1,
        blankCount: 2,
        standardWellCount: 4,
        standardRange: '0 to 10',
        slope: 0.1,
        intercept: 0.05,
        rSquared: 0.97,
        warnings: ['Linear R² is below 0.98.'],
      },
      fit: { model: 'linear', slope: 0.1, intercept: 0.05, rSquared: 0.97 },
      rows: [
        {
          wellId: 'A1',
          row: 'A',
          column: 1,
          rawAbsorbance: 0.1,
          correctedAbsorbance: 0,
          assignmentType: 'standard',
          standardConcentration: 0,
          sampleName: '',
          calculatedConcentration: null,
          dilutionFactor: 1,
          finalConcentration: null,
          warningStatus: 'Replicate CV above 20%.',
        },
        {
          wellId: 'A2',
          row: 'A',
          column: 2,
          rawAbsorbance: 1.1,
          correctedAbsorbance: 1,
          assignmentType: 'standard',
          standardConcentration: 10,
          sampleName: '',
          calculatedConcentration: null,
          dilutionFactor: 1,
          finalConcentration: null,
          warningStatus: '',
        },
      ],
    }

    const markup = renderToStaticMarkup(<ResultsView result={result} />)
    const headers = [
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
    ]

    expect(markup.indexOf('Linear R² is below 0.98.')).toBeLessThan(
      markup.indexOf('Results summary'),
    )
    expect(markup.indexOf('Results summary')).toBeLessThan(markup.indexOf('<table'))
    expect(markup).toContain('<caption class="sr-only">Standardized ELISA results</caption>')
    expect(markup).toContain('Linear model')
    expect(markup).toContain('Blank mean')
    expect(markup).toContain('0 to 10')
    expect(markup).toContain('<table aria-label="96-well plate"')
    expect(markup).toContain('>H<')
    expect(markup).toContain('>12<')
    let previousIndex = -1
    for (const header of headers) {
      const index = markup.indexOf(`>${header}<`)
      expect(index).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
    expect(markup).toContain('>A1<')
    expect(markup).toContain('>Replicate CV above 20%.<')
  })
})
