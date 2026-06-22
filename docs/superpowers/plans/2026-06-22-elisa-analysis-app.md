# ELISA Analysis App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-only ELISA CSV workflow with plate detection, manual well grouping, linear and 4PL fitting, warnings, graphs, and CSV exports.

**Architecture:** React owns the six-step workbench and plain TypeScript modules own parsing, calculations, and export. Papa Parse handles CSV syntax, `ml-levenberg-marquardt` fits 4PL curves, and a small SVG component renders fitted curves.

**Tech Stack:** React 19.2.7, Vite 8.0.16, TypeScript 6.0.3, Vitest 4.1.9, Papa Parse 5.5.4, `ml-levenberg-marquardt` 5.0.1, native SVG and CSS.

---

## File Map

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`: project and test configuration.
- `src/types.ts`: shared plate, assignment, fit, warning, and result types.
- `src/lib/plate.ts`: CSV parsing, automatic 8 by 12 detection, and manual region extraction.
- `src/lib/analysis.ts`: blank correction, standard aggregation, linear and 4PL fitting, inversion, dilution, and warnings.
- `src/lib/export.ts`: results and curve-summary CSV generation and download.
- `src/components/PlateGrid.tsx`: labeled plate display and well selection.
- `src/components/CurveChart.tsx`: native SVG standard points and fitted curve.
- `src/components/ResultsView.tsx`: warning list, curve summary, graph, and standardized results table.
- `src/App.tsx`: six-step state machine, forms, validation, and export actions.
- `src/styles.css`: approved guided workbench, plate colors, tables, and narrow-screen behavior.
- `src/lib/*.test.ts`: focused tests for parsing, calculations, 4PL, and export.
- `src/fixtures/labeled-plate.csv`: browser verification fixture.

### Task 1: Bootstrap the client and test runner

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/types.ts`

- [ ] **Step 1: Add the package manifest**

```json
{
  "name": "elisa-analysis-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "ml-levenberg-marquardt": "5.0.1",
    "papaparse": "5.5.4",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  },
  "devDependencies": {
    "@types/papaparse": "5.5.2",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.2",
    "typescript": "6.0.3",
    "vite": "8.0.16",
    "vitest": "4.1.9"
  }
}
```

- [ ] **Step 2: Add TypeScript, Vite, HTML, and React entry files**

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], test: { environment: 'node' } });
```

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

```tsx
// src/App.tsx
export default function App() {
  return <main><h1>ELISA analysis</h1></main>;
}
```

```ts
// src/types.ts
export type AssignmentType = 'blank' | 'standard' | 'sample';
export type CurveMode = 'linear' | '4pl' | 'custom';
export interface Well { id: string; row: string; column: number; rawAbsorbance: number | null }
export interface Assignment { type: AssignmentType; groupId?: string }
export interface StandardGroup { id: string; concentration: number; wellIds: string[] }
export interface SampleGroup { id: string; name: string; dilutionFactor: number; wellIds: string[] }
export interface LinearFit { model: 'linear'; slope: number; intercept: number; rSquared: number }
export interface FourPLFit { model: '4pl'; a: number; b: number; c: number; d: number }
export interface ResultRow {
  wellId: string; row: string; column: number; rawAbsorbance: number | null;
  correctedAbsorbance: number | null; assignmentType: AssignmentType | 'unused';
  standardConcentration: number | null; sampleName: string; calculatedConcentration: number | null;
  dilutionFactor: number; finalConcentration: number | null; warningStatus: string;
}
```

- [ ] **Step 3: Install dependencies and verify the empty app compiles after `App.tsx` exists**

Run: `npm install`

Expected: lockfile created with no audit-blocking install error.

- [ ] **Step 4: Commit the bootstrap**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/main.tsx src/App.tsx src/styles.css src/types.ts
git commit -m "build: bootstrap ELISA client"
```

### Task 2: Parse and detect the plate region

**Files:**
- Create: `src/lib/plate.test.ts`
- Create: `src/lib/plate.ts`

- [ ] **Step 1: Write failing parsing tests**

```ts
import { describe, expect, it } from 'vitest';
import { extractPlate, parsePlateCsv } from './plate';

const rows = [
  ['Run', 'ELISA-42'],
  ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  ...'ABCDEFGH'.split('').map((row, r) => [row, ...Array.from({ length: 12 }, (_, c) => String(r + c / 100))]),
];

describe('plate parsing', () => {
  it('detects a labeled 8 by 12 numeric region after metadata', () => {
    const detected = extractPlate(rows);
    expect(detected.sourceRow).toBe(2);
    expect(detected.sourceColumn).toBe(1);
    expect(detected.wells[0]).toMatchObject({ id: 'A1', row: 'A', column: 1, rawAbsorbance: 0 });
    expect(detected.wells).toHaveLength(96);
  });

  it('extracts a manually chosen region', () => {
    expect(extractPlate(rows, { sourceRow: 2, sourceColumn: 1 }).wells.at(-1)?.id).toBe('H12');
  });

  it('parses quoted CSV cells', () => {
    expect(parsePlateCsv('name,value\n"A,1",0.5')).toEqual([['name', 'value'], ['A,1', '0.5']]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `npm test -- src/lib/plate.test.ts`

Expected: FAIL because `src/lib/plate.ts` does not exist.

- [ ] **Step 3: Implement CSV parsing and plate extraction**

```ts
export function parsePlateCsv(csv: string): string[][] {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  return parsed.data.map((row) => row.map((cell) => String(cell).trim()));
}

export function extractPlate(rows: string[][], manual?: Region): PlateData {
  const region = manual ?? detectRegion(rows);
  const values = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 12 }, (_, c) => parseAbsorbance(rows[region.sourceRow + r]?.[region.sourceColumn + c]))
  );
  return { ...region, wells: values.flatMap((row, r) => row.map((rawAbsorbance, c) => ({
    id: `${String.fromCharCode(65 + r)}${c + 1}`,
    row: String.fromCharCode(65 + r), column: c + 1, rawAbsorbance,
  }))) };
}
```

`parseAbsorbance` returns `null` for empty or nonnumeric cells. `detectRegion` scans 8 by 12 candidates, rejects candidates with fewer than 72 numeric cells, and adds one point per matching column header and row header. It returns the highest score and throws `No likely 8 by 12 plate region was found.` when no candidate qualifies.

- [ ] **Step 4: Run the parsing tests**

Run: `npm test -- src/lib/plate.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit plate parsing**

```bash
git add src/lib/plate.ts src/lib/plate.test.ts
git commit -m "feat: detect plate data in CSV files"
```

### Task 3: Implement blank correction, linear fitting, and result rows

**Files:**
- Create: `src/lib/analysis.test.ts`
- Create: `src/lib/analysis.ts`

- [ ] **Step 1: Write failing calculation tests**

```ts
import { describe, expect, it } from 'vitest';
import { calculateBlankMean, correctAbsorbance, fitLinear, invertLinear } from './analysis';

describe('core calculations', () => {
  it('calculates blank mean and corrected values', () => {
    expect(calculateBlankMean([0.1, 0.2])).toBeCloseTo(0.15);
    expect(correctAbsorbance(0.65, 0.15)).toBeCloseTo(0.5);
  });

  it('fits and inverts a linear standard curve', () => {
    const fit = fitLinear([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
    expect(fit).toMatchObject({ slope: 2, intercept: 1 });
    expect(fit.rSquared).toBeCloseTo(1);
    expect(invertLinear(4, fit)).toBeCloseTo(1.5);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- src/lib/analysis.test.ts`

Expected: FAIL because the analysis module does not exist.

- [ ] **Step 3: Implement the minimum calculation functions**

```ts
export const calculateBlankMean = (values: number[]) => {
  if (!values.length) throw new Error('Select blank wells or choose a manual blank option.');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const correctAbsorbance = (raw: number, blank: number) => raw - blank;

export function fitLinear(points: Point[]): LinearFit {
  if (new Set(points.map(({ x }) => x)).size < 2) throw new Error('Linear fitting needs two unique concentrations.');
  const xMean = mean(points.map(({ x }) => x));
  const yMean = mean(points.map(({ y }) => y));
  const slope = sum(points.map(({ x, y }) => (x - xMean) * (y - yMean))) /
    sum(points.map(({ x }) => (x - xMean) ** 2));
  if (!Number.isFinite(slope) || slope === 0) throw new Error('The fitted slope is zero.');
  const intercept = yMean - slope * xMean;
  const residual = sum(points.map(({ x, y }) => (y - (slope * x + intercept)) ** 2));
  const total = sum(points.map(({ y }) => (y - yMean) ** 2));
  return { model: 'linear', slope, intercept, rSquared: total === 0 ? 1 : 1 - residual / total };
}

export const invertLinear = (absorbance: number, fit: Pick<LinearFit, 'slope' | 'intercept'>) =>
  (absorbance - fit.intercept) / fit.slope;
```

Add standard-group aggregation, sample dilution, range warnings, low-R-squared warning, and replicate-variation warnings in `analyzePlate`. Return all 96 `ResultRow` records in well order.

- [ ] **Step 4: Run the calculation tests**

Run: `npm test -- src/lib/analysis.test.ts`

Expected: all core calculation tests pass.

- [ ] **Step 5: Commit core analysis**

```bash
git add src/lib/analysis.ts src/lib/analysis.test.ts
git commit -m "feat: add ELISA blank and linear calculations"
```

### Task 4: Fit and invert 4PL curves

**Files:**
- Modify: `src/lib/analysis.test.ts`
- Modify: `src/lib/analysis.ts`

- [ ] **Step 1: Add a failing synthetic 4PL test**

```ts
import { evaluateFourPL, fitFourPL, invertFourPL } from './analysis';

it('recovers and inverts a synthetic 4PL curve', () => {
  const expected = { model: '4pl' as const, a: 2.1, b: 1.3, c: 12, d: 0.1 };
  const points = [0, 1, 3, 10, 30, 100].map((x) => ({ x, y: evaluateFourPL(x, expected) }));
  const fit = fitFourPL(points);
  expect(evaluateFourPL(8, fit)).toBeCloseTo(evaluateFourPL(8, expected), 2);
  expect(invertFourPL(evaluateFourPL(8, fit), fit)).toBeCloseTo(8, 1);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- src/lib/analysis.test.ts -t 4PL`

Expected: FAIL because the 4PL functions are missing.

- [ ] **Step 3: Implement bounded 4PL fitting and inversion**

```ts
export const evaluateFourPL = (x: number, { a, b, c, d }: FourPLFit) =>
  d + (a - d) / (1 + (x / c) ** b);

export function fitFourPL(points: Point[]): FourPLFit {
  const unique = [...new Map(points.map((point) => [point.x, point])).values()].sort((a, b) => a.x - b.x);
  if (unique.length < 4) throw new Error('4PL fitting needs four unique concentrations.');
  const positiveX = unique.map(({ x }) => x).filter((x) => x > 0);
  const initial = [unique[0].y, 1, positiveX[Math.floor(positiveX.length / 2)], unique.at(-1)!.y];
  const result = levenbergMarquardt(
    { x: unique.map(({ x }) => x), y: unique.map(({ y }) => y) },
    ([a, b, c, d]) => (x) => d + (a - d) / (1 + (x / c) ** b),
    { initialValues: initial, minValues: [-Infinity, 0.05, Number.EPSILON, -Infinity], maxValues: [Infinity, 20, Infinity, Infinity], maxIterations: 500 }
  );
  const [a, b, c, d] = result.parameterValues;
  if (![a, b, c, d].every(Number.isFinite)) throw new Error('4PL fitting did not converge.');
  return { model: '4pl', a, b, c, d };
}

export function invertFourPL(y: number, fit: FourPLFit) {
  const ratio = (fit.a - fit.d) / (y - fit.d) - 1;
  const x = fit.c * ratio ** (1 / fit.b);
  if (ratio < 0 || !Number.isFinite(x) || x < 0) throw new Error('Absorbance is outside the fitted 4PL range.');
  return x;
}
```

Add the warning for fewer than six unique standard concentrations and route 4PL sample calculations through `invertFourPL`.

- [ ] **Step 4: Run all analysis tests**

Run: `npm test -- src/lib/analysis.test.ts`

Expected: blank, linear, warning, dilution, and 4PL tests pass.

- [ ] **Step 5: Commit 4PL support**

```bash
git add src/lib/analysis.ts src/lib/analysis.test.ts
git commit -m "feat: add 4PL curve fitting"
```

### Task 5: Export standardized CSV files

**Files:**
- Create: `src/lib/export.test.ts`
- Create: `src/lib/export.ts`

- [ ] **Step 1: Write a failing results-export test**

```ts
import { expect, it } from 'vitest';
import { resultsToCsv } from './export';

it('exports the required result columns', () => {
  const csv = resultsToCsv([{ wellId: 'A1', row: 'A', column: 1, rawAbsorbance: 0.4,
    correctedAbsorbance: 0.3, assignmentType: 'sample', standardConcentration: null,
    sampleName: 'Serum 1', calculatedConcentration: 2, dilutionFactor: 10,
    finalConcentration: 20, warningStatus: '' }]);
  expect(csv.split('\n')[0]).toBe('well_id,row,column,raw_absorbance,corrected_absorbance,assignment_type,standard_concentration,sample_name,calculated_concentration,dilution_factor,final_concentration,warning_status');
  expect(csv).toContain('A1,A,1,0.4,0.3,sample,,Serum 1,2,10,20,');
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- src/lib/export.test.ts`

Expected: FAIL because the export module does not exist.

- [ ] **Step 3: Implement results, summary, and browser download helpers**

```ts
const RESULT_COLUMNS = ['well_id', 'row', 'column', 'raw_absorbance', 'corrected_absorbance',
  'assignment_type', 'standard_concentration', 'sample_name', 'calculated_concentration',
  'dilution_factor', 'final_concentration', 'warning_status'] as const;

export const resultsToCsv = (rows: ResultRow[]) => Papa.unparse({
  fields: RESULT_COLUMNS,
  data: rows.map((row) => RESULT_COLUMNS.map((column) => row[toCamelCase(column)] ?? '')),
});

export const summaryToCsv = (summary: CurveSummary) => Papa.unparse([
  ['metric', 'value'], ...Object.entries(summary).map(([metric, value]) => [metric, String(value ?? '')]),
]);

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  anchor.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run export tests**

Run: `npm test -- src/lib/export.test.ts`

Expected: required headers and values pass.

- [ ] **Step 5: Commit export support**

```bash
git add src/lib/export.ts src/lib/export.test.ts
git commit -m "feat: export standardized ELISA CSV files"
```

### Task 6: Build the guided workbench UI

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/PlateGrid.tsx`
- Create: `src/components/CurveChart.tsx`
- Create: `src/components/ResultsView.tsx`
- Modify: `src/styles.css`
- Create: `src/fixtures/labeled-plate.csv`

- [ ] **Step 1: Implement the labeled selectable plate**

`PlateGrid` renders an empty corner cell, headers 1 through 12, labels A through H, and 96 buttons. Each button uses its `well.id` as the accessible label, shows its absorbance, and calls `onWellClick(well.id)`. Apply `blank`, `standard`, `sample`, or `unused` classes from the active assignment.

```tsx
<div className="plate-grid" role="grid" aria-label="96-well plate">
  <span className="plate-corner">Row</span>
  {columns.map((column) => <strong key={column}>{column}</strong>)}
  {rows.map((row) => <Fragment key={row}>
    <strong>{row}</strong>
    {wells.filter((well) => well.row === row).map((well) =>
      <button key={well.id} aria-label={`${well.id}: ${well.rawAbsorbance ?? 'invalid'}`}
        className={`well ${assignmentFor(well.id)?.type ?? 'unused'}`}
        disabled={well.rawAbsorbance === null} onClick={() => onWellClick(well.id)}>
        {formatAbsorbance(well.rawAbsorbance)}
      </button>)}
  </Fragment>)}
</div>
```

- [ ] **Step 2: Implement the curve graph and results view**

`CurveChart` maps standard points into a 640 by 320 SVG with 48-pixel margins. It samples 100 fitted values between the minimum and maximum standard concentration and draws one path plus standard-point circles. `ResultsView` renders warnings first, then curve metrics and graph, then the 12-column result table.

- [ ] **Step 3: Implement the six-step state machine**

`App` stores `step`, `plate`, `assignments`, standard groups, sample groups, blank option, curve mode, custom slope and intercept, and the latest analysis. A file upload resets all analysis state before parsing. Back navigation preserves current-file edits; a new upload clears them.

Use these step gates:

- Upload continues after a file parses.
- Confirm continues after automatic or manual extraction produces 96 wells.
- Assign continues when at least one sample exists.
- Configure continues after the chosen blank option and curve mode validate.
- Process calls `analyzePlate` and shows results or an inline blocking error.
- Export calls `downloadCsv` for results and summary.

- [ ] **Step 4: Add the approved styling**

Use a two-column `.app-shell` with a 220-pixel green step rail and a fluid workspace. Keep assignment colors from the design. Set `overflow-x: auto` on plate and table wrappers, sticky row and column headers, visible focus outlines, 44-pixel minimum controls, and a horizontal step strip below 760 pixels.

- [ ] **Step 5: Add the browser fixture and run build checks**

Run: `npm test`

Expected: all parsing, calculation, 4PL, and export tests pass.

Run: `npm run build`

Expected: TypeScript and Vite finish without errors.

- [ ] **Step 6: Commit the workbench**

```bash
git add src/App.tsx src/components src/styles.css src/fixtures
git commit -m "feat: add guided ELISA analysis workflow"
```

### Task 7: Verify the rendered workflow

**Files:**
- Modify only files with defects found during verification.

- [ ] **Step 1: Start the app**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite reports a localhost URL.

- [ ] **Step 2: Complete the desktop workflow in a real browser**

At 1440 by 1000, upload `src/fixtures/labeled-plate.csv`, confirm the detected CSV coordinates, and verify visible A through H and 1 through 12 plate labels. Assign blank replicates, six standard groups, and a diluted sample group. Process Linear, 4PL, and Custom equation modes. Verify each result table, warning area, graph, and both download buttons.

- [ ] **Step 3: Check narrow-screen behavior**

At 390 by 844, verify the step rail becomes a horizontal strip, primary content has no page-level horizontal overflow, and plate and result tables scroll inside their containers while headers remain visible.

- [ ] **Step 4: Capture screenshots and inspect them**

Save one desktop and one narrow screenshot under `outputs/elisa-analysis-app/`. Compare the desktop screenshot with `.superpowers/brainstorm/29168-1782097418/content/workflow-layout-a-v2.html` for step rail, labels, plate density, colors, spacing, and control hierarchy.

- [ ] **Step 5: Re-run final checks after visual fixes**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: build passes.

- [ ] **Step 6: Commit verified fixes**

```bash
git add src outputs/elisa-analysis-app
git commit -m "fix: verify ELISA workflow across viewports"
```
