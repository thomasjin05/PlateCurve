export type AssignmentType = 'blank' | 'standard' | 'sample'

export type CurveMode = 'linear' | '4pl' | 'custom'

export interface Well {
  id: string
  row: string
  column: number
  rawAbsorbance: number | null
}

export interface Assignment {
  type: AssignmentType
  groupId?: string
}

export interface StandardGroup {
  id: string
  concentration: number
  wellIds: string[]
}

export interface SampleGroup {
  id: string
  name: string
  dilutionFactor: number
  wellIds: string[]
}

export interface LinearFit {
  model: 'linear'
  slope: number
  intercept: number
  rSquared: number
}

export interface FourPLFit {
  model: '4pl'
  a: number
  b: number
  c: number
  d: number
  rSquared?: number
}

export interface ResultRow {
  wellId: string
  row: string
  column: number
  rawAbsorbance: number | null
  correctedAbsorbance: number | null
  assignmentType: AssignmentType | 'unused'
  standardConcentration: number | null
  sampleName: string
  calculatedConcentration: number | null
  dilutionFactor: number
  finalConcentration: number | null
  warningStatus: string
}

export interface PlateData {
  sourceRow: number
  sourceColumn: number
  wells: Well[]
}

export interface CurveSummary {
  model: CurveMode
  blankMean: number
  blankCount: number
  standardWellCount: number
  standardRange: string
  warnings: string[]
  slope?: number
  intercept?: number
  rSquared?: number
  a?: number
  b?: number
  c?: number
  d?: number
}

export interface AnalysisResult {
  rows: ResultRow[]
  summary: CurveSummary
  warnings: string[]
  fit?: LinearFit | FourPLFit
}
