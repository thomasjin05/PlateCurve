# ELISA Excel Export Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-part Excel export, simplify detailed result data, skip calculations for unused wells, clarify custom equations, remove low-R² warnings while retaining R² values, and make reachable workflow steps clickable.

**Architecture:** Keep calculations in `analysis.ts`, normalize the shared detailed-data shape in `export.ts`, and add one focused `excel-export.ts` module that dynamically imports ExcelJS only during export. React stores the original uploaded `File`, exposes reachable step buttons, and delegates workbook generation to the new module.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Papa Parse, ExcelJS 4.4.0, existing 4PL fitter.

---

## File Map

- Modify `package.json` and `package-lock.json`: add ExcelJS.
- Modify `src/types.ts`: expose fitted 4PL R² without changing evaluation-only parameter objects.
- Modify `src/lib/analysis.ts`: calculate 4PL R², skip unused wells, populate standard concentrations, and remove the low-R² warning.
- Modify `src/lib/analysis.test.ts`: regression coverage for the new analysis behavior.
- Modify `src/lib/export.ts`: define the shared seven-column detailed-data representation.
- Modify `src/lib/export.test.ts`: verify the simplified CSV and 4PL R² summary.
- Create `src/lib/excel-export.ts`: generate and download the workbook.
- Create `src/lib/excel-export.test.ts`: reopen generated workbooks and verify values, sheet order, and fills.
- Modify `src/components/ResultsView.tsx`: display fitted R² for both linear and 4PL models.
- Modify `src/components.test.tsx`: verify fitted 4PL R² remains visible.
- Modify `src/App.tsx`: preserve the source file, add Excel export, step navigation, and equation help.
- Modify `src/App.test.ts`: test reachable-step policy.
- Modify `src/smoke.test.tsx`: test user-facing export and equation copy.
- Modify `src/styles.css`: style sidebar buttons, equation help, export status, and disabled states.

### Task 1: Analysis behavior and fitted 4PL R²

**Files:**
- Modify: `src/types.ts:37-43`
- Modify: `src/lib/analysis.ts:122-238, 355-488`
- Test: `src/lib/analysis.test.ts`

- [ ] **Step 1: Write failing tests for fitted 4PL R², unused wells, standard concentrations, and warning removal**

Add these focused assertions to existing analysis tests:

```ts
it('reports R² for a fitted 4PL curve', () => {
  const source = { model: '4pl' as const, a: 2.4, b: 1.3, c: 10, d: 0.2 }
  const points = [0, 1, 3, 10, 30, 100].map((x) => ({
    x,
    y: evaluateFourPL(x, source),
  }))

  expect(fitFourPL(points).rSquared).toBeCloseTo(1, 6)
})

it('does not calculate values or warnings for unused wells', () => {
  const result = analyzePlate({
    wells: [well('A1', 0.1), well('A2', 1.5)],
    assignments: { A1: { type: 'blank' } },
    standardGroups: [],
    sampleGroups: [],
    blank: { mode: 'selected' },
    curve: { mode: 'custom', slope: 1, intercept: 0 },
  })

  expect(result.rows[1]).toMatchObject({
    wellId: 'A2',
    rawAbsorbance: 0,
    correctedAbsorbance: null,
    assignmentType: 'unused',
    calculatedConcentration: null,
    finalConcentration: null,
    warningStatus: '',
  })
})

it('uses the designated concentration as the standard calculated concentration', () => {
  const result = analyzePlate({
    wells: [well('A1', 0.5)],
    assignments: { A1: { type: 'standard', groupId: 'standard-1' } },
    standardGroups: [
      { id: 'standard-1', concentration: 25, wellIds: ['A1'] },
    ],
    sampleGroups: [],
    blank: { mode: 'none' },
    curve: { mode: 'custom', slope: 1, intercept: 0 },
  })

  expect(result.rows[0].calculatedConcentration).toBe(25)
})
```

Change the existing low-quality linear-fit tests to assert:

```ts
expect(result.summary.rSquared).toBeLessThan(0.98)
expect(result.warnings).not.toContain('Linear R² is below 0.98.')
expect(result.rows.every((row) => !row.warningStatus.includes('R²'))).toBe(true)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- src/lib/analysis.test.ts
```

