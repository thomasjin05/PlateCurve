import { describe, expect, it } from 'vitest'

import type { Well } from '../types'
import {
  analyzePlate,
  calculateBlankMean,
  correctAbsorbance,
  evaluateFourPL,
  fitFourPL,
  fitLinear,
  invertFourPL,
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

  it('rejects a corrected absorbance that overflows', () => {
    expect(() => correctAbsorbance(Number.MAX_VALUE, -Number.MAX_VALUE)).toThrow(
      'Corrected absorbance must be finite.',
    )
  })

  it('rejects an empty blank selection', () => {
    expect(() => calculateBlankMean([])).toThrow('At least one blank value is required.')
  })

  it('rejects a blank mean that overflows', () => {
    expect(() => calculateBlankMean([Number.MAX_VALUE, Number.MAX_VALUE])).toThrow(
      'Blank mean must be finite.',
    )
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

  it('evaluates the 4PL curve at zero and its midpoint concentration', () => {
    const fit = { model: '4pl' as const, a: 10, b: 2, c: 5, d: 2 }

    expect(evaluateFourPL(0, fit)).toBe(10)
    expect(evaluateFourPL(fit.c, fit)).toBe(6)
  })

  it('rejects invalid 4PL evaluation inputs', () => {
    const fit = { model: '4pl' as const, a: 10, b: 2, c: 5, d: 2 }

    expect(() => evaluateFourPL(-1, fit)).toThrow()
    expect(() => evaluateFourPL(Number.NaN, fit)).toThrow()
    expect(() => evaluateFourPL(1, { ...fit, b: 0 })).toThrow()
    expect(() => evaluateFourPL(1, { ...fit, c: 0 })).toThrow()
    expect(() => evaluateFourPL(1, { ...fit, a: fit.d })).toThrow()
    expect(() => evaluateFourPL(1, { ...fit, d: Number.POSITIVE_INFINITY })).toThrow()
  })

  it('fits and inverts an exact descending 4PL curve', () => {
    const source = { model: '4pl' as const, a: 2.4, b: 1.3, c: 10, d: 0.2 }
    const concentrations = [0, 1, 3, 10, 30, 100]
    const points = concentrations.map((x) => ({ x, y: evaluateFourPL(x, source) }))

    const fit = fitFourPL(points)

    for (const point of points) {
      expect(evaluateFourPL(point.x, fit)).toBeCloseTo(point.y, 3)
    }
    const interiorX = 6
    expect(invertFourPL(evaluateFourPL(interiorX, source), fit)).toBeCloseTo(
      interiorX,
      1,
    )
  })

  it('fits an ascending 4PL curve', () => {
    const source = { model: '4pl' as const, a: 0.15, b: 1.6, c: 8, d: 2.5 }
    const points = [0, 1, 3, 10, 30, 100].map((x) => ({
      x,
      y: evaluateFourPL(x, source),
    }))

    const fit = fitFourPL(points)

    for (const point of points) {
      expect(evaluateFourPL(point.x, fit)).toBeCloseTo(point.y, 3)
    }
  })

  it('combines duplicate concentrations before fitting a 4PL curve', () => {
    const source = { model: '4pl' as const, a: 2.4, b: 1.3, c: 10, d: 0.2 }
    const points = [0, 1, 3, 10, 30, 100].flatMap((x) => {
      const y = evaluateFourPL(x, source)
      return [{ x, y: y - 0.001 }, { x, y: y + 0.001 }]
    })

    const fit = fitFourPL(points)

    expect(evaluateFourPL(10, fit)).toBeCloseTo(evaluateFourPL(10, source), 3)
  })

  it('rejects invalid 4PL fitting inputs', () => {
    expect(() =>
      fitFourPL([
        { x: 0, y: 4 },
        { x: 1, y: 3 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ]),
    ).toThrow('4PL fitting requires at least four unique concentrations.')
    expect(() =>
      fitFourPL([
        { x: -1, y: 4 },
        { x: 0, y: 3 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ]),
    ).toThrow('4PL concentrations must be finite and nonnegative.')
    expect(() =>
      fitFourPL([
        { x: 0, y: 4 },
        { x: 0, y: 3 },
        { x: 0, y: 2 },
        { x: 0, y: 1 },
      ]),
    ).toThrow('4PL fitting requires at least one positive concentration.')
    expect(() =>
      fitFourPL([
        { x: 0, y: 4 },
        { x: 1, y: 3 },
        { x: 2, y: Number.NaN },
        { x: 3, y: 1 },
      ]),
    ).toThrow('4PL responses must be finite.')
  })

  it('reports a numerical 4PL fitting failure cleanly', () => {
    expect(() =>
      fitFourPL([
        { x: 0, y: Number.MAX_VALUE },
        { x: 0, y: Number.MAX_VALUE },
        { x: 1, y: 3 },
        { x: 2, y: 2 },
        { x: 3, y: 1 },
      ]),
    ).toThrow('4PL fitting did not converge.')
  })

  it('inverts the finite 4PL endpoint to zero', () => {
    const descending = { model: '4pl' as const, a: 10, b: 2, c: 5, d: 2 }
    const ascending = { model: '4pl' as const, a: 2, b: 2, c: 5, d: 10 }

    expect(invertFourPL(descending.a, descending)).toBe(0)
    expect(invertFourPL(ascending.a, ascending)).toBe(0)
  })

  it('inverts an extreme finite 4PL endpoint without overflowing', () => {
    const fit = {
      model: '4pl' as const,
      a: Number.MAX_VALUE,
      b: 1,
      c: 1,
      d: -Number.MAX_VALUE,
    }

    expect(invertFourPL(fit.a, fit)).toBe(0)
  })

  it('rejects 4PL inverse values at an asymptote or outside the fitted range', () => {
    const fit = { model: '4pl' as const, a: 10, b: 2, c: 5, d: 2 }
    const message = 'Absorbance is outside the fitted 4PL range.'

    expect(() => invertFourPL(fit.d, fit)).toThrow(message)
    expect(() => invertFourPL(11, fit)).toThrow(message)
    expect(() => invertFourPL(1, fit)).toThrow(message)
    expect(() => invertFourPL(Number.NaN, fit)).toThrow(message)
    expect(() => invertFourPL(5, { ...fit, b: -1 })).toThrow()
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

  it('rejects nonfinite linear fit outputs caused by overflow', () => {
    expect(() =>
      fitLinear([
        { x: 0, y: 1e200 },
        { x: 1, y: 3e200 },
        { x: 2, y: 2e200 },
      ]),
    ).toThrow('Linear fit outputs must be finite.')
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

  it('calculates a diluted sample and 4PL summary from six standards', () => {
    const source = { model: '4pl' as const, a: 2.4, b: 1.3, c: 10, d: 0.2 }
    const concentrations = [0, 1, 3, 10, 30, 100]
    const sampleX = 6
    const wells = [
      ...concentrations.map((x, index) =>
        well(`A${index + 1}`, evaluateFourPL(x, source)),
      ),
      well('A7', evaluateFourPL(sampleX, source)),
    ]
    const assignments = Object.fromEntries([
      ...concentrations.map((_, index) => [
        `A${index + 1}`,
        { type: 'standard' as const, groupId: `std-${index}` },
      ]),
      ['A7', { type: 'sample' as const, groupId: 'sample-1' }],
    ])

    const result = analyzePlate({
      wells,
      assignments,
      standardGroups: concentrations.map((concentration, index) => ({
        id: `std-${index}`,
        concentration,
        wellIds: [`A${index + 1}`],
      })),
      sampleGroups: [
        { id: 'sample-1', name: 'Patient 1', dilutionFactor: 10, wellIds: ['A7'] },
      ],
      blank: { mode: 'none' },
      curve: { mode: '4pl' },
    })

    expect(result.rows[6].calculatedConcentration).toBeCloseTo(sampleX, 1)
    expect(result.rows[6].finalConcentration).toBeCloseTo(sampleX * 10, 0)
    expect(result.summary).toMatchObject({
      model: '4pl',
      blankCount: 0,
      standardWellCount: 6,
      standardRange: '0 to 100',
    })
    expect(result.summary.a).toBeTypeOf('number')
    expect(result.summary.b).toBeTypeOf('number')
    expect(result.summary.c).toBeTypeOf('number')
    expect(result.summary.d).toBeTypeOf('number')
    expect(result.fit).toMatchObject({ model: '4pl' })
    expect(result.warnings).not.toContain(
      '4PL fitting has fewer than 6 unique standard concentrations.',
    )
  })

  it('warns when 4PL fitting uses four or five unique standards', () => {
    const source = { model: '4pl' as const, a: 2.4, b: 1.3, c: 10, d: 0.2 }
    const warning = '4PL fitting has fewer than 6 unique standard concentrations.'

    for (const concentrations of [
      [0, 1, 10, 100],
      [0, 1, 3, 10, 100],
    ]) {
      const result = analyzePlate({
        wells: concentrations.map((x, index) =>
          well(`A${index + 1}`, evaluateFourPL(x, source)),
        ),
        assignments: Object.fromEntries(
          concentrations.map((_, index) => [
            `A${index + 1}`,
            { type: 'standard' as const, groupId: `std-${index}` },
          ]),
        ),
        standardGroups: concentrations.map((concentration, index) => ({
          id: `std-${index}`,
          concentration,
          wellIds: [`A${index + 1}`],
        })),
        sampleGroups: [],
        blank: { mode: 'none' },
        curve: { mode: '4pl' },
      })

      expect(result.warnings).toContain(warning)
      expect(result.summary.warnings).toContain(warning)
    }
  })

  it('warns on a 4PL sample outside the observed standard response range', () => {
    const source = { model: '4pl' as const, a: 2.4, b: 1.3, c: 10, d: 0.2 }
    const concentrations = [0, 1, 3, 10, 30, 100]
    const sampleWell = 'A7'
    const warning =
      'Sample A7 corrected absorbance is outside the observed standard response range.'

    const result = analyzePlate({
      wells: [
        ...concentrations.map((x, index) =>
          well(`A${index + 1}`, evaluateFourPL(x, source)),
        ),
        well(sampleWell, evaluateFourPL(200, source)),
      ],
      assignments: Object.fromEntries([
        ...concentrations.map((_, index) => [
          `A${index + 1}`,
          { type: 'standard' as const, groupId: `std-${index}` },
        ]),
        [sampleWell, { type: 'sample' as const, groupId: 'sample-1' }],
      ]),
      standardGroups: concentrations.map((concentration, index) => ({
        id: `std-${index}`,
        concentration,
        wellIds: [`A${index + 1}`],
      })),
      sampleGroups: [
        { id: 'sample-1', name: 'Patient 1', dilutionFactor: 1, wellIds: [sampleWell] },
      ],
      blank: { mode: 'none' },
      curve: { mode: '4pl' },
    })

    expect(result.rows[6].warningStatus).toContain(warning)
    expect(result.warnings).toContain(warning)
    expect(result.summary.warnings).toContain(warning)
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

  it('propagates a low linear R-squared warning to calculated sample rows', () => {
    const result = analyzePlate({
      wells: [well('A1', 0), well('A2', 2), well('A3', 2), well('A4', 1)],
      assignments: {
        A1: { type: 'standard', groupId: 'std-0' },
        A2: { type: 'standard', groupId: 'std-1' },
        A3: { type: 'standard', groupId: 'std-2' },
        A4: { type: 'sample', groupId: 'sample-1' },
      },
      standardGroups: [
        { id: 'std-0', concentration: 0, wellIds: ['A1'] },
        { id: 'std-1', concentration: 1, wellIds: ['A2'] },
        { id: 'std-2', concentration: 2, wellIds: ['A3'] },
      ],
      sampleGroups: [
        { id: 'sample-1', name: 'Patient 1', dilutionFactor: 1, wellIds: ['A4'] },
      ],
      blank: { mode: 'none' },
      curve: { mode: 'linear' },
    })

    expect(result.warnings).toContain('Linear R² is below 0.98.')
    expect(result.rows[3].warningStatus).toContain('Linear R² is below 0.98.')
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

  it('rejects a final sample concentration that overflows', () => {
    expect(() =>
      analyzePlate({
        wells: [well('A1', Number.MAX_VALUE)],
        assignments: { A1: { type: 'sample', groupId: 'sample-1' } },
        standardGroups: [],
        sampleGroups: [
          { id: 'sample-1', name: 'Patient 1', dilutionFactor: 2, wellIds: ['A1'] },
        ],
        blank: { mode: 'none' },
        curve: { mode: 'custom', slope: 1, intercept: 0 },
      }),
    ).toThrow('Sample A1 final concentration must be finite.')
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

  it('rejects a used standard group with a nonfinite concentration', () => {
    for (const concentration of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        analyzePlate({
          wells: [well('A1', 1)],
          assignments: { A1: { type: 'standard', groupId: 'std-invalid' } },
          standardGroups: [
            { id: 'std-invalid', concentration, wellIds: ['A1'] },
          ],
          sampleGroups: [],
          blank: { mode: 'none' },
          curve: { mode: 'custom', slope: 1, intercept: 0 },
        }),
      ).toThrow('Standard group std-invalid requires a finite concentration.')
    }
  })

  it('rejects a standard replicate mean that overflows', () => {
    expect(() =>
      analyzePlate({
        wells: [well('A1', Number.MAX_VALUE), well('A2', Number.MAX_VALUE)],
        assignments: {
          A1: { type: 'standard', groupId: 'std-1' },
          A2: { type: 'standard', groupId: 'std-1' },
        },
        standardGroups: [{ id: 'std-1', concentration: 1, wellIds: ['A1', 'A2'] }],
        sampleGroups: [],
        blank: { mode: 'none' },
        curve: { mode: 'custom', slope: 1, intercept: 0 },
      }),
    ).toThrow('Standard concentration 1 mean corrected absorbance must be finite.')
  })
})
