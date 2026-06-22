import { useState } from 'react'

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

type Tool = AssignmentType | 'clear'

type AssignmentWorkspace = {
  assignments: Record<string, Assignment>
  standardGroups: StandardGroup[]
  sampleGroups: SampleGroup[]
  activeStandardId: string
  activeSampleId: string
}

const EMPTY_WORKSPACE: AssignmentWorkspace = {
  assignments: {},
  standardGroups: [],
  sampleGroups: [],
  activeStandardId: '',
  activeSampleId: '',
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
): number {
  return new Set(
    groups.filter((group) => group.wellIds.length > 0).map((group) => group.concentration),
  ).size
}

function parseRequiredNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
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
  const [imported, setImported] = useState<ImportedTable | null>(null)
  const [plate, setPlate] = useState<PlateData | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [regionOpen, setRegionOpen] = useState(false)
  const [regionRow, setRegionRow] = useState('1')
  const [regionColumn, setRegionColumn] = useState('1')
  const [regionError, setRegionError] = useState('')
  const [workspace, setWorkspace] = useState<AssignmentWorkspace>(EMPTY_WORKSPACE)
  const [tool, setTool] = useState<Tool>('blank')
  const [newStandard, setNewStandard] = useState('')
  const [newSampleName, setNewSampleName] = useState('')
  const [newDilution, setNewDilution] = useState('1')
  const [groupError, setGroupError] = useState('')
  const [blankMode, setBlankMode] = useState<BlankPolicy['mode']>('selected')
  const [manualBlank, setManualBlank] = useState('')
  const [curveMode, setCurveMode] = useState<CurveMode>('linear')
  const [customSlope, setCustomSlope] = useState('')
  const [customIntercept, setCustomIntercept] = useState('')
  const [analysisError, setAnalysisError] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)

  const resetAfterPlate = () => {
    setWorkspace(EMPTY_WORKSPACE)
    setTool('blank')
    setNewStandard('')
    setNewSampleName('')
    setNewDilution('1')
    setGroupError('')
    setBlankMode('selected')
    setManualBlank('')
    setCurveMode('linear')
    setCustomSlope('')
    setCustomIntercept('')
    setAnalysisError('')
    setResult(null)
  }

  const startNewAnalysis = () => {
    setStep(1)
    setFileInputKey((value) => value + 1)
    setFileName('')
    setImported(null)
    setPlate(null)
    setLoading(false)
    setUploadError('')
    setRegionOpen(false)
    setRegionRow('1')
    setRegionColumn('1')
    setRegionError('')
    resetAfterPlate()
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return

    setStep(1)
    setFileName(file.name)
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

  const handleWellClick = (wellId: string) => {
    setWorkspace((previous) => {
      const assignments = { ...previous.assignments }
      if (tool === 'clear') {
        delete assignments[wellId]
      } else if (tool === 'blank') {
        assignments[wellId] = { type: 'blank' }
      } else if (tool === 'standard' && previous.activeStandardId) {
        assignments[wellId] = { type: 'standard', groupId: previous.activeStandardId }
      } else if (tool === 'sample' && previous.activeSampleId) {
        assignments[wellId] = { type: 'sample', groupId: previous.activeSampleId }
      }
      return syncGroupWells(previous, assignments)
    })
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
      return syncGroupWells(
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
    })
  }

  const updateStandard = (groupId: string, value: string) => {
    const concentration = parseRequiredNumber(value)
    if (!Number.isFinite(concentration)) return
    setWorkspace((previous) => ({
      ...previous,
      standardGroups: previous.standardGroups.map((group) =>
        group.id === groupId ? { ...group, concentration } : group,
      ),
    }))
  }

  const updateSample = (
    groupId: string,
    field: 'name' | 'dilutionFactor',
    value: string,
  ) => {
    setWorkspace((previous) => ({
      ...previous,
      sampleGroups: previous.sampleGroups.map((group) => {
        if (group.id !== groupId) return group
        if (field === 'name') return value.trim() ? { ...group, name: value } : group
        const dilutionFactor = parseRequiredNumber(value)
        return Number.isFinite(dilutionFactor) && dilutionFactor > 0
          ? { ...group, dilutionFactor }
          : group
      }),
    }))
  }

  const selectedCounts = { blank: 0, standard: 0, sample: 0 }
  for (const assignment of Object.values(workspace.assignments)) {
    selectedCounts[assignment.type] += 1
  }
  const standardWellCount = selectedCounts.standard
  const uniqueStandardCount = countUniqueAssignedStandardConcentrations(
    workspace.standardGroups,
  )

  const processPlate = () => {
    if (!plate) return
    setAnalysisError('')
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
    } else {
      curve = { mode: curveMode }
    }

    try {
      const nextResult = analyzePlate({
        wells: plate.wells,
        assignments: workspace.assignments,
        standardGroups: workspace.standardGroups,
        sampleGroups: workspace.sampleGroups,
        blank,
        curve,
      })
      setResult(nextResult)
      setStep(5)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : String(error))
    }
  }

  const baseName = (fileName.replace(/\.[^.]+$/, '') || 'elisa-analysis').replace(
    /[^a-z0-9_-]+/gi,
    '-',
  )

  return (
    <div className="app-shell">
      <aside className="workflow-rail" aria-label="Analysis steps">
        <div className="brand">ELISA Lab</div>
        <ol>
          {STEPS.map((label, index) => {
            const number = index + 1
            return (
              <li
                aria-current={step === number ? 'step' : undefined}
                className={step === number ? 'active' : step > number ? 'complete' : ''}
                key={label}
              >
                <span>{number}</span>{label}
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
              <h1 id="upload-title">Upload CSV or Excel</h1>
              <p>Choose a plate-reader CSV or modern .xlsx workbook. Excel imports use the first worksheet.</p>
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

            {(tool === 'standard' && !workspace.activeStandardId) ||
            (tool === 'sample' && !workspace.activeSampleId) ? (
              <p className="inline-error" role="alert">Add and select a {tool} group before assigning wells.</p>
            ) : null}

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
                    <input id={`${group.id}-concentration`} onChange={(event) => updateStandard(group.id, event.target.value)} type="number" value={group.concentration} />
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
                    <input id={`${group.id}-name`} onChange={(event) => updateSample(group.id, 'name', event.target.value)} type="text" value={group.name} />
                    <label htmlFor={`${group.id}-dilution`}>Dilution</label>
                    <input id={`${group.id}-dilution`} min="0" onChange={(event) => updateSample(group.id, 'dilutionFactor', event.target.value)} type="number" value={group.dilutionFactor} />
                    <span className="well-list">{group.wellIds.length ? group.wellIds.join(', ') : 'No wells'}</span>
                    <button className="text-button" onClick={() => removeGroup('sample', group.id)} type="button">Remove</button>
                  </div>
                ))}
              </fieldset>
            </div>
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
              <label className="radio-option"><input checked={blankMode === 'selected'} name="blank-mode" onChange={() => setBlankMode('selected')} type="radio" />Use selected blank wells</label>
              <label className="radio-option"><input checked={blankMode === 'manual'} name="blank-mode" onChange={() => setBlankMode('manual')} type="radio" />Use manual blank value</label>
              {blankMode === 'manual' && (
                <div className="nested-field">
                  <label htmlFor="manual-blank">Manual blank absorbance</label>
                  <input id="manual-blank" inputMode="decimal" onChange={(event) => setManualBlank(event.target.value)} type="number" value={manualBlank} />
                </div>
              )}
              <label className="radio-option"><input checked={blankMode === 'none'} name="blank-mode" onChange={() => setBlankMode('none')} type="radio" />No blank correction</label>
            </fieldset>

            <fieldset className="config-section">
              <legend>Curve model</legend>
              <label className="radio-option"><input checked={curveMode === 'linear'} name="curve-mode" onChange={() => setCurveMode('linear')} type="radio" />Linear</label>
              <label className="radio-option"><input checked={curveMode === '4pl'} name="curve-mode" onChange={() => setCurveMode('4pl')} type="radio" />4PL</label>
              <label className="radio-option"><input checked={curveMode === 'custom'} name="curve-mode" onChange={() => setCurveMode('custom')} type="radio" />Custom equation</label>
              {curveMode === 'custom' && (
                <div className="custom-fields">
                  <div><label htmlFor="custom-slope">Slope</label><input id="custom-slope" inputMode="decimal" onChange={(event) => setCustomSlope(event.target.value)} type="number" value={customSlope} /></div>
                  <div><label htmlFor="custom-intercept">Intercept</label><input id="custom-intercept" inputMode="decimal" onChange={(event) => setCustomIntercept(event.target.value)} type="number" value={customIntercept} /></div>
                </div>
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
              <p>Save the standardized well results and curve summary as CSV files.</p>
            </div>
            <section className="export-summary" aria-labelledby="export-summary-title">
              <h2 id="export-summary-title">Analysis summary</h2>
              <dl>
                <div><dt>Curve model</dt><dd>{result.summary.model}</dd></div>
                <div><dt>Blank wells</dt><dd>{result.summary.blankCount}</dd></div>
                <div><dt>Standard wells</dt><dd>{result.summary.standardWellCount}</dd></div>
                <div><dt>Standard range</dt><dd>{result.summary.standardRange || 'Not available'}</dd></div>
              </dl>
            </section>
            <section className="result-plate" aria-labelledby="export-plate-title">
              <h2 id="export-plate-title">Plate coordinates</h2>
              <ResultPlate result={result} />
            </section>
            <div className="export-actions">
              <button className="primary-button" onClick={() => downloadCsv(`${baseName}-results.csv`, resultsToCsv(result.rows))} type="button">Export results CSV</button>
              <button className="secondary-button" onClick={() => downloadCsv(`${baseName}-curve-summary.csv`, summaryToCsv(result.summary))} type="button">Export curve summary CSV</button>
              <button className="text-button" onClick={startNewAnalysis} type="button">Start new analysis</button>
            </div>
            <NavActions back={() => setStep(5)} />
          </section>
        )}
      </main>
    </div>
  )
}
