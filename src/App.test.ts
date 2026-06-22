import { expect, test } from 'vitest'

import { countUniqueAssignedStandardConcentrations, resolveGroupDrafts } from './App'
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
