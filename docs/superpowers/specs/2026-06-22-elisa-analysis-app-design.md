# ELISA Analysis App Design

## Goal

Build a browser-only app that converts plate-reader CSV files into traceable ELISA results. A researcher confirms the detected 96-well plate, assigns wells, fits a linear or 4PL curve, reviews warnings, and exports standardized CSV files.

## Scope

The first release supports:

- 8 by 12 plates with row labels A through H and column labels 1 through 12
- CSV files with metadata before or around the plate region
- blank, standard, sample, and unused well assignments
- replicate standard concentrations and named sample groups
- linear regression, 4PL regression, and a user-provided linear equation
- dilution factors, results warnings, a standard-curve graph, and two CSV exports

The app has no backend, authentication, database, autosave, or model auto-selection. Uploading another file resets the prior plate, assignments, blank choice, fitted curve, and custom equation.

## Architecture

Use React and Vite for the client app. Papa Parse 5.5.4 handles quoted CSV fields and irregular rows. `ml-levenberg-marquardt` 5.0.1 fits the four 4PL parameters in the browser. A native SVG component draws the standard curve, so the app needs no chart package.

Keep calculation code outside React:

- `plate.ts` parses CSV rows, detects a plate region, and maps values to well IDs.
- `analysis.ts` calculates blank correction, linear regression, 4PL fitting, inverse concentrations, warnings, and final results.
- `export.ts` creates the results and curve-summary CSV text.
- React components own the six-step workflow and pass plain data to those functions.

Vitest runs focused unit tests for parsing, calculations, curve fitting, and export.

## User Interface

Use the approved guided workbench. A dark green step rail shows all six steps while one task fills the main workspace. The plate and result surfaces use white backgrounds, thin neutral borders, and restrained assignment colors:

- blank: blue
- standard: violet
- sample: green
- unused: white

The workflow is:

1. Upload CSV
2. Confirm plate data
3. Assign wells
4. Configure curve
5. Process results
6. Export

The plate grid keeps row labels A through H and column labels 1 through 12 visible. The confirmation view also reports the source CSV row and column range. An “Adjust plate region” control lets the researcher set the top-left data cell when detection misses the intended region.

The assignment toolbar provides Blank, Standard, Sample, and Clear modes. Standard mode requires an active concentration group before selection. Sample mode requires an active sample name and dilution factor. A side inspector lists groups and their wells. Clicking a selected well again leaves its current group unchanged; Clear removes its assignment.

The curve step offers Linear, 4PL, and Custom equation modes. Linear and 4PL use standard groups. Custom mode accepts slope and intercept for:

`concentration = (corrected absorbance - intercept) / slope`

The results view places warnings above the standardized table and curve summary. It includes the SVG graph when the researcher chose Linear or 4PL. The export step provides separate “Export results CSV” and “Export curve summary CSV” buttons.

Desktop keeps the step rail fixed beside the workspace. Narrow screens move the steps into a horizontal scroll area and allow horizontal scrolling inside the plate and results tables. The app keeps row and column headers visible within each scroll container.

## CSV Detection

Papa Parse returns a rectangular array after padding short rows with empty strings. Detection scans candidate cells for an 8 by 12 numeric block. It scores candidates higher when the cell above the block contains column headers 1 through 12 and the cells to the left contain row headers A through H. The highest-scoring complete block becomes the preview.

The app reports a clear parsing error when it finds no complete numeric block. The researcher can then enter the source row and column of the top-left absorbance cell. Manual selection still requires 8 rows and 12 columns of numeric values. Blank cells inside that region remain visible as invalid wells and cannot receive an assignment.

## Calculations

The app calculates the mean raw absorbance of blank wells. With manual blank mode, it uses the entered value. With confirmed no-correction mode, it uses zero. It subtracts that blank value from each valid raw absorbance.

For standards, the app groups wells by entered concentration and calculates the mean corrected absorbance for each group. Linear mode fits corrected absorbance as `y = slope * concentration + intercept`. It reports slope, intercept, and R squared, then solves concentration as `(corrected absorbance - intercept) / slope`.

4PL mode fits:

`y = d + (a - d) / (1 + (x / c) ^ b)`

The fitter uses the unique standard concentrations and their mean corrected absorbances. It initializes `a` and `d` from endpoint responses, `c` from the median positive concentration, and `b` at 1. It requires at least four unique concentrations to fit four parameters and reports a warning below six unique concentrations. The inverse calculation solves for `x` only when the corrected absorbance falls inside the fitted asymptotes and the expression produces a finite non-negative value. Failed fits stop concentration calculation and show the fitting error.

The app multiplies each calculated sample concentration by its dilution factor. It preserves the unadjusted calculated concentration and the final concentration in the output.

## Guardrails

Processing stops until the researcher resolves each blocking condition:

- No blanks: choose no correction or enter a manual blank value.
- No standards: choose Custom equation or assign standards.
- Linear or custom slope equals zero.
- Linear fit has fewer than two unique concentrations.
- 4PL fit has fewer than four unique concentrations or does not converge.

The app shows non-blocking warnings near the results:

- linear R squared below 0.98
- fewer than six unique 4PL concentrations
- sample corrected absorbance outside the observed standard response range
- standard replicate coefficient of variation above 20 percent when the replicate mean is nonzero
- one replicate differs from a zero-mean group by more than 0.05 absorbance units

The result row repeats the applicable warning text so exported data retains the warning.

## Output

The results table and CSV contain these columns in this order:

1. `well_id`
2. `row`
3. `column`
4. `raw_absorbance`
5. `corrected_absorbance`
6. `assignment_type`
7. `standard_concentration`
8. `sample_name`
9. `calculated_concentration`
10. `dilution_factor`
11. `final_concentration`
12. `warning_status`

The table includes all 96 wells, including unused and invalid wells. Empty fields remain empty in CSV output.

The curve-summary CSV uses `metric,value` rows. It includes model name, blank mean, blank count, standard well count, standard range, warnings, and either the linear values or the 4PL parameters. Custom mode identifies results as `calculated using user-provided equation` and records its slope and intercept.

## Verification

Vitest covers:

- plate detection with metadata and labeled row and column headers
- manual plate-region selection
- blank mean and corrected absorbance
- linear slope, intercept, R squared, and inverse concentration
- synthetic 4PL parameter recovery and inverse concentration within a practical tolerance
- dilution-factor application and warning generation
- results CSV headers and representative values

Browser verification runs the complete workflow with a labeled fixture CSV. It checks automatic detection, visible A through H and 1 through 12 headers, well assignment, replicate groups, each curve mode, warnings, graph rendering, exports, a desktop viewport, and a narrow viewport.

## Success Criteria

The app builds without errors, all unit tests pass, and the browser workflow produces downloadable results and curve-summary CSV files. Linear, 4PL, and custom modes calculate known fixture values within their test tolerances. A new upload clears prior analysis state.