Expected: failures for missing 4PL `rSquared`, unused-well calculations, standard `calculatedConcentration`, and the still-present low-R² warning.

- [ ] **Step 3: Implement the minimum analysis changes**

Extend the fitted type without forcing evaluation-only 4PL literals to provide R²:

```ts
export interface FourPLFit {
  model: '4pl'
  a: number
  b: number
  c: number
  d: number
  rSquared?: number
}
```

After validating the fitted 4PL parameters, calculate fit quality from the unique standard points:

```ts
const meanY = calculateFiniteMean(
  uniquePoints.map((point) => point.y),
  '4PL responses must have a finite mean.',
)
const residualSum = uniquePoints.reduce(
  (sum, point) => sum + (point.y - evaluateFourPL(point.x, fit)) ** 2,
  0,
)
const totalSum = uniquePoints.reduce(
  (sum, point) => sum + (point.y - meanY) ** 2,
  0,
)
fit.rSquared = totalSum === 0 ? 1 : 1 - residualSum / totalSum
if (!Number.isFinite(fit.rSquared)) throw new Error('Invalid 4PL fit quality.')
```

Delete both branches that add `Linear R² is below 0.98.`. At the start of the result-row mapper, return an unused placeholder before correcting absorbance:

```ts
if (!assignment) {
  return {
    wellId: well.id,
    row: well.row,
    column: well.column,
    rawAbsorbance: 0,
    correctedAbsorbance: null,
    assignmentType: 'unused',
    standardConcentration: null,
    sampleName: '',
    calculatedConcentration: null,
    dilutionFactor: 1,
    finalConcentration: null,
    warningStatus: '',
  }
}
```

Set the row concentration with one expression:

```ts
const calculatedConcentration = standardGroup
  ? standardGroup.concentration
  : sampleGroup && correctedAbsorbance !== null
    ? input.curve.mode === '4pl'
      ? invertFourPL(correctedAbsorbance, fit as FourPLFit)
      : invertLinear(
          correctedAbsorbance,
          input.curve.mode === 'custom' ? input.curve : (fit as LinearFit),
        )
    : null
```

Include 4PL R² in the summary:

```ts
{ a: fit.a, b: fit.b, c: fit.c, d: fit.d, rSquared: fit.rSquared }
```

- [ ] **Step 4: Run the focused and full tests**

Run:

```bash
npm test -- src/lib/analysis.test.ts
npm test
```

Expected: all analysis tests and the full suite pass after updating old expectations that assumed unused wells were corrected.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lib/analysis.ts src/lib/analysis.test.ts
git commit -m "feat: skip unused ELISA wells"
```

### Task 2: Simplified detailed CSV data

**Files:**
- Modify: `src/lib/export.ts:5-37, 49-64`
- Test: `src/lib/export.test.ts`

- [ ] **Step 1: Replace the expected CSV schema in failing tests**

Use this exact header:

```ts
const expectedResultColumns = [
  'well_id',
  'raw_absorbance',
  'corrected_absorbance',
  'assignment_type',
  'calculated_concentration',
  'final_concentration',
  'dilution_factor',
]
```

Add representative row assertions:

```ts
it('uses sample names, standard concentrations, and blank unused fields', () => {
  const rows = [
    resultRow({ sampleName: 'protein' }),
    resultRow({
      wellId: 'A2',
      assignmentType: 'standard',
      sampleName: '',
      standardConcentration: 10,
      calculatedConcentration: 10,
    }),
    resultRow({
      wellId: 'A3',
      assignmentType: 'unused',
      rawAbsorbance: 0,
      correctedAbsorbance: null,
      sampleName: '',
      calculatedConcentration: null,
      finalConcentration: null,
      warningStatus: '',
    }),
  ]

  const parsed = parseCsv(resultsToCsv(rows))
  expect(parsed[1][3]).toBe('protein')
  expect(parsed[2][3]).toBe('standard')
  expect(parsed[2][4]).toBe('10')
  expect(parsed[3]).toEqual(['A3', '0', '', '', '', '', ''])
})
```

Update the 4PL summary test to expect `r_squared`.

- [ ] **Step 2: Run the export tests and verify RED**

Run:

```bash
npm test -- src/lib/export.test.ts
```

Expected: old twelve-column rows and missing 4PL R² fail the new expectations.

- [ ] **Step 3: Implement one shared detailed-row formatter**

Replace `RESULT_COLUMNS` and add a formatter used by CSV and Excel:

```ts
export const RESULT_COLUMNS = [
  'well_id',
  'raw_absorbance',
  'corrected_absorbance',
  'assignment_type',
  'calculated_concentration',
  'final_concentration',
  'dilution_factor',
] as const

