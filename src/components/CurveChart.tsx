import { evaluateFourPL } from '../lib/analysis'
import type { FourPLFit, LinearFit } from '../types'

type Point = { x: number; y: number }

type CurveChartProps = {
  points: Point[]
  fit: LinearFit | FourPLFit
}

const WIDTH = 640
const HEIGHT = 360
const LEFT = 68
const RIGHT = 22
const TOP = 18
const BOTTOM = 58

export function CurveChart({ points, fit }: CurveChartProps) {
  const finitePoints = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  )
  const fitValues =
    fit.model === 'linear'
      ? [fit.slope, fit.intercept, fit.rSquared]
      : [fit.a, fit.b, fit.c, fit.d]
  if (finitePoints.length === 0 || !fitValues.every(Number.isFinite)) return null

  const observedX = finitePoints.map((point) => point.x)
  const minimumX = Math.min(...observedX)
  const maximumX = Math.max(...observedX)
  const xSpan = maximumX - minimumX || 1
  const sampled = Array.from({ length: 81 }, (_, index) => {
    const x = minimumX + ((maximumX - minimumX) * index) / 80
    const y =
      fit.model === 'linear'
        ? fit.slope * x + fit.intercept
        : x >= 0
          ? evaluateFourPL(x, fit)
          : Number.NaN
    return { x, y }
  }).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (sampled.length === 0) return null

  const allY = [...finitePoints, ...sampled].map((point) => point.y)
  const rawMinimumY = Math.min(...allY)
  const rawMaximumY = Math.max(...allY)
  const yPadding = (rawMaximumY - rawMinimumY || Math.abs(rawMaximumY) || 1) * 0.08
  const minimumY = rawMinimumY - yPadding
  const maximumY = rawMaximumY + yPadding
  const ySpan = maximumY - minimumY
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const scaleX = (x: number) => LEFT + ((x - minimumX) / xSpan) * plotWidth
  const scaleY = (y: number) => TOP + ((maximumY - y) / ySpan) * plotHeight
  const path = sampled
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${scaleX(point.x)} ${scaleY(point.y)}`)
    .join(' ')

  return (
    <figure className="curve-chart">
      <svg
        aria-label={`${fit.model === 'linear' ? 'Linear' : '4PL'} standard curve`}
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <line className="chart-axis" x1={LEFT} x2={LEFT} y1={TOP} y2={HEIGHT - BOTTOM} />
        <line
          className="chart-axis"
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={HEIGHT - BOTTOM}
          y2={HEIGHT - BOTTOM}
        />
        <path className="fit-line" d={path} fill="none" />
        {finitePoints.map((point, index) => (
          <circle
            className="standard-point"
            cx={scaleX(point.x)}
            cy={scaleY(point.y)}
            key={`${point.x}-${point.y}-${index}`}
            r="5"
          />
        ))}
        <text className="chart-label" textAnchor="middle" x={LEFT + plotWidth / 2} y={HEIGHT - 12}>
          Standard concentration
        </text>
        <text
          className="chart-label"
          textAnchor="middle"
          transform={`rotate(-90 18 ${TOP + plotHeight / 2})`}
          x="18"
          y={TOP + plotHeight / 2}
        >
          Corrected absorbance
        </text>
      </svg>
    </figure>
  )
}
