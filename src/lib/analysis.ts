import type {
  AnalysisResult,
  Assignment,
  LinearFit,
  ResultRow,
  SampleGroup,
  StandardGroup,
  Well,
} from '../types'

export type Point = { x: number; y: number }
export type BlankPolicy =
  | { mode: 'selected' }
  | { mode: 'manual'; value: number }
  | { mode: 'none' }
export type CurveConfig =
  | { mode: 'linear' }
  | { mode: 'custom'; slope: number; intercept: number }

export interface AnalyzeInput {
  wells: Well[]
  assignments: Record<string, Assignment>
  standardGroups: StandardGroup[]
  sampleGroups: SampleGroup[]
  blank: BlankPolicy
  curve: CurveConfig
}

export function calculateBlankMean(values: number[]): number {
  if (values.length === 0) {
    throw new Error('At least one blank value is required.')
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function correctAbsorbance(raw: number, blank: number): number {
  return raw - blank
}

export function fitLinear(points: Point[]): LinearFit {
  if (new Set(points.map((point) => point.x)).size < 2) {
    throw new Error('Linear fitting requires at least two unique x values.')
  }
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  const covariance = points.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
    0,
  )
  const varianceX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0)
  const slope = covariance / varianceX
  if (!Number.isFinite(slope) || slope === 0) {
    throw new Error('Linear slope must be finite and nonzero.')
  }
  const intercept = meanY - slope * meanX
  const residualSum = points.reduce(
    (sum, point) => sum + (point.y - (slope * point.x + intercept)) ** 2,
    0,
  )
  const totalSum = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0)
  const rSquared = totalSum === 0 ? 1 : 1 - residualSum / totalSum

  return { model: 'linear', slope, intercept, rSquared }
}

export function invertLinear(
  absorbance: number,
  fit: { slope: number; intercept: number },
): number {
  if (!Number.isFinite(fit.slope) || fit.slope === 0) {
    throw new Error('Linear slope must be finite and nonzero.')
  }
  const result = (absorbance - fit.intercept) / fit.slope
  if (!Number.isFinite(result)) {
    throw new Error('Linear inverse result must be finite.')
  }
  return result
}