export function resultToExportRow(row: ResultRow): Array<string | number | null> {
  if (row.assignmentType === 'unused') {
    return [row.wellId, 0, null, '', null, null, null]
  }

  return [
    row.wellId,
    row.rawAbsorbance,
    row.correctedAbsorbance,
    row.assignmentType === 'sample' ? row.sampleName : row.assignmentType,
    row.assignmentType === 'standard'
      ? row.standardConcentration
      : row.calculatedConcentration,
    row.finalConcentration,
    row.assignmentType === 'sample' ? row.dilutionFactor : null,
  ]
}
```

Make `resultsToCsv()` map through `resultToExportRow()`. Add `r_squared` to the 4PL branch of `summaryToCsv()`.

- [ ] **Step 4: Run tests and commit**

```bash
npm test -- src/lib/export.test.ts
npm test
git add src/lib/export.ts src/lib/export.test.ts
git commit -m "feat: simplify ELISA result exports"
```

Expected: all tests pass and formula-injection tests still cover every exported text column.

### Task 3: Excel workbook generation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/excel-export.ts`
- Create: `src/lib/excel-export.test.ts`

- [ ] **Step 1: Install the pinned workbook dependency**

Run:

```bash
npm install exceljs@4.4.0
```

Expected: `exceljs` appears in dependencies and the lockfile updates.

- [ ] **Step 2: Write failing workbook tests**

Define a small 96-row result fixture and assert fixed sheet positions:

```ts
const ANALYSIS_TITLE_CELL = 'A1'
const MODEL_VALUE_CELL = 'B3'
const EQUATION_VALUE_CELL = 'B5'
const R_SQUARED_VALUE_CELL = 'B6'
const CORRECTED_TOP_LEFT = 'B10'
const CONCENTRATION_TOP_LEFT = 'B21'
```

For CSV input, call the wished-for API and reopen its bytes with ExcelJS:

```ts
const bytes = await buildExcelWorkbook({
  sourceFile: new File(['Instrument,Reader\nRow,1\nA,0.1'], 'plate.csv'),
  imported: {
    format: 'csv',
    rows: [['Instrument', 'Reader'], ['Row', '1'], ['A', '0.1']],
  },
  result,
})
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(bytes)

expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
  'Original Data',
  'Analysis Results',
  'Well Data',
])
expect(workbook.getWorksheet('Original Data')!.getCell('A1').value).toBe('Instrument')
```

Assert the analysis sheet contains:

```ts
expect(analysis.getCell(ANALYSIS_TITLE_CELL).value).toBe('ELISA Analysis Results')
expect(analysis.getCell(MODEL_VALUE_CELL).value).toBe('linear')
expect(analysis.getCell(EQUATION_VALUE_CELL).value).toBe('y = 2x + 0.5')
expect(analysis.getCell(R_SQUARED_VALUE_CELL).value).toBe(0.99)
expect(analysis.getCell(CORRECTED_TOP_LEFT).value).toBe(0)
expect(analysis.getCell(CONCENTRATION_TOP_LEFT).value).toBe(0)
```

Assert an unused well has `0` and fill `FFFEE2E2`, a standard uses its designated concentration and fill `FFEDE9FE`, and a sample concentration excludes dilution and uses fill `FFDCFCE7`.

For Excel input, load `src/fixtures/two-sheet-plate.xlsx`, build the export, and assert both original sheet names and sentinel values remain before the two appended sheets. Add an input workbook containing existing result-sheet names and assert `(2)` suffixes are used.

- [ ] **Step 3: Run the workbook tests and verify RED**

Run:

```bash
npm test -- src/lib/excel-export.test.ts
```

Expected: module-not-found failure for `excel-export.ts`.

- [ ] **Step 4: Implement equation formatting and workbook construction**

Create this public interface:

