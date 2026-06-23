import { expect, test } from 'vitest'

import {
  CUSTOM_EQUATION_HELP,
  countUniqueAssignedStandardConcentrations,
  maximumReachableStep,
  redoWorkspace,
  recordWorkspaceHistory,
  resolveGroupDrafts,
  undoWorkspace,
  wellIdsInRange,
} from './App'
import type { SampleGroup, StandardGroup } from './types'

test('duplicate assigned standard concentrations count once for the 4PL warning', () => {
  const groups: StandardGroup[] = [0, 0, 1, 2, 3, 4].map((concentration, index) => ({
    id: `standard-${index + 1}`,
    concentration,
    wellIds: [`A${index + 1}`],
  }))

  const count = countUniqueAssignedStandardConcentrations(groups)

  expect(count).toBe(5)
  expect(count).toBeLessThan(6)
})

test('group drafts preserve valid edits for analysis', () => {
  const standardGroups: StandardGroup[] = [
    { id: 'standard-1', concentration: 1, wellIds: ['A1'] },
  ]
  const sampleGroups: SampleGroup[] = [
    { id: 'sample-1', name: 'Old name', dilutionFactor: 1, wellIds: ['B1'] },
  ]

  const resolved = resolveGroupDrafts(standardGroups, sampleGroups, {
    standardConcentrations: { 'standard-1': ' 10.5 ' },
    sampleNames: { 'sample-1': ' Patient 1 ' },
    sampleDilutions: { 'sample-1': '20' },
  })

  expect(resolved.standardGroups[0].concentration).toBe(10.5)
  expect(resolved.sampleGroups[0]).toMatchObject({ name: 'Patient 1', dilutionFactor: 20 })
})

test('group drafts reject intermediate or empty scientific inputs', () => {
  const standards: StandardGroup[] = [
    { id: 'standard-1', concentration: 1, wellIds: ['A1'] },
  ]
  const samples: SampleGroup[] = [
    { id: 'sample-1', name: 'Sample', dilutionFactor: 1, wellIds: ['B1'] },
  ]

  expect(() =>
    resolveGroupDrafts(standards, samples, {
      standardConcentrations: { 'standard-1': '-' },
      sampleNames: {},
      sampleDilutions: {},
    }),
  ).toThrow('Standard standard-1 concentration must be a finite number.')
  expect(() =>
    resolveGroupDrafts(standards, samples, {
      standardConcentrations: {},
      sampleNames: { 'sample-1': '   ' },
      sampleDilutions: {},
    }),
  ).toThrow('Sample sample-1 name is required.')
  expect(() =>
    resolveGroupDrafts(standards, samples, {
      standardConcentrations: {},
      sampleNames: {},
      sampleDilutions: { 'sample-1': '' },
    }),
  ).toThrow('Sample sample-1 dilution factor must be greater than zero.')
})

test('workflow steps become reachable as analysis state is created', () => {
  expect(maximumReachableStep({ imported: false, plate: false, result: false })).toBe(1)
  expect(maximumReachableStep({ imported: true, plate: false, result: false })).toBe(2)
  expect(maximumReachableStep({ imported: true, plate: true, result: false })).toBe(4)
  expect(maximumReachableStep({ imported: true, plate: true, result: true })).toBe(6)
})

test('custom equation help defines x and y', () => {
  expect(CUSTOM_EQUATION_HELP).toContain('Corrected absorbance (y)')
  expect(CUSTOM_EQUATION_HELP).toContain('concentration (x)')
  expect(CUSTOM_EQUATION_HELP).toContain('solves this equation for x')
})

test('well range covers the rectangle between two plate wells', () => {
  expect(
    wellIdsInRange('A1', 'B3', new Set(['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])),
  ).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])
})

test('assignment history records undo and redo states', () => {
  const empty = {
    assignments: {},
    standardGroups: [],
    sampleGroups: [],
    activeStandardId: '',
    activeSampleId: '',
  }
  const assigned = {
    ...empty,
    assignments: { A1: { type: 'blank' as const } },
  }
  const history = recordWorkspaceHistory({ past: [], future: [empty] }, empty, assigned)

  expect(history).toEqual({ past: [empty], future: [] })

  const undone = undoWorkspace(history, assigned)
  expect(undone.workspace).toBe(empty)
  expect(undone.history).toEqual({ past: [], future: [assigned] })

  const redone = redoWorkspace(undone.history, undone.workspace)
  expect(redone.workspace).toBe(assigned)
  expect(redone.history).toEqual({ past: [empty], future: [] })
})
