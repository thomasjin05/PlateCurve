# ELISA Excel Export and Workflow Improvements

## Goal

Add a browser-generated Excel export that preserves the uploaded source data, presents two color-coded 96-well result plates, and includes a simplified detailed-data sheet. At the same time, avoid analysis work for unused wells, clarify custom equations, remove the low-R² warning, and make completed workflow steps directly navigable.

## Workbook Structure

CSV exports and the normal single-sheet plate-reader Excel case contain three sheets in this order:

1. **Original Data**
2. **Analysis Results**
3. **Well Data**

For an `.xlsx` upload, ExcelJS loads the original workbook and leaves its existing worksheets unchanged. The app appends the two result sheets after the existing source sheets. A normal single-sheet input therefore places analysis second and well data third. A multi-sheet input keeps every source sheet in its existing order, then appends the two result sheets rather than deleting or reordering user data.

For a CSV upload, the app creates a workbook and copies the normalized CSV grid into the first sheet without changing row or column positions. It then appends the two result sheets.

If `Analysis Results` or `Well Data` already exists, the new sheet gets the first available numbered suffix, such as `Analysis Results (2)`. Existing sheets are never replaced.

ExcelJS is dynamically imported only when the user requests the Excel export. The standard upload and analysis workflow does not load it.

## Analysis Results Sheet

The sheet begins with the curve model, equation, variable definition, and fit quality:

- `x` means concentration.
- `y` means corrected absorbance.
- Linear fits show `y = mx + b` with the fitted numerical slope and intercept.
- Custom equations show `y = mx + b` with the user-provided numerical slope and intercept and identify it as user-provided.
- 4PL fits show `y = d + (a - d) / (1 + (x / c)^b)` with the fitted numerical `a`, `b`, `c`, and `d` values substituted.
- R² is shown for fitted linear and fitted 4PL models. It is omitted for custom equations.

The sheet then displays two complete plates with row labels A–H and column labels 1–12:

### Corrected Absorbance Plate

- Blank wells contain their corrected absorbance and use light blue.
- Standard wells contain their corrected absorbance and use light purple.
- Sample wells contain their corrected absorbance and use light green.
- Unused wells contain `0` and use light red.

### Calculated Concentration Plate

- Blank wells contain `0` and use light blue.
- Standard wells contain their designated standard concentration and use light purple.
- Sample wells contain the calculated concentration before applying dilution and use light green.
- Unused wells contain `0` and use light red.

The palette matches the app: blank `#DBEAFE`, standard `#EDE9FE`, sample `#DCFCE7`, unused `#FEE2E2`.

## Well Data Sheet and Results CSV

The third sheet and the downloadable results CSV share this column order:

1. `well_id`
2. `raw_absorbance`
3. `corrected_absorbance`
4. `assignment_type`
5. `calculated_concentration`
6. `dilution_factor`
7. `final_concentration`
8. `warning_status`

The redundant `row`, `column`, and `standard_concentration` columns are removed.

Assignment values are:

- `blank` for blank wells
- `standard` for standard wells
- the user-entered sample name for sample wells
- blank for unused wells

For standard wells, `calculated_concentration` contains the designated standard concentration. For sample wells, it contains the calculated concentration before dilution. `final_concentration` retains the dilution-adjusted result. For unused wells, `well_id` remains populated, `raw_absorbance` is `0`, and all other fields are blank.

CSV formula-injection escaping remains in place.

## Analysis Changes

Only assigned blank, standard, and sample wells are analyzed. Unused wells do not receive blank correction, curve inversion, range checks, dilution calculations, or warnings. The result list still contains all 96 well IDs so the plates and exports retain their physical layout.

The low-fit warning `Linear R² is below 0.98.` is removed from global warnings, row warnings, the app, and exports. R² remains a displayed metric. Replicate variation, outside-range, blank-mode, insufficient-standard, and custom-equation provenance warnings remain.

The 4PL fitter exposes the R² value already derived from residual and total variance calculations.

## App Changes

The Export step adds an `Export Excel workbook` button and retains the two CSV export buttons. Excel export failures appear inline and do not discard the current analysis.

Custom equation mode displays this explanation beside the slope and intercept inputs:

> Corrected absorbance (y) = slope (m) × concentration (x) + intercept (b). The app solves this equation for x to calculate sample concentration.

The workflow rail renders each reachable step as a button:

- Upload is always reachable.
- Confirm is reachable after a file is parsed.
- Assign and Configure are reachable after a valid plate exists.
- Results and Export are reachable after a successful analysis.

Clicking a reachable step changes the view without clearing the file, region, assignments, curve settings, or results. Unreachable future steps remain disabled.

## Error Handling

- Reject Excel export if the source file or completed analysis is unavailable.
- Preserve existing input-size and `.xlsx` validation.
- Surface workbook parse/write failures as concise inline messages.
- Never overwrite an existing worksheet.
- Keep all calculations finite; failed fits continue to stop result generation as before.

## Testing

Unit tests cover:

- unused wells bypassing calculations and exporting as the required blank row
- standard and named-sample assignment values
- simplified CSV headers and standard concentrations in `calculated_concentration`
- removal of the low-R² warning while retaining R² metrics
- 4PL R² calculation
- linear, custom, and 4PL equation text
- CSV-input workbook sheet order and copied source grid
- Excel-input workbook source-sheet preservation, including safe append behavior for multi-sheet input
- unique result-sheet names
- both 8 × 12 result plates, unused zeros, standard concentrations, undiluted sample concentrations, and cell fills
- sidebar reachability and custom-equation explanatory text

Browser verification runs a full CSV and Excel workflow, downloads and reopens each generated workbook, checks all three sheets, tests direct step navigation, confirms both CSV downloads, checks a mobile viewport, and verifies a clean console and production build.
