import { RESULT_COLUMNS } from '../lib/export'
import type { AnalysisResult, Assignment, ResultRow } from '../types'
import { CurveChart } from './CurveChart'
import { PlateGrid } from './PlateGrid'

type ResultsViewProps = {
  result: AnalysisResult
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return Number(value.toPrecision(6)).toString()
}

function resultCells(row: ResultRow): string[] {
  return [
    row.wellId,
    row.row,
    String(row.column),
    formatNumber(row.rawAbsorbance),
    formatNumber(row.correctedAbsorbance),
    row.assignmentType,
    formatNumber(row.standardConcentration),
    row.sampleName,
    formatNumber(row.calculatedConcentration),
    formatNumber(row.dilutionFactor),
    formatNumber(row.finalConcentration),
    row.warningStatus,
  ]
}

export function ResultsView({ result }: ResultsViewProps) {
  const responses = new Map<number, number[]>()
  for (const row of result.rows) {
    if (
      row.assignmentType !== 'standard' ||
      row.standardConcentration === null ||
      row.correctedAbsorbance === null ||
      !Number.isFinite(row.standardConcentration) ||
      !Number.isFinite(row.correctedAbsorbance)
    ) {
      continue
    }
    const values = responses.get(row.standardConcentration) ?? []
    values.push(row.correctedAbsorbance)
    responses.set(row.standardConcentration, values)
  }
  const standardPoints = [...responses.entries()]
    .sort(([left], [right]) => left - right)
    .map(([x, values]) => ({
      x,
      y: values.reduce((sum, value) => sum + value, 0) / values.length,
    }))
  const { summary } = result

  return (
    <section className="results-view" aria-labelledby="results-summary-title">
      {result.warnings.length > 0 && (
        <div className="warning-panel" role="alert">
          <h2>Review warnings</h2>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="results-summary">
        <h2 id="results-summary-title">Results summary</h2>
        <dl>
          <div>
            <dt>Curve model</dt>
            <dd>{summary.model === '4pl' ? '4PL model' : summary.model === 'linear' ? 'Linear model' : 'Custom equation'}</dd>
          </div>
          <div>
            <dt>Blank mean</dt>
            <dd>{formatNumber(summary.blankMean)}</dd>
          </div>
          <div>
            <dt>Blank wells</dt>
            <dd>{summary.blankCount}</dd>
          </div>
          <div>
            <dt>Standard wells</dt>
            <dd>{summary.standardWellCount}</dd>
          </div>
          <div>
            <dt>Standard range</dt>
            <dd>{summary.standardRange || 'Not available'}</dd>
          </div>
          {summary.model === 'linear' && (
            <>
              <div><dt>Slope</dt><dd>{formatNumber(summary.slope)}</dd></div>
              <div><dt>Intercept</dt><dd>{formatNumber(summary.intercept)}</dd></div>
              <div><dt>R²</dt><dd>{formatNumber(summary.rSquared)}</dd></div>
            </>
          )}
          {summary.model === '4pl' && (
            <>
              <div><dt>A</dt><dd>{formatNumber(summary.a)}</dd></div>
              <div><dt>B</dt><dd>{formatNumber(summary.b)}</dd></div>
              <div><dt>C</dt><dd>{formatNumber(summary.c)}</dd></div>
              <div><dt>D</dt><dd>{formatNumber(summary.d)}</dd></div>
            </>
          )}
          {summary.model === 'custom' && (
            <>
              <div><dt>Slope</dt><dd>{formatNumber(summary.slope)}</dd></div>
              <div><dt>Intercept</dt><dd>{formatNumber(summary.intercept)}</dd></div>
            </>
          )}
        </dl>
      </section>

      <section className="result-plate" aria-labelledby="result-plate-title">
        <h2 id="result-plate-title">Plate coordinates</h2>
        <ResultPlate result={result} />
      </section>

      {result.fit && <CurveChart fit={result.fit} points={standardPoints} />}

      <div className="results-table-scroll">
        <table>
          <thead>
            <tr>
              {RESULT_COLUMNS.map((header) => <th key={header} scope="col">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.wellId}>
                {resultCells(row).map((cell, index) => <td key={RESULT_COLUMNS[index]}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ResultPlate({ result }: ResultsViewProps) {
  const assignments: Record<string, Assignment> = {}
  for (const row of result.rows) {
    if (row.assignmentType !== 'unused') {
      assignments[row.wellId] = { type: row.assignmentType }
    }
  }
  const wells = result.rows.map((row) => ({
    id: row.wellId,
    row: row.row,
    column: row.column,
    rawAbsorbance: row.rawAbsorbance,
  }))

  return <PlateGrid assignments={assignments} readOnly wells={wells} />
}
