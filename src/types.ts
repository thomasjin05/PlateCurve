export type AssignmentType = 'blank' | 'standard' | 'sample'

export type CurveMode = 'linear' | '4pl' | 'custom'

export interface Well {
  id: string
  row: string
  column: number
  value: number | null
}

export interface Assignment {
  wellId: string
  type: AssignmentType
  label: string
  concentration?: number
  dilution?: number
}

export interface StandardGroup {
  label: string
  concentration: number
  wellIds: string[]
  meanAbsorbance: number
}

export interface SampleGroup {
  label: string
  dilution: number
  wellIds: string[]
  meanAbsorbance: number
}

export interface LinearFit {
  mode: 'linear'
  slope: number
  intercept: number
  rSquared: number
}

export interface FourPLFit {
  mode: '4pl'
  bottom: number
  top: number
  ec50: number
  hillSlope: number
  rSquared: number
}

export interface ResultRow {
  sample: string
  meanAbsorbance: number
  concentration: number
  dilution: number
  finalConcentration: number
}

export interface PlateData {
  wells: Well[]
}

export interface CurveSummary {
  mode: CurveMode
  fit: LinearFit | FourPLFit | null
}

export interface AnalysisResult {
  blankMean: number
  standards: StandardGroup[]
  samples: SampleGroup[]
  curve: CurveSummary
  rows: ResultRow[]
}
