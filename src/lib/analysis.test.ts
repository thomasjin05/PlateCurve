import { describe, expect, it } from 'vitest'

import type { Well } from '../types'
import {
  analyzePlate,
  calculateBlankMean,
  correctAbsorbance,
  fitLinear,
  invertLinear,
} from './analysis'

function well(id: string, rawAbsorbance: number | null): Well {
  return { id, row: id[0], column: Number(id.slice(1)), rawAbsorbance }
}

function plate96(): Well[] {
  return Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => {
      const row = String.fromCharCode(65 + rowIndex)
      return well(`${row}${columnIndex + 1}`, 0)
    }),
  ).flat()
}

describe('analysis calculations', () => {
  it('calculates a blank mean and subtracts it from raw absorbance', () => {
    const blank = calculateBlankMean([0.1, 0.2, 0.3])

    expect(blank).toBeCloseTo(0.2)
    expect(correctAbsorbance(1.2, blank)).toBeCloseTo(1)
  })

  it('rejects an empty blank selection', () => {
    expect(() => calculateBlankMean([])).toThrow('At least one blank value is required.')
  })

  it('fits and inverts a linear calibration', () => {
    const fit = fitLinear([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ])

    expect(fit).toEqual({ model: 'linear', slope: 2, intercept: 1, rSquared: 1 })
    expect(invertLinear(4, fit)).toBe(1.5)
  })

  it('requires at least two unique x values for a linear fit', () => {
    expect(() =>
      fitLinear([
        { x: 1, y: 2 },
        { x: 1, y: 4 },
      ]),
    ).toThrow('Linear fitting requires at least two unique x values.')
  })

  it('rejects zero slopes for fitted and supplied linear equations', () => {
    expect(() =>
      fitLinear([
        { x: 0, y: 2 },
        { x: 1, y: 2 },
      ]),
    ).toThrow('Linear slope must be finite and nonzero.')
    expect(() => invertLinear(4, { slope: 0, intercept: 1 })).toThrow(
      'Linear slope must be finite and nonzero.',
    )
  })

  it('rejects a nonfinite inverse result', () => {
    expect(() =>
      invertLinear(Number.POSITIVE_INFINITY, { slope: 1, intercept: 0 }),
    ).toThrow('Linear inverse result must be finite.')
  })

  it('uses selected blank wells to correct every valid absorbance', () => {
    const result = analyzePlate({
      wells: [well('A1', 0.1), well('A2', 0.3), well('A3', 1), well('A4', null)],
      assignments: { A1: { type: 'blank' }, A2: { type: 'blank' } },
      standardGroups: [],
      sampleGroups: [],
      blank: { mode: 'selected' },
      curve: { mode: 'custom', slope: 1, intercept: 0 },
    })

    expect(result.summary.blankMean).toBeCloseTo(0.2)
    expect(result.summary.blankCount).toBe(2)
    expect(result.rows.map((row) => row.correctedAbsorbance)).toEqual([
      -0.1,
      0.09999999999999998,
      0.8,
      null,
    ])
  })

  it('uses a manual blank value and records its provenance', () => {
    const result = analyzePlate({
      wells: [well('A1', 1)],
      assignments: {},
      standardGroups: [],
      sampleGroups: [],
      blank: { mode: 'manual', value: 0.25 },
      curve: { mode: 'custom', slope: 1, intercept: 0 },
    })

    expect(result.summary.blankMean).toBe(0.25)
    expect(result.summary.blankCount).toBe(0)
    expect(result.rows[0].correctedAbsorbance).toBe(0.75)
    expect(result.warnings).toContain('Manual blank value used.')
  })

  it('can skip blank correction with an explicit warning', () => {
    const result = analyzePlate({
      wells: [well('A1', 1)],
      assignments: {},
      standardGroups: [],
      sampleGroups: [],
      blank: { mode: 'none' },
      curve: { mode: 'custom', slope: 1, intercept: 0 },
    })

    expect(result.summary.blankMean).toBe(0)
    expect(result.summary.blankCount).toBe(0)
    expect(result.rows[0].correctedAbsorbance).toBe(1)
    expect(result.warnings).toContain('No blank correction applied.')
  })

  it('calculates a diluted sample with a user-provided equation', () => {
    const result = analyzePlate({
      wells: [well('A1', 5)],
      assignments: { A1: { type: 'sample', groupId: 'sample-1' } },
      standardGroups: [],
      sampleGroups: [
        { id: 'sample-1', name: 'Patient 1', dilutionFactor: 10, wellIds: ['A1'] },
      ],
      blank: { mode: 'none' },
      curve: { mode: 'custom', slope: 2, intercept: 1 },
    })

    expect(result.rows[0]).toMatchObject({
      sampleName: 'Patient 1',
      calculatedConcentration: 2,
      dilutionFactor: 10,
      finalConcentration: 20,
    })
    expect(result.summary).toMatchObject({ model: 'custom', slope: 2, intercept: 1 })
    expect(result.summary.warnings).toContain('calculated using user-provided equation')
  })

  it('returns all 96 wells in order with linear sample concentrations', () => {
    const wells = plate96()
    wells[0].rawAbsorbance = 1
    wells[1].rawAbsorbance = 1
    wells[2].rawAbsorbance = 3
    wells[3].rawAbsorbance = 3
    wells[4].rawAbsorbance = 4
    wells[95].rawAbsorbance = null

    const result = analyzePlate({
      wells,
      assignments: {
        A1: { type: 'standard', groupId: 'std-0' },
        A2: { type: 'standard', groupId: 'std-0' },
        A3: { type: 'standard', groupId: 'std-1' },
        A4: { type: 'standard', groupId: 'std-1' },
        A5: { type: 'sample', groupId: 'sample-1' },
      },
      standardGroups: [
        { id: 'std-0', concentration: 0, wellIds: ['A1', 'A2'] },
        { id: 'std-1', concentration: 1, wellIds: ['A3', 'A4'] },
      ],
      sampleGroups: [
        { id: 'sample-1', name: 'Patient 1', dilutionFactor: 10, wellIds: ['A5'] },
      ],
      blank: { mode: 'none' },
      curve: { mode: 'linear' },
    })

    expect(result.rows).toHaveLength(96)
    expect(result.rows.map((row) => row.wellId)).toEqual(wells.map((item) => item.id))
    expect(result.rows[0].standardConcentration).toBe(0)
    expect(result.rows[4]).toMatchObject({
      calculatedConcentration: 1.5,
      dilutionFactor: 10,
      finalConcentration: 15,
    })
    expect(result.rows[95]).toMatchObject({
      rawAbsorbance: null,
      correctedAbsorbance: null,
      calculatedConcentration: null,
      finalConcentration: null,
    })
    expect(result.summary).toMatchObject({
      model: 'linear',
      standardWellCount: 4,
      standardRange: '0 to 1',
      slope: 2,
      intercept: 1,
      rSquared: 1,
    })
    expect(result.fit).toMatchObject({ slope: 2, intercept: 1, rSquared: 1 })
  })

  it('reports linear fit, replicate, and sample range warnings on affected rows', () => {
    const result = analyzePlate({
      wells: [
        well('A1', 0),
        well('A2', 0),
        well('A3', 1),
        well('A4', 3),
        well('A5', 2),
        well('A6', 2),
        well('A7', 5),
      ],
      assignments: {
        A1: { type: 'standard', groupId: 'std-0' },
        A2: { type: 'standard', groupId: 'std-0' },
        A3: { type: 'standard', groupId: 'std-1' },
        A4: { type: 'standard', groupId: 'std-1' },
        A5: { type: 'standard', groupId: 'std-2' },
        A6: { type: 'standard', groupId: 'std-2' },
        A7: { type: 'sample', groupId: 'sample-1' },
      },
      standardGroups: [
        { id: 'std-0', concentration: 0, wellIds: ['A1', 'A2'] },
        { id: 'std-1', concentration: 1, wellIds: ['A3', 'A4'] },
        { id: 'std-2', concentration: 2, wellIds: ['A5', 'A6'] },
      ],
      sampleGroups: [
        { id: 'sample-1', name: 'Patient 1', dilutionFactor: 1, wellIds: ['A7'] },
      ],
      blank: { mode: 'none' },
      curve: { mode: 'linear' },
    })

    expect(result.warnings).toContain('Linear R² is below 0.98.')
    expect(result.warnings).toContain('Standard concentration 1 has replicate CV above 20%.')
    expect(result.warnings).toContain(
      'Sample A7 corrected absorbance is outside the observed standard response range.',
    )
    expect(result.rows[2].warningStatus).toContain('Standard concentration 1')
    expect(result.rows[3].warningStatus).toContain('Standard concentration 1')
    expect(result.rows[6].warningStatus).toContain('outside the observed standard response range')
    expect(new Set(result.warnings).size).toBe(result.warnings.length)
  })

  it('rejects assignments without known group metadata', () => {
    const base = {
      wells: [well('A1', 1)],
      standardGroups: [],
      sampleGroups: [],
      blank: { mode: 'none' as const },
      curve: { mode: 'custom' as const, slope: 1, intercept: 0 },
    }

    expect(() =>
      analyzePlate({ ...base, assignments: { A1: { type: 'standard' } } }),
    ).toThrow('Standard well A1 must reference a known standard group.')
    expect(() =>
      analyzePlate({ ...base, assignments: { A1: { type: 'sample', groupId: 'missing' } } }),
    ).toThrow('Sample well A1 must reference a known sample group.')
  })

  it('rejects a nonpositive sample dilution factor', () => {
    expect(() =>
      analyzePlate({
        wells: [well('A1', 1)],
        assignments: { A1: { type: 'sample', groupId: 'sample-1' } },
        standardGroups: [],
        sampleGroups: [
          { id: 'sample-1', name: 'Patient 1', dilutionFactor: 0, wellIds: ['A1'] },
        ],
        blank: { mode: 'none' },
        curve: { mode: 'custom', slope: 1, intercept: 0 },
      }),
    ).toThrow('Sample group sample-1 requires a finite dilution factor greater than zero.')
  })

  it('rejects nonfinite blank and custom curve configuration', () => {
    const base = {
      wells: [well('A1', 1)],
      assignments: {},
      standardGroups: [],
      sampleGroups: [],
    }

    expect(() =>
      analyzePlate({
        ...base,
        blank: { mode: 'manual', value: Number.NaN },
        curve: { mode: 'custom', slope: 1, intercept: 0 },
      }),
    ).toThrow('Manual blank value must be finite.')
    expect(() =>
      analyzePlate({
        ...base,
        blank: { mode: 'none' },
        curve: { mode: 'custom', slope: 0, intercept: 0 },
      }),
    ).toThrow('Custom curve slope must be finite and nonzero.')
    expect(() =>
      analyzePlate({
        ...base,
        blank: { mode: 'none' },
        curve: { mode: 'custom', slope: 1, intercept: Number.POSITIVE_INFINITY },
      }),
    ).toThrow('Custom curve intercept must be finite.')
  })
})
