import { useEffect, useState } from 'react'

import { PlateGrid } from './components/PlateGrid'
import { ResultPlate, ResultsView } from './components/ResultsView'
import { analyzePlate, type BlankPolicy, type CurveConfig } from './lib/analysis'
import { downloadCsv, resultsToCsv, summaryToCsv } from './lib/export'
import { extractPlate } from './lib/plate'
import { parseInputFile, type ImportedTable } from './lib/spreadsheet'
import type {
  AnalysisResult,
  Assignment,
  AssignmentType,
  CurveMode,
  PlateData,
  SampleGroup,
  StandardGroup,
} from './types'

const STEPS = [
  'Upload CSV',
  'Confirm plate',
  'Assign wells',
  'Configure curve',
  'Results',
  'Export',
] as const

export const CUSTOM_EQUATION_HELP =
  'Corrected absorbance (y) = slope (m) × concentration (x) + intercept (b). The app solves this equation for x to calculate sample concentration.'

export const CUSTOM_4PL_EQUATION_HELP =
  'Corrected absorbance (y) = d + (a - d) / (1 + (concentration (x) / c)^b). Enter a, b, c, and d from a validated 4PL curve; b and c must be greater than 0.'

export function maximumReachableStep(state: {
  imported: boolean
  plate: boolean
  hasSample: boolean
  result: boolean
}): number {
  if (state.result) return 6
  if (state.plate && state.hasSample) return 4
  if (state.plate) return 3
  if (state.imported) return 2
  return 1
}

type Tool = AssignmentType | 'clear'

export type AssignmentWorkspace = {
  assignments: Record<string, Assignment>
  standardGroups: StandardGroup[]
  sampleGroups: SampleGroup[]
  activeStandardId: string
  activeSampleId: string
}

export type AssignmentHistory = {
  past: AssignmentWorkspace[]
  future: AssignmentWorkspace[]
}

export type GroupDrafts = {
  standardConcentrations: Record<string, string>
  sampleNames: Record<string, string>
  sampleDilutions: Record<string, string>
}

const EMPTY_WORKSPACE: AssignmentWorkspace = {
  assignments: {},
  standardGroups: [],
  sampleGroups: [],
  activeStandardId: '',
  activeSampleId: '',
}

const EMPTY_ASSIGNMENT_HISTORY: AssignmentHistory = {
  past: [],
  future: [],
}

const EMPTY_GROUP_DRAFTS: GroupDrafts = {
  standardConcentrations: {},
  sampleNames: {},
  sampleDilutions: {},
}

const DEMO_FILE_NAME = 'platecurve-demo.xlsx'
const DEMO_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DEMO_STANDARD_CONCENTRATIONS = [0, 0.625, 1.25, 2.5, 5, 10, 20]
const DEMO_PLATE_VALUES = [
  [0.061, 0.058, 0.342, 0.355, 0.611, 0.598, 0.833, 0.821, 1.014, 1.036, 1.23, 1.205],
  [0.071, 0.073, 0.394, 0.388, 0.644, 0.659, 0.872, 0.861, 1.081, 1.067, 1.284, 1.301],
  [0.132, 0.129, 0.376, 0.389, 0.591, 0.606, 0.799, 0.817, 1.006, 1.017, 1.218, 1.206],
  [0.235, 0.24, 0.365, 0.372, 0.553, 0.568, 0.781, 0.766, 0.948, 0.961, 1.174, 1.166],
  [0.421, 0.43, 0.355, 0.347, 0.529, 0.538, 0.742, 0.731, 0.918, 0.904, 1.109, 1.124],
  [0.798, 0.782, 0.331, 0.346, 0.503, 0.491, 0.708, 0.721, 0.884, 0.897, 1.061, 1.075],
  [1.312, 1.334, 0.318, 0.327, 0.479, 0.486, 0.673, 0.681, 0.849, 0.862, 1.025, 1.014],
  [1.873, 1.846, 0.301, 0.314, 0.452, 0.466, 0.638, 0.649, 0.817, 0.806, 0.981, 0.996],
]
const DEMO_ROWS: string[][] = [
  ['PlateCurve demo workbook'],
  ['Assay', 'Colorimetric demo'],
  ['', '', ...Array.from({ length: 12 }, (_, column) => String(column + 1))],
  ...DEMO_PLATE_VALUES.map((values, rowIndex) => [
    '',
    String.fromCharCode(65 + rowIndex),
    ...values.map((value) => String(value)),
  ]),
]

export type DemoAnalysisSetup = {
  fileName: string
  imported: ImportedTable
  plate: PlateData
  workspace: AssignmentWorkspace
  tool: Tool
}

export function createDemoAnalysisSetup(): DemoAnalysisSetup {
  const imported: ImportedTable = { rows: DEMO_ROWS, format: 'xlsx' }
  const plate = extractPlate(imported.rows)
  const standardGroups = DEMO_STANDARD_CONCENTRATIONS.map((concentration, index) => {
    const row = String.fromCharCode(66 + index)
    return {
      id: `standard-${index + 1}`,
      concentration,
      wellIds: [`${row}1`, `${row}2`],
    }
  })
  const sampleGroups: SampleGroup[] = [
    { id: 'sample-1', name: 'Demo sample', dilutionFactor: 1, wellIds: [] },
  ]
  const assignments: Record<string, Assignment> = {
    A1: { type: 'blank' },
    A2: { type: 'blank' },
  }
  for (const group of standardGroups) {
    for (const wellId of group.wellIds) assignments[wellId] = { type: 'standard', groupId: group.id }
  }

  return {
    fileName: DEMO_FILE_NAME,
    imported,
    plate,
    workspace: {
      assignments,
      standardGroups,
      sampleGroups,
      activeStandardId: standardGroups[0].id,
      activeSampleId: sampleGroups[0].id,
    },
    tool: 'sample',
  }
}