```ts
export interface ExcelExportInput {
  sourceFile: File
  imported: ImportedTable
  result: AnalysisResult
}

export function formatCurveEquation(summary: CurveSummary): string
export async function buildExcelWorkbook(input: ExcelExportInput): Promise<Uint8Array>
export function downloadExcel(filename: string, bytes: Uint8Array): void
```

Use these equation forms:

```ts
if (summary.model === '4pl') {
  return `y = ${format(summary.d)} + (${format(summary.a)} - ${format(summary.d)}) / (1 + (x / ${format(summary.c)})^${format(summary.b)})`
}
return `y = ${format(summary.slope)}x + ${format(summary.intercept)}`
```

Inside `buildExcelWorkbook()`, dynamically load ExcelJS:

```ts
const { default: ExcelJS } = await import('exceljs')
const workbook = new ExcelJS.Workbook()
if (input.imported.format === 'xlsx') {
  await workbook.xlsx.load(await input.sourceFile.arrayBuffer())
} else {
  const source = workbook.addWorksheet('Original Data')
  source.addRows(input.imported.rows)
}
```

Use `uniqueSheetName(workbook, base)` to append without overwriting. Build `Analysis Results` at the tested addresses, including two 8 × 12 plates with A–H and 1–12 headers. Use these fills:

```ts
const FILLS = {
  blank: 'FFDBEAFE',
  standard: 'FFEDE9FE',
  sample: 'FFDCFCE7',
  unused: 'FFFEE2E2',
} as const
```

For corrected absorbance, write `0` for unused and `row.correctedAbsorbance` otherwise. For concentration, write standard designated values, sample undiluted calculated values, and `0` for blank/unused. Build `Well Data` from `RESULT_COLUMNS` and `resultToExportRow()`.

Return:

```ts
return new Uint8Array(await workbook.xlsx.writeBuffer())
```

Create the browser download with MIME type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and the same anchor cleanup pattern as `downloadCsv()`.

- [ ] **Step 5: Run workbook tests, full tests, and build**

```bash
npm test -- src/lib/excel-export.test.ts
npm test
npm run build
```

Expected: workbook tests pass, the suite passes, and Vite emits ExcelJS as a separate lazy chunk.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/excel-export.ts src/lib/excel-export.test.ts
git commit -m "feat: export styled ELISA workbooks"
```

### Task 4: Reachable workflow steps and export UI

**Files:**
- Modify: `src/App.tsx:184-277, 484-502, 735-793`
- Modify: `src/App.test.ts`
- Modify: `src/smoke.test.tsx`
- Modify: `src/components/ResultsView.tsx`
- Modify: `src/components.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing reachability and copy tests**

Export a pure helper from `App.tsx` and test:

```ts
expect(maximumReachableStep({ imported: false, plate: false, result: false })).toBe(1)
expect(maximumReachableStep({ imported: true, plate: false, result: false })).toBe(2)
expect(maximumReachableStep({ imported: true, plate: true, result: false })).toBe(4)
expect(maximumReachableStep({ imported: true, plate: true, result: true })).toBe(6)
```

Extend the smoke test to require:

```ts
expect(markup).toContain('Export Excel workbook')
expect(markup).toContain('Corrected absorbance (y)')
expect(markup).toContain('concentration (x)')
```

Add a `ResultsView` test using a 4PL summary with `rSquared: 0.995` and assert the rendered summary includes `R²` and `0.995` without a low-R² warning.

- [ ] **Step 2: Run UI tests and verify RED**

```bash
npm test -- src/App.test.ts src/smoke.test.tsx src/components.test.tsx
```

Expected: missing reachability helper and missing user-facing strings.

- [ ] **Step 3: Store the source file and add the Excel handler**

Add state:

```ts
const [sourceFile, setSourceFile] = useState<File | null>(null)
const [excelExporting, setExcelExporting] = useState(false)
const [excelExportError, setExcelExportError] = useState('')
```

Set `sourceFile` only after `parseInputFile()` succeeds and clear it in `startNewAnalysis()`. Add:

