import type { Assignment, Well } from '../types'

type PlateGridProps = {
  wells: Well[]
  assignments: Record<string, Assignment>
  onWellClick?: (wellId: string, shiftKey: boolean) => void
  readOnly?: boolean
}

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const
const COLUMNS = Array.from({ length: 12 }, (_, index) => index + 1)

function formatAbsorbance(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No value'
  return value.toFixed(3).replace(/\.?0+$/, '')
}

export function PlateGrid({
  wells,
  assignments,
  onWellClick,
  readOnly = false,
}: PlateGridProps) {
  const wellsByRow = new Map<string, Map<number, Well>>()
  for (const well of wells) {
    const row = wellsByRow.get(well.row) ?? new Map<number, Well>()
    row.set(well.column, well)
    wellsByRow.set(well.row, row)
  }

  return (
    <div className="plate-scroll">
      <table aria-label="96-well plate" className="plate-grid">
        <thead>
          <tr>
            <th className="plate-corner" scope="col">Row</th>
            {COLUMNS.map((column) => (
              <th className="plate-column-header" key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((rowName) => {
            const row = wellsByRow.get(rowName)
            return (
              <tr key={rowName}>
                <th className="plate-row-header" scope="row">{rowName}</th>
                {COLUMNS.map((column) => {
              const well = row?.get(column)
              const wellId = `${rowName}${column}`
              const value = well?.rawAbsorbance ?? null
              const assignment = assignments[wellId]
              const formatted = formatAbsorbance(value)
              const assignmentLabel = assignment
                ? `assigned as ${assignment.type}${assignment.groupId ? ` group ${assignment.groupId}` : ''}`
                : 'unused'

              return (
                <td key={wellId}>
                  <button
                    aria-label={`${wellId}, ${value === null ? 'no absorbance value' : `absorbance ${formatted}`}, ${assignmentLabel}`}
                    className={`plate-well ${assignment?.type ?? 'unused'}`}
                    data-well-id={wellId}
                    disabled={readOnly || value === null}
                    onClick={(event) => onWellClick?.(wellId, event.shiftKey)}
                    type="button"
                  >
                    {formatted}
                  </button>
                </td>
              )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