function assignmentsEqual(
  left: Record<string, Assignment>,
  right: Record<string, Assignment>,
): boolean {
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every(
    (wellId) =>
      left[wellId]?.type === right[wellId]?.type &&
      left[wellId]?.groupId === right[wellId]?.groupId,
  )
}

export function recordWorkspaceHistory(
  history: AssignmentHistory,
  previous: AssignmentWorkspace,
  next: AssignmentWorkspace,
): AssignmentHistory {
  if (assignmentsEqual(previous.assignments, next.assignments)) return history
  return { past: [...history.past, previous], future: [] }
}

export function undoWorkspace(
  history: AssignmentHistory,
  current: AssignmentWorkspace,
): { workspace: AssignmentWorkspace; history: AssignmentHistory } {
  const previous = history.past.at(-1)
  if (!previous) return { workspace: current, history }
  return {
    workspace: previous,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
    },
  }
}

export function redoWorkspace(
  history: AssignmentHistory,
  current: AssignmentWorkspace,
): { workspace: AssignmentWorkspace; history: AssignmentHistory } {
  const next = history.future[0]
  if (!next) return { workspace: current, history }
  return {
    workspace: next,
    history: {
      past: [...history.past, current],
      future: history.future.slice(1),
    },
  }
}

function syncGroupWells(
  workspace: AssignmentWorkspace,
  assignments: Record<string, Assignment>,
): AssignmentWorkspace {
  const standardIds = new Map(workspace.standardGroups.map((group) => [group.id, [] as string[]]))
  const sampleIds = new Map(workspace.sampleGroups.map((group) => [group.id, [] as string[]]))
  for (const [wellId, assignment] of Object.entries(assignments)) {
    if (assignment.type === 'standard' && assignment.groupId) {
      standardIds.get(assignment.groupId)?.push(wellId)
    } else if (assignment.type === 'sample' && assignment.groupId) {
      sampleIds.get(assignment.groupId)?.push(wellId)
    }
  }
  return {
    ...workspace,
    assignments,
    standardGroups: workspace.standardGroups.map((group) => ({
      ...group,
      wellIds: standardIds.get(group.id) ?? [],
    })),
    sampleGroups: workspace.sampleGroups.map((group) => ({
      ...group,
      wellIds: sampleIds.get(group.id) ?? [],
    })),
  }
}

function nextGroupId(prefix: string, ids: string[]): string {
  let index = 1
  const used = new Set(ids)
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

export function countUniqueAssignedStandardConcentrations(
  groups: readonly StandardGroup[],
  drafts: Readonly<Record<string, string>> = {},
): number {
  return new Set(
    groups.flatMap((group) => {
      if (group.wellIds.length === 0) return []
      const concentration = parseRequiredNumber(
        drafts[group.id] ?? String(group.concentration),
      )
      return Number.isFinite(concentration) ? [concentration] : []
    }),
  ).size
}

function parseRequiredNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}

export function resolveGroupDrafts(
  standardGroups: readonly StandardGroup[],
  sampleGroups: readonly SampleGroup[],
  drafts: GroupDrafts,
): { standardGroups: StandardGroup[]; sampleGroups: SampleGroup[] } {
  return {
    standardGroups: standardGroups.map((group) => {
      const concentration = parseRequiredNumber(
        drafts.standardConcentrations[group.id] ?? String(group.concentration),
      )
      if (!Number.isFinite(concentration)) {
        throw new Error(`Standard ${group.id} concentration must be a finite number.`)
      }
      return { ...group, concentration }
    }),
    sampleGroups: sampleGroups.map((group) => {
      const name = (drafts.sampleNames[group.id] ?? group.name).trim()
      if (!name) throw new Error(`Sample ${group.id} name is required.`)
      const dilutionFactor = parseRequiredNumber(
        drafts.sampleDilutions[group.id] ?? String(group.dilutionFactor),
      )
      if (!Number.isFinite(dilutionFactor) || dilutionFactor <= 0) {
        throw new Error(`Sample ${group.id} dilution factor must be greater than zero.`)
      }
      return { ...group, name, dilutionFactor }
    }),
  }
}