export function analyzePlate(input: AnalyzeInput): AnalysisResult {
  if (input.blank.mode === 'manual' && !Number.isFinite(input.blank.value)) {
    throw new Error('Manual blank value must be finite.')
  }
  if (
    input.curve.mode === 'custom' &&
    (!Number.isFinite(input.curve.slope) || input.curve.slope === 0)
  ) {
    throw new Error('Custom curve slope must be finite and nonzero.')
  }
  if (input.curve.mode === 'custom' && !Number.isFinite(input.curve.intercept)) {
    throw new Error('Custom curve intercept must be finite.')
  }
  const warnings: string[] = []
  const blankValues =
    input.blank.mode === 'selected'
      ? input.wells.flatMap((well) =>
          input.assignments[well.id]?.type === 'blank' &&
          well.rawAbsorbance !== null &&
          Number.isFinite(well.rawAbsorbance)
            ? [well.rawAbsorbance]
            : [],
        )
      : []
  let blankMean: number
  if (input.blank.mode === 'selected') {
    blankMean = calculateBlankMean(blankValues)
  } else if (input.blank.mode === 'manual') {
    blankMean = input.blank.value
    warnings.push('Manual blank value used.')
  } else {
    blankMean = 0
    warnings.push('No blank correction applied.')
  }
  if (input.curve.mode === 'custom') {
    warnings.push('calculated using user-provided equation')
  }
  const sampleGroups = new Map(input.sampleGroups.map((group) => [group.id, group]))
  const standardGroups = new Map(input.standardGroups.map((group) => [group.id, group]))
  for (const group of input.sampleGroups) {
    if (!Number.isFinite(group.dilutionFactor) || group.dilutionFactor <= 0) {
      throw new Error(
        `Sample group ${group.id} requires a finite dilution factor greater than zero.`,
      )
    }
  }
  for (const well of input.wells) {
    const assignment = input.assignments[well.id]
    if (
      assignment?.type === 'standard' &&
      (!assignment.groupId || !standardGroups.has(assignment.groupId))
    ) {
      throw new Error(`Standard well ${well.id} must reference a known standard group.`)
    }
    if (
      assignment?.type === 'sample' &&
      (!assignment.groupId || !sampleGroups.has(assignment.groupId))
    ) {
      throw new Error(`Sample well ${well.id} must reference a known sample group.`)
    }
  }
  const standardValues = new Map<number, number[]>()
  for (const well of input.wells) {
    const assignment = input.assignments[well.id]
    const group =
      assignment?.type === 'standard' && assignment.groupId
        ? standardGroups.get(assignment.groupId)
        : undefined
    if (group && well.rawAbsorbance !== null && Number.isFinite(well.rawAbsorbance)) {
      const values = standardValues.get(group.concentration) ?? []
      values.push(correctAbsorbance(well.rawAbsorbance, blankMean))
      standardValues.set(group.concentration, values)
    }
  }
  const standardPoints = [...standardValues.entries()]
    .sort(([left], [right]) => left - right)
    .map(([x, values]) => ({ x, y: calculateBlankMean(values) }))
  const fit = input.curve.mode === 'linear' ? fitLinear(standardPoints) : undefined
  if (fit && fit.rSquared < 0.98) {
    warnings.push('Linear R² is below 0.98.')
  }
  const standardWarnings = new Map<number, string>()
  for (const [concentration, values] of standardValues) {
    const mean = calculateBlankMean(values)
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    const warning =
      mean !== 0 && Math.sqrt(variance) / Math.abs(mean) > 0.2
        ? `Standard concentration ${concentration} has replicate CV above 20%.`
        : mean === 0 && values.some((value) => Math.abs(value) > 0.05)
          ? `Standard concentration ${concentration} has inconsistent replicates around zero.`
          : undefined
    if (warning) {
      standardWarnings.set(concentration, warning)
      warnings.push(warning)
    }
  }
  const responseValues = standardPoints.map((point) => point.y)
  const minimumResponse = Math.min(...responseValues)
  const maximumResponse = Math.max(...responseValues)
  const standardRange =
    standardPoints.length === 0
      ? ''
      : `${standardPoints[0].x} to ${standardPoints[standardPoints.length - 1].x}`
  const rows: ResultRow[] = input.wells.map((well) => {
    const assignment = input.assignments[well.id]
    const rawAbsorbance =
      well.rawAbsorbance !== null && Number.isFinite(well.rawAbsorbance)
        ? well.rawAbsorbance
        : null

    const correctedAbsorbance =
      rawAbsorbance === null ? null : correctAbsorbance(rawAbsorbance, blankMean)
    const sampleGroup =
      assignment?.type === 'sample' && assignment.groupId
        ? sampleGroups.get(assignment.groupId)
        : undefined
    const calculatedConcentration =
      sampleGroup && correctedAbsorbance !== null
        ? invertLinear(correctedAbsorbance, input.curve.mode === 'custom' ? input.curve : fit!)
        : null
    const standardGroup =
      assignment?.type === 'standard' && assignment.groupId
        ? standardGroups.get(assignment.groupId)
        : undefined
    const rowWarnings: string[] = []
    if (standardGroup) {
      const warning = standardWarnings.get(standardGroup.concentration)
      if (warning) rowWarnings.push(warning)
    }
    if (
      fit &&
      sampleGroup &&
      correctedAbsorbance !== null &&
      (correctedAbsorbance < minimumResponse || correctedAbsorbance > maximumResponse)
    ) {
      const warning = `Sample ${well.id} corrected absorbance is outside the observed standard response range.`
      rowWarnings.push(warning)
      warnings.push(warning)
    }

    return {
      wellId: well.id,
      row: well.row,
      column: well.column,
      rawAbsorbance,
      correctedAbsorbance,
      assignmentType: assignment?.type ?? 'unused',
      standardConcentration: standardGroup?.concentration ?? null,
      sampleName: sampleGroup?.name ?? '',
      calculatedConcentration,
      dilutionFactor: sampleGroup?.dilutionFactor ?? 1,
      finalConcentration:
        calculatedConcentration === null || !sampleGroup
          ? null
          : calculatedConcentration * sampleGroup.dilutionFactor,
      warningStatus: rowWarnings.join('; '),
    }
  })

  return {
    rows,
    summary: {
      model: input.curve.mode,
      blankMean,
      blankCount: blankValues.length,
      standardWellCount: [...standardValues.values()].reduce(
        (count, values) => count + values.length,
        0,
      ),
      standardRange,
      warnings: [...new Set(warnings)],
      ...(fit
        ? { slope: fit.slope, intercept: fit.intercept, rSquared: fit.rSquared }
        : input.curve.mode === 'custom'
        ? { slope: input.curve.slope, intercept: input.curve.intercept }
        : {}),
    },
    warnings: [...new Set(warnings)],
    fit,
  }
}