```ts
const exportExcel = async () => {
  if (!sourceFile || !imported || !result) {
    setExcelExportError('Load and analyze a plate before exporting Excel.')
    return
  }
  setExcelExporting(true)
  setExcelExportError('')
  try {
    const { buildExcelWorkbook, downloadExcel } = await import('./lib/excel-export')
    const bytes = await buildExcelWorkbook({ sourceFile, imported, result })
    downloadExcel(`${baseName}-analysis.xlsx`, bytes)
  } catch (error) {
    setExcelExportError(error instanceof Error ? error.message : String(error))
  } finally {
    setExcelExporting(false)
  }
}
```

- [ ] **Step 4: Render reachable step buttons and equation help**

Add the pure helper:

```ts
export function maximumReachableStep(state: {
  imported: boolean
  plate: boolean
  result: boolean
}): number {
  if (state.result) return 6
  if (state.plate) return 4
  if (state.imported) return 2
  return 1
}
```

Inside each rail item, render a button disabled above the maximum reachable step. Keep `aria-current="step"` on the active button and call `setStep(number)` on click.

Add this custom-equation copy directly above the slope/intercept inputs:

```tsx
<p className="equation-help">
  Corrected absorbance (y) = slope (m) × concentration (x) + intercept (b).
  The app solves this equation for x to calculate sample concentration.
</p>
```

Move the R² summary row out of the linear-only block in `ResultsView` and render it whenever `summary.rSquared !== undefined`. Linear and fitted 4PL results then show the retained metric; custom equations do not.

Add the Excel action before CSV actions:

```tsx
<button
  className="primary-button"
  disabled={excelExporting}
  onClick={() => void exportExcel()}
  type="button"
>
  {excelExporting ? 'Preparing Excel…' : 'Export Excel workbook'}
</button>
```

Render `excelExportError` with `role="alert"`. Update export copy to mention Excel and CSV.

- [ ] **Step 5: Add minimal CSS and run tests/build**

Reset rail-button native styles while preserving the existing active/complete colors, add visible focus outlines, and style `.equation-help` as muted explanatory text. Do not change the approved overall layout.

Run:

```bash
npm test -- src/App.test.ts src/smoke.test.tsx src/components.test.tsx
npm test
npm run build
```

Expected: all tests pass and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.ts src/smoke.test.tsx src/components/ResultsView.tsx src/components.test.tsx src/styles.css
git commit -m "feat: add Excel export workflow"
```

### Task 5: End-to-end verification

**Files:**
- No production changes unless verification reproduces a defect.
- Save QA screenshots under `outputs/elisa-analysis-app/`.

- [ ] **Step 1: Start the app and verify initial browser state**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Open the reported local URL. Confirm the upload page renders, the console has no errors, and future rail steps are disabled.

- [ ] **Step 2: Verify the CSV workflow**

Upload `src/fixtures/labeled-plate.csv`. Confirm rows 6–13 and columns B–M. Assign blanks, six standard concentrations, and a diluted named sample. Verify direct rail navigation preserves state. Process linear, 4PL, and custom modes and verify the custom equation explanation.

Export Excel and reopen it. Confirm:

- sheet order is `Original Data`, `Analysis Results`, `Well Data`
- original CSV rows retain their positions
- equation and R² values match the selected model
- both plates contain 96 values with category fills
- unused wells are red zeros
- standard concentrations are designated values
- sample plate concentrations are pre-dilution values
- Well Data uses the seven-column schema without `warning_status`

- [ ] **Step 3: Verify the Excel workflow**

Upload `src/fixtures/labeled-plate.xlsx`, repeat the assignment, and export. Reopen the output and compare the first source worksheet values/styles before and after. Confirm result sheets are appended and detailed data matches the CSV workflow.

- [ ] **Step 4: Verify existing CSV downloads and responsiveness**

Download results CSV and curve-summary CSV. Confirm the simplified schema, sample names in `assignment_type`, no low-R² warning, and retained R² metric. At 390 × 844, verify rail buttons scroll horizontally and plates stay inside their own horizontal scrollers.

- [ ] **Step 5: Run final automated verification**

```bash
npm test
npm run build
git diff --check
git status --short
```

Expected: all tests pass, production build succeeds, no whitespace errors, and only intentional QA artifacts remain untracked.

- [ ] **Step 6: Commit any test-driven verification fix**

If verification exposed a reproducible defect, add one failing regression test, apply the smallest fix, rerun the relevant test plus the full suite, then commit only that fix. If no defect appears, do not create an empty commit.
