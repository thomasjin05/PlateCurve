import type { Assignment, Well } from '../types'

type PlateGridProps = {
  wells: Well[]
  assignments: Record<string, Assignment>
  onWellClick?: (wellId: string) => void
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
    <div className="plate-scroll" aria-label="96-well plate">
      <div className="plate-grid" role="grid" aria-rowcount={9} aria-colcount={13}>
        <div className="plate-corner" role="columnheader">
          Row
        </div>
        {COLUMNS.map((column) => (
          <div className="plate-column-header" role="columnheader" key={column}>
            {column}
          </div>
        ))}
        {ROWS.flatMap((rowName) => {
          const row = wellsByRow.get(rowName)
          return [
            <div className="plate-row-header" role="rowheader" key={`${rowName}-header`}>
              {rowName}
            </div>,
            ...COLUMNS.map((column) => {
              const well = row?.get(column)
              const wellId = `${rowName}${column}`
              const value = well?.rawAbsorbance ?? null
              const assignment = assignments[wellId]
              const formatted = formatAbsorbance(value)

              return (
                <button
                  aria-label={`${wellId}, ${value === null ? 'no absorbance value' : `absorbance ${formatted}`}`}
                  className={`plate-well ${assignment?.type ?? 'unused'}`}
                  data-well-id={wellId}
                  disabled={readOnly || value === null}
                  key={wellId}
                  onClick={() => onWellClick?.(wellId)}
                  role="gridcell"
                  type="button"
                >
                  {formatted}
                </button>
              )
            }),
          ]
        })}
      </div>
    </div>
  )
}
