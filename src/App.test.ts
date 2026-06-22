import { expect, test } from 'vitest'

import { countUniqueAssignedStandardConcentrations } from './App'
import type { StandardGroup } from './types'

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