function spreadsheetColumn(column: number): string {
  let value = column
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

function plateSourceLabel(format: ImportedTable['format'], plate: PlateData): string {
  const source = format === 'csv' ? 'CSV' : 'Workbook'
  return `${source} rows ${plate.sourceRow + 1}–${plate.sourceRow + 8}, columns ${spreadsheetColumn(plate.sourceColumn + 1)}–${spreadsheetColumn(plate.sourceColumn + 12)}`
}

function curveModeLabel(mode: CurveMode): string {
  if (mode === '4pl') return '4PL model'
  if (mode === 'custom-4pl') return 'Custom 4PL equation'
  if (mode === 'linear') return 'Linear model'
  return 'Custom equation'
}

function isEditingText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function parseWellId(wellId: string): { rowIndex: number; column: number } | null {
  const match = /^([A-H])([1-9]|1[0-2])$/.exec(wellId)
  return match
    ? { rowIndex: match[1].charCodeAt(0) - 65, column: Number(match[2]) }
    : null
}

export function wellIdsInRange(
  start: string,
  end: string,
  selectableWellIds: ReadonlySet<string>,
): string[] {
  const first = parseWellId(start)
  const last = parseWellId(end)
  if (!first || !last) return selectableWellIds.has(end) ? [end] : []

  const wellIds: string[] = []
  for (
    let rowIndex = Math.min(first.rowIndex, last.rowIndex);
    rowIndex <= Math.max(first.rowIndex, last.rowIndex);
    rowIndex += 1
  ) {
    const row = String.fromCharCode(65 + rowIndex)
    for (
      let column = Math.min(first.column, last.column);
      column <= Math.max(first.column, last.column);
      column += 1
    ) {
      const wellId = `${row}${column}`
      if (selectableWellIds.has(wellId)) wellIds.push(wellId)
    }
  }
  return wellIds
}

function NavActions({
  back,
  continueAction,
  continueDisabled = false,
  continueLabel,
}: {
  back?: () => void
  continueAction?: () => void
  continueDisabled?: boolean
  continueLabel?: string
}) {
  return (
    <div className="nav-actions">
      {back ? <button className="secondary-button" onClick={back} type="button">Back</button> : <span />}
      {continueAction && continueLabel && (
        <button
          className="primary-button"
          disabled={continueDisabled}
          onClick={continueAction}
          type="button"
        >
          {continueLabel}
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [step, setStep] = useState(1)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [fileName, setFileName] = useState('')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [imported, setImported] = useState<ImportedTable | null>(null)
  const [plate, setPlate] = useState<PlateData | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [regionOpen, setRegionOpen] = useState(false)
  const [regionRow, setRegionRow] = useState('1')
  const [regionColumn, setRegionColumn] = useState('1')
  const [regionError, setRegionError] = useState('')
  const [workspace, setWorkspace] = useState<AssignmentWorkspace>(EMPTY_WORKSPACE)
  const [assignmentHistory, setAssignmentHistory] = useState<AssignmentHistory>(
    EMPTY_ASSIGNMENT_HISTORY,
  )
  const [groupDrafts, setGroupDrafts] = useState<GroupDrafts>(EMPTY_GROUP_DRAFTS)
  const [tool, setTool] = useState<Tool>('blank')
  const [newStandard, setNewStandard] = useState('')
  const [newSampleName, setNewSampleName] = useState('')
  const [newDilution, setNewDilution] = useState('1')
  const [groupError, setGroupError] = useState('')
  const [lastSelectedWell, setLastSelectedWell] = useState('')
  const [blankMode, setBlankMode] = useState<BlankPolicy['mode']>('selected')
  const [manualBlank, setManualBlank] = useState('')
  const [curveMode, setCurveMode] = useState<CurveMode>('linear')
  const [customSlope, setCustomSlope] = useState('')
  const [customIntercept, setCustomIntercept] = useState('')
  const [custom4plA, setCustom4plA] = useState('')
  const [custom4plB, setCustom4plB] = useState('')
  const [custom4plC, setCustom4plC] = useState('')
  const [custom4plD, setCustom4plD] = useState('')
  const [analysisError, setAnalysisError] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [excelExporting, setExcelExporting] = useState(false)
  const [excelExportError, setExcelExportError] = useState('')

  const clearResult = () => {
    setResult(null)
    setExcelExportError('')
  }

  const resetAfterPlate = () => {
    setWorkspace(EMPTY_WORKSPACE)
    setAssignmentHistory(EMPTY_ASSIGNMENT_HISTORY)
    setGroupDrafts(EMPTY_GROUP_DRAFTS)
    setTool('blank')
    setNewStandard('')
    setNewSampleName('')
    setNewDilution('1')
    setGroupError('')
    setLastSelectedWell('')
    setBlankMode('selected')
    setManualBlank('')
    setCurveMode('linear')
    setCustomSlope('')
    setCustomIntercept('')
    setCustom4plA('')
    setCustom4plB('')
    setCustom4plC('')
    setCustom4plD('')
    setAnalysisError('')
    setResult(null)
  }

  const startNewAnalysis = () => {
    setStep(1)
    setFileInputKey((value) => value + 1)
    setFileName('')
    setSourceFile(null)
    setImported(null)
    setPlate(null)
    setLoading(false)
    setUploadError('')
    setExcelExporting(false)
    setExcelExportError('')
    setRegionOpen(false)
    setRegionRow('1')
    setRegionColumn('1')
    setRegionError('')
    resetAfterPlate()
  }

  const loadDemo = () => {
    const demo = createDemoAnalysisSetup()

    resetAfterPlate()
    setStep(3)
    setFileInputKey((value) => value + 1)
    setFileName(demo.fileName)
    setSourceFile(
      new File(['PlateCurve demo workbook'], demo.fileName, { type: DEMO_XLSX_MIME }),
    )
    setImported(demo.imported)
    setPlate(demo.plate)
    setLoading(false)
    setUploadError('')
    setExcelExporting(false)
    setExcelExportError('')
    setRegionOpen(false)
    setRegionRow(String(demo.plate.sourceRow + 1))
    setRegionColumn(String(demo.plate.sourceColumn + 1))
    setRegionError('')
    setWorkspace(demo.workspace)
    setTool(demo.tool)
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setFileInputKey((value) => value + 1)

    setStep(1)
    setFileName(file.name)
    setSourceFile(null)
    setImported(null)
    setPlate(null)
    setLoading(true)
    setUploadError('')
    setRegionOpen(false)
    setRegionRow('1')
    setRegionColumn('1')
    setRegionError('')
    resetAfterPlate()

    try {
      const table = await parseInputFile(file)
      setSourceFile(file)
      setImported(table)
      try {
        const detected = extractPlate(table.rows)
        setPlate(detected)
        setRegionRow(String(detected.sourceRow + 1))
        setRegionColumn(String(detected.sourceColumn + 1))
      } catch {
        setRegionOpen(true)
        setRegionError('Automatic detection did not find a plate. Enter the top-left numeric cell below.')
      }
      setStep(2)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const applyRegion = () => {
    if (!imported) return
    const row = parseRequiredNumber(regionRow)
    const column = parseRequiredNumber(regionColumn)
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1) {
      setRegionError('Top-left row and column must be whole numbers starting at 1.')
      return
    }
    try {
      const nextPlate = extractPlate(imported.rows, {
        sourceRow: row - 1,
        sourceColumn: column - 1,
      })
      const regionChanged =
        !plate ||
        plate.sourceRow !== nextPlate.sourceRow ||
        plate.sourceColumn !== nextPlate.sourceColumn
      setPlate(nextPlate)
      setRegionError('')
      if (regionChanged) resetAfterPlate()
    } catch (error) {
      setRegionError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleWellClick = (wellId: string, shiftKey = false) => {
    const selectableWellIds = new Set(
      plate?.wells
        .filter((well) => well.rawAbsorbance !== null)
        .map((well) => well.id) ?? [],
    )
    const selectedWellIds =
      shiftKey && lastSelectedWell
        ? wellIdsInRange(lastSelectedWell, wellId, selectableWellIds)
        : [wellId]

    setWorkspace((previous) => {
      const assignments = { ...previous.assignments }
      for (const selectedWellId of selectedWellIds) {
        if (tool === 'clear') {
          delete assignments[selectedWellId]
        } else if (tool === 'blank') {
          assignments[selectedWellId] = { type: 'blank' }
        } else if (tool === 'standard' && previous.activeStandardId) {
          assignments[selectedWellId] = { type: 'standard', groupId: previous.activeStandardId }
        } else if (tool === 'sample' && previous.activeSampleId) {
          assignments[selectedWellId] = { type: 'sample', groupId: previous.activeSampleId }
        }
      }
      const next = syncGroupWells(previous, assignments)
      if (!assignmentsEqual(previous.assignments, next.assignments)) {
        setAssignmentHistory((history) => recordWorkspaceHistory(history, previous, next))
      }
      return next
    })
    clearResult()
    setLastSelectedWell(wellId)
  }

  const undoAssignment = () => {
    const next = undoWorkspace(assignmentHistory, workspace)
    if (next.workspace === workspace) return
    setWorkspace(next.workspace)
    setAssignmentHistory(next.history)
    clearResult()
    setLastSelectedWell('')
  }

  const redoAssignment = () => {
    const next = redoWorkspace(assignmentHistory, workspace)
    if (next.workspace === workspace) return
    setWorkspace(next.workspace)
    setAssignmentHistory(next.history)
    clearResult()
    setLastSelectedWell('')
  }

  const addStandardGroup = () => {
    const concentration = parseRequiredNumber(newStandard)
    if (!Number.isFinite(concentration)) {
      setGroupError('Standard concentration must be a finite number.')
      return
    }
    setWorkspace((previous) => {
      const id = nextGroupId('standard', previous.standardGroups.map((group) => group.id))
      return {
        ...previous,
        standardGroups: [...previous.standardGroups, { id, concentration, wellIds: [] }],
        activeStandardId: id,
      }
    })
    setNewStandard('')
    setGroupError('')
  }

  const addSampleGroup = () => {
    const name = newSampleName.trim()
    const dilutionFactor = parseRequiredNumber(newDilution)
    if (!name) {
      setGroupError('Sample name is required.')
      return
    }
    if (!Number.isFinite(dilutionFactor) || dilutionFactor <= 0) {
      setGroupError('Dilution factor must be a finite number greater than zero.')
      return
    }
    setWorkspace((previous) => {
      const id = nextGroupId('sample', previous.sampleGroups.map((group) => group.id))
      return {
        ...previous,
        sampleGroups: [...previous.sampleGroups, { id, name, dilutionFactor, wellIds: [] }],
        activeSampleId: id,
      }
    })
    setNewSampleName('')
    setNewDilution('1')
    setGroupError('')
  }

  const removeGroup = (type: 'standard' | 'sample', groupId: string) => {
    setWorkspace((previous) => {
      const assignments = { ...previous.assignments }
      for (const [wellId, assignment] of Object.entries(assignments)) {
        if (assignment.type === type && assignment.groupId === groupId) delete assignments[wellId]
      }
      const standardGroups =
        type === 'standard'
          ? previous.standardGroups.filter((group) => group.id !== groupId)
          : previous.standardGroups
      const sampleGroups =
        type === 'sample'
          ? previous.sampleGroups.filter((group) => group.id !== groupId)
          : previous.sampleGroups
      const next = syncGroupWells(
        {
          ...previous,
          standardGroups,
          sampleGroups,
          activeStandardId:
            type === 'standard' && previous.activeStandardId === groupId
              ? standardGroups[0]?.id ?? ''
              : previous.activeStandardId,
          activeSampleId:
            type === 'sample' && previous.activeSampleId === groupId
              ? sampleGroups[0]?.id ?? ''
              : previous.activeSampleId,
        },
        assignments,
      )
      if (!assignmentsEqual(previous.assignments, next.assignments)) {
        setAssignmentHistory((history) => recordWorkspaceHistory(history, previous, next))
      }
      return next
    })
    clearResult()
    setGroupDrafts((previous) => {
      const standardConcentrations = { ...previous.standardConcentrations }
      const sampleNames = { ...previous.sampleNames }
      const sampleDilutions = { ...previous.sampleDilutions }
      delete standardConcentrations[groupId]
      delete sampleNames[groupId]
      delete sampleDilutions[groupId]
      return { standardConcentrations, sampleNames, sampleDilutions }
    })
  }

  const updateGroupDraft = (
    field: keyof GroupDrafts,
    groupId: string,
    value: string,
  ) => {
    clearResult()
    setGroupDrafts((previous) => ({
      ...previous,
      [field]: { ...previous[field], [groupId]: value },
    }))
  }

  const selectedCounts = { blank: 0, standard: 0, sample: 0 }
  for (const assignment of Object.values(workspace.assignments)) {
    selectedCounts[assignment.type] += 1
  }
  const standardWellCount = selectedCounts.standard
  const uniqueStandardCount = countUniqueAssignedStandardConcentrations(
    workspace.standardGroups,
    groupDrafts.standardConcentrations,
  )
  const canUndoAssignment = assignmentHistory.past.length > 0
  const canRedoAssignment = assignmentHistory.future.length > 0

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (step !== 3 || isEditingText(event.target)) return
      const modifier = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (!modifier) return
      if (key === 'z' && !event.shiftKey && canUndoAssignment) {
        event.preventDefault()
        undoAssignment()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        if (!canRedoAssignment) return
        event.preventDefault()
        redoAssignment()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step, workspace, assignmentHistory, canUndoAssignment, canRedoAssignment])

  const processPlate = () => {
    if (!plate) return
    setAnalysisError('')
    setExcelExportError('')
    let resolvedGroups: ReturnType<typeof resolveGroupDrafts>
    try {
      resolvedGroups = resolveGroupDrafts(
        workspace.standardGroups,
        workspace.sampleGroups,
        groupDrafts,
      )
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : String(error))
      return
    }
    let blank: BlankPolicy
    if (blankMode === 'selected') {
      if (selectedCounts.blank === 0) {
        setAnalysisError('Choose a manual blank value or no correction before processing.')
        return
      }
      blank = { mode: 'selected' }
    } else if (blankMode === 'manual') {
      blank = { mode: 'manual', value: parseRequiredNumber(manualBlank) }
    } else {
      blank = { mode: 'none' }
    }

    let curve: CurveConfig
    if (curveMode === 'custom') {
      curve = {
        mode: 'custom',
        slope: parseRequiredNumber(customSlope),
        intercept: parseRequiredNumber(customIntercept),
      }
    } else if (curveMode === 'custom-4pl') {
      curve = {
        mode: 'custom-4pl',
        a: parseRequiredNumber(custom4plA),
        b: parseRequiredNumber(custom4plB),
        c: parseRequiredNumber(custom4plC),
        d: parseRequiredNumber(custom4plD),
      }
    } else {
      curve = { mode: curveMode }
    }

    try {
      const nextResult = analyzePlate({
        wells: plate.wells,
        assignments: workspace.assignments,
        standardGroups: resolvedGroups.standardGroups,
        sampleGroups: resolvedGroups.sampleGroups,
        blank,
        curve,
      })
      setResult(nextResult)
      setStep(5)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : String(error))
    }
  }

  const baseName = (fileName.replace(/\.[^.]+$/, '') || 'platecurve-analysis').replace(
    /[^a-z0-9_-]+/gi,
    '-',
  )

  const exportExcel = async () => {
    if (!sourceFile || !imported || !result) {
      setExcelExportError('Load and analyze a plate before exporting Excel.')
      return
    }
    setExcelExporting(true)
    setExcelExportError('')
    try {
      const { buildExcelWorkbook, downloadExcel } = await import('./lib/excel-export')
      const bytes = await buildExcelWorkbook({ imported, result })
      downloadExcel(`${baseName}-analysis.xlsx`, bytes)
    } catch (error) {
      setExcelExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExcelExporting(false)
    }
  }

  const reachableStep = maximumReachableStep({
    imported: imported !== null,
    plate: plate !== null,
    hasSample: selectedCounts.sample > 0,
    result: result !== null,
  })

  return (
    <div className="app-shell">
      <aside className="workflow-rail" aria-label="Analysis steps">
        <div className="brand-row">
          <div className="brand">PlateCurve</div>
          <a
            aria-label="Open PlateCurve on GitHub"
            className="github-link"
            href="https://github.com/thomasjin05/PlateCurve"
            rel="noreferrer"
            target="_blank"
            title="Open PlateCurve on GitHub"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 1.7a10.3 10.3 0 0 0-3.26 20.07c.52.1.71-.22.71-.5v-1.78c-2.89.63-3.5-1.24-3.5-1.24-.47-1.2-1.15-1.52-1.15-1.52-.94-.64.07-.63.07-.63 1.04.07 1.59 1.07 1.59 1.07.92 1.58 2.42 1.12 3.01.86.09-.67.36-1.12.66-1.38-2.31-.26-4.74-1.15-4.74-5.13 0-1.13.4-2.06 1.07-2.78-.11-.26-.46-1.32.1-2.75 0 0 .87-.28 2.84 1.06A9.8 9.8 0 0 1 12 6.18c.88 0 1.75.12 2.58.35 1.97-1.34 2.84-1.06 2.84-1.06.56 1.43.21 2.49.1 2.75.67.72 1.07 1.65 1.07 2.78 0 3.99-2.44 4.87-4.76 5.13.37.32.7.95.7 1.92v2.85c0 .28.19.6.72.5A10.3 10.3 0 0 0 12 1.7Z" />
            </svg>
          </a>
        </div>
        <ol>
          {STEPS.map((label, index) => {
            const number = index + 1
            return (
              <li
                className={step === number ? 'active' : step > number ? 'complete' : ''}
                key={label}
              >
                <button
                  aria-current={step === number ? 'step' : undefined}
                  className="workflow-step-button"
                  disabled={number > reachableStep}
                  onClick={() => setStep(number)}
                  type="button"
                >
                  <span className="workflow-step-number">{number}</span>{label}
                </button>
              </li>
            )
          })}
        </ol>
      </aside>

      <main className="workspace">
        {step === 1 && (
          <section className="step-view upload-step" aria-labelledby="upload-title">
            <div className="step-heading">
              <p className="eyebrow">Step 1 of 6</p>
              <h1 id="upload-title">PlateCurve</h1>
              <p>Analyze absorbance plate data from ELISA, BCA, Bradford, MTT, OD600, and other colorimetric assays.</p>
            </div>
            <label className="file-field" htmlFor="plate-file">Upload CSV or Excel</label>
            <input
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={loading}
              id="plate-file"
              key={fileInputKey}
              onChange={(event) => void handleFile(event.target.files?.[0])}
              type="file"
            />
            <div className="demo-actions">
              <button className="secondary-button" disabled={loading} onClick={loadDemo} type="button">Try demo workbook</button>
              <p className="muted">Starts with blanks and standards assigned.</p>
            </div>
            {loading && <p role="status">Reading {fileName}…</p>}
            {uploadError && <p className="inline-error" role="alert">{uploadError}</p>}
            {imported && (
              <div className="return-panel">
                <p>Loaded: <strong>{fileName}</strong></p>
                <button className="secondary-button" onClick={() => setStep(2)} type="button">Return to plate confirmation</button>
              </div>
            )}
          </section>
        )}

        {step === 2 && imported && (
          <section className="step-view" aria-labelledby="confirm-title">
            <div className="step-heading split-heading">
              <div>
                <p className="eyebrow">Step 2 of 6</p>
                <h1 id="confirm-title">Confirm plate</h1>
                <p><strong>{fileName}</strong> · {imported.format === 'csv' ? 'CSV file' : 'Excel workbook'}</p>
                {plate && <p>Detected plate region: {plateSourceLabel(imported.format, plate)}</p>}
              </div>
              <button className="secondary-button" onClick={() => setRegionOpen((open) => !open)} type="button">Adjust plate region</button>
            </div>
            {regionOpen && (
              <div className="region-editor">
                <label htmlFor="region-row">Top-left row (1-based)</label>
                <input id="region-row" min="1" onChange={(event) => setRegionRow(event.target.value)} type="number" value={regionRow} />
                <label htmlFor="region-column">Top-left column (1-based)</label>
                <input id="region-column" min="1" onChange={(event) => setRegionColumn(event.target.value)} type="number" value={regionColumn} />
                <button className="secondary-button" onClick={applyRegion} type="button">Apply region</button>
              </div>
            )}
            {regionError && <p className="inline-error" role="alert">{regionError}</p>}
            {plate ? (
              <>
                <p className="section-label">Plate preview</p>
                <PlateGrid assignments={{}} readOnly wells={plate.wells} />
              </>
            ) : (
              <p className="warning-panel" role="alert">Set a valid 8 × 12 plate region to continue.</p>
            )}
            <NavActions
              back={() => setStep(1)}
              continueAction={() => setStep(3)}
              continueDisabled={!plate || plate.wells.length !== 96}
              continueLabel="Continue to assignments"
            />
          </section>
        )}

        {step === 3 && plate && imported && (
          <section className="step-view" aria-labelledby="assign-title">
            <div className="step-heading split-heading">
              <div>
                <p className="eyebrow">Step 3 of 6</p>
                <h1 id="assign-title">Assign wells</h1>
                <p>Detected plate region: {plateSourceLabel(imported.format, plate)}</p>
              </div>
              <button className="secondary-button" onClick={() => { setRegionOpen(true); setStep(2) }} type="button">Adjust plate region</button>
            </div>

            <div className="group-editors">
              <fieldset>
                <legend>Standard groups</legend>
                <div className="add-group-row">
                  <label htmlFor="new-standard">Concentration</label>
                  <input id="new-standard" inputMode="decimal" onChange={(event) => setNewStandard(event.target.value)} type="number" value={newStandard} />
                  <button className="secondary-button" onClick={addStandardGroup} type="button">Add standard</button>
                </div>
                {workspace.standardGroups.length === 0 && <p className="muted">No standard groups added.</p>}
                {workspace.standardGroups.map((group) => (
                  <div className="group-row" key={group.id}>
                    <label className="group-radio-option">
                      <input
                        aria-label={`Select standard ${group.concentration}`}
                        checked={workspace.activeStandardId === group.id}
                        name="active-standard"
                        onChange={() => setWorkspace((previous) => ({ ...previous, activeStandardId: group.id }))}
                        type="radio"
                      />
                      <span className="sr-only">Select standard {group.concentration}</span>
                    </label>
                    <label htmlFor={`${group.id}-concentration`}>Concentration</label>
                    <input
                      id={`${group.id}-concentration`}
                      onChange={(event) =>
                        updateGroupDraft(
                          'standardConcentrations',
                          group.id,
                          event.target.value,
                        )
                      }
                      type="number"
                      value={
                        groupDrafts.standardConcentrations[group.id] ??
                        String(group.concentration)
                      }
                    />
                    <span className="well-list">{group.wellIds.length ? group.wellIds.join(', ') : 'No wells'}</span>
                    <button className="text-button" onClick={() => removeGroup('standard', group.id)} type="button">Remove</button>
                  </div>
                ))}
              </fieldset>

              <fieldset>
                <legend>Sample groups</legend>
                <div className="add-group-row sample-add-row">
                  <label htmlFor="new-sample-name">Sample name</label>
                  <input id="new-sample-name" onChange={(event) => setNewSampleName(event.target.value)} type="text" value={newSampleName} />
                  <label htmlFor="new-dilution">Dilution factor</label>
                  <input id="new-dilution" inputMode="decimal" min="0" onChange={(event) => setNewDilution(event.target.value)} type="number" value={newDilution} />
                  <button className="secondary-button" onClick={addSampleGroup} type="button">Add sample</button>
                </div>
                {workspace.sampleGroups.length === 0 && <p className="muted">No sample groups added.</p>}
                {workspace.sampleGroups.map((group) => (
                  <div className="group-row sample-group-row" key={group.id}>
                    <label className="group-radio-option">
                      <input
                        aria-label={`Select sample ${group.name}`}
                        checked={workspace.activeSampleId === group.id}
                        name="active-sample"
                        onChange={() => setWorkspace((previous) => ({ ...previous, activeSampleId: group.id }))}
                        type="radio"
                      />
                      <span className="sr-only">Select sample {group.name}</span>
                    </label>
                    <label htmlFor={`${group.id}-name`}>Name</label>
                    <input
                      id={`${group.id}-name`}
                      onChange={(event) =>
                        updateGroupDraft('sampleNames', group.id, event.target.value)
                      }
                      type="text"
                      value={groupDrafts.sampleNames[group.id] ?? group.name}
                    />
                    <label htmlFor={`${group.id}-dilution`}>Dilution</label>
                    <input
                      id={`${group.id}-dilution`}
                      min="0"
                      onChange={(event) =>
                        updateGroupDraft('sampleDilutions', group.id, event.target.value)
                      }
                      type="number"
                      value={
                        groupDrafts.sampleDilutions[group.id] ??
                        String(group.dilutionFactor)
                      }
                    />
                    <span className="well-list">{group.wellIds.length ? group.wellIds.join(', ') : 'No wells'}</span>
                    <button className="text-button" onClick={() => removeGroup('sample', group.id)} type="button">Remove</button>
                  </div>
                ))}
              </fieldset>
            </div>
            <div className="assignment-controls">
              <div className="assignment-toolbar" role="toolbar" aria-label="Well assignment type">
                {(['blank', 'standard', 'sample', 'clear'] as const).map((option) => (
                  <button
                    aria-pressed={tool === option}
                    className={`assignment-tool ${option}`}
                    key={option}
                    onClick={() => setTool(option)}
                    type="button"
                  >
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
              <div className="history-actions" aria-label="Assignment history controls">
                <button
                  className="secondary-button"
                  disabled={!canUndoAssignment}
                  onClick={undoAssignment}
                  type="button"
                >
                  Undo
                </button>
                <button
                  className="secondary-button"
                  disabled={!canRedoAssignment}
                  onClick={redoAssignment}
                  type="button"
                >
                  Redo
                </button>
              </div>
            </div>
            <p className="muted">Tip: Shift-click another well to assign a range. Use Cmd/Ctrl+Z to undo and Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y to redo.</p>

            {(tool === 'standard' && !workspace.activeStandardId) ||
            (tool === 'sample' && !workspace.activeSampleId) ? (
              <p className="inline-error" role="alert">Add and select a {tool} group before assigning wells.</p>
            ) : null}
            {groupError && <p className="inline-error" role="alert">{groupError}</p>}

            <PlateGrid assignments={workspace.assignments} onWellClick={handleWellClick} wells={plate.wells} />
            <p className="selection-summary">
              Selected: {selectedCounts.blank} blanks · {selectedCounts.standard} standards · {selectedCounts.sample} samples
            </p>
            <NavActions
              back={() => setStep(2)}
              continueAction={() => setStep(4)}
              continueDisabled={selectedCounts.sample < 1}
              continueLabel="Continue to curve"
            />
          </section>
        )}

        {step === 4 && plate && (
          <section className="step-view" aria-labelledby="curve-title">
            <div className="step-heading">
              <p className="eyebrow">Step 4 of 6</p>
              <h1 id="curve-title">Configure curve</h1>
              <p>{uniqueStandardCount} unique standard concentrations across {standardWellCount} wells.</p>
            </div>

            {selectedCounts.blank === 0 && (
              <div className="warning-panel" role="alert">
                No blank wells are selected. Choose a manual blank value or explicitly select no correction.
              </div>
            )}

            <fieldset className="config-section">
              <legend>Blank correction</legend>
              <label className="radio-option"><input checked={blankMode === 'selected'} name="blank-mode" onChange={() => { setBlankMode('selected'); clearResult() }} type="radio" />Use selected blank wells</label>
              <label className="radio-option"><input checked={blankMode === 'manual'} name="blank-mode" onChange={() => { setBlankMode('manual'); clearResult() }} type="radio" />Use manual blank value</label>
              {blankMode === 'manual' && (
                <div className="nested-field">
                  <label htmlFor="manual-blank">Manual blank absorbance</label>
                  <input id="manual-blank" inputMode="decimal" onChange={(event) => { setManualBlank(event.target.value); clearResult() }} type="number" value={manualBlank} />
                </div>
              )}
              <label className="radio-option"><input checked={blankMode === 'none'} name="blank-mode" onChange={() => { setBlankMode('none'); clearResult() }} type="radio" />No blank correction</label>
            </fieldset>

            <fieldset className="config-section">
              <legend>Curve model</legend>
              <label className="radio-option"><input checked={curveMode === 'linear'} name="curve-mode" onChange={() => { setCurveMode('linear'); clearResult() }} type="radio" />Linear</label>
              <label className="radio-option"><input checked={curveMode === '4pl'} name="curve-mode" onChange={() => { setCurveMode('4pl'); clearResult() }} type="radio" />4PL</label>
              <label className="radio-option"><input checked={curveMode === 'custom'} name="curve-mode" onChange={() => { setCurveMode('custom'); clearResult() }} type="radio" />Custom equation</label>
              <label className="radio-option"><input checked={curveMode === 'custom-4pl'} name="curve-mode" onChange={() => { setCurveMode('custom-4pl'); clearResult() }} type="radio" />Custom 4PL equation</label>
              {curveMode === 'custom' && (
                <>
                  <p className="equation-help">{CUSTOM_EQUATION_HELP}</p>
                  <div className="custom-fields">
                    <div><label htmlFor="custom-slope">Slope</label><input id="custom-slope" inputMode="decimal" onChange={(event) => { setCustomSlope(event.target.value); clearResult() }} type="number" value={customSlope} /></div>
                    <div><label htmlFor="custom-intercept">Intercept</label><input id="custom-intercept" inputMode="decimal" onChange={(event) => { setCustomIntercept(event.target.value); clearResult() }} type="number" value={customIntercept} /></div>
                  </div>
                </>
              )}
              {curveMode === 'custom-4pl' && (
                <>
                  <p className="equation-help">{CUSTOM_4PL_EQUATION_HELP}</p>
                  <div className="custom-fields">
                    <div><label htmlFor="custom-4pl-a">a</label><input aria-label="a, response at zero concentration" id="custom-4pl-a" inputMode="decimal" onChange={(event) => { setCustom4plA(event.target.value); clearResult() }} type="number" value={custom4plA} /></div>
                    <div><label htmlFor="custom-4pl-b">b</label><input aria-label="b, Hill slope" id="custom-4pl-b" inputMode="decimal" onChange={(event) => { setCustom4plB(event.target.value); clearResult() }} type="number" value={custom4plB} /></div>
                    <div><label htmlFor="custom-4pl-c">c</label><input aria-label="c, midpoint concentration" id="custom-4pl-c" inputMode="decimal" onChange={(event) => { setCustom4plC(event.target.value); clearResult() }} type="number" value={custom4plC} /></div>
                    <div><label htmlFor="custom-4pl-d">d</label><input aria-label="d, response at high concentration" id="custom-4pl-d" inputMode="decimal" onChange={(event) => { setCustom4plD(event.target.value); clearResult() }} type="number" value={custom4plD} /></div>
                  </div>
                </>
              )}
            </fieldset>

            {curveMode === '4pl' && uniqueStandardCount < 6 && (
              <div className="warning-panel" role="alert">4PL fitting has fewer than 6 unique standard concentrations.</div>
            )}
            {analysisError && <p className="inline-error" role="alert">{analysisError}</p>}
            <NavActions back={() => setStep(3)} continueAction={processPlate} continueLabel="Process results" />
          </section>
        )}

        {step === 5 && result && (
          <section className="step-view" aria-labelledby="results-title">
            <div className="step-heading">
              <p className="eyebrow">Step 5 of 6</p>
              <h1 id="results-title">Results</h1>
            </div>
            <ResultsView result={result} />
            <NavActions back={() => setStep(4)} continueAction={() => setStep(6)} continueLabel="Continue to export" />
          </section>
        )}

        {step === 6 && result && (
          <section className="step-view" aria-labelledby="export-title">
            <div className="step-heading">
              <p className="eyebrow">Step 6 of 6</p>
              <h1 id="export-title">Export</h1>
              <p>Save the analysis as a formatted Excel workbook or standardized CSV files.</p>
            </div>
            <section className="export-summary" aria-labelledby="export-summary-title">
              <h2 id="export-summary-title">Analysis summary</h2>
              <dl>
                <div><dt>Curve model</dt><dd>{curveModeLabel(result.summary.model)}</dd></div>
                <div><dt>Blank mean average</dt><dd>{result.summary.blankMean}</dd></div>
                <div><dt>Blank wells</dt><dd>{result.summary.blankCount}</dd></div>
                <div><dt>Standard wells</dt><dd>{result.summary.standardWellCount}</dd></div>
                <div><dt>Standard range</dt><dd>{result.summary.standardRange || 'Not available'}</dd></div>
              </dl>
            </section>
            <section className="result-plate" aria-labelledby="export-plate-title">
              <h2 id="export-plate-title">Calculated concentration plate</h2>
              <ResultPlate result={result} />
            </section>
            <div className="export-actions">
              <button className="primary-button" disabled={excelExporting} onClick={() => void exportExcel()} type="button">
                {excelExporting ? 'Preparing Excel…' : 'Export Excel workbook'}
              </button>
              <button className="primary-button" onClick={() => downloadCsv(`${baseName}-results.csv`, resultsToCsv(result.rows))} type="button">Export results CSV</button>
              <button className="secondary-button" onClick={() => downloadCsv(`${baseName}-curve-summary.csv`, summaryToCsv(result.summary))} type="button">Export curve summary CSV</button>
              <button className="text-button" onClick={startNewAnalysis} type="button">Start new analysis</button>
            </div>
            {excelExportError && <p className="inline-error" role="alert">{excelExportError}</p>}
            <NavActions back={() => setStep(5)} />
          </section>
        )}
      </main>
    </div>
  )
}
