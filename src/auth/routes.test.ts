import { describe, expect, it } from 'vitest'
import { landingPath } from './routes'

describe('landingPath', () => {
  it.each([
    ['super_admin', '/super-admin/dashboard'],
    ['staff', '/staff/dashboard'],
    ['student', '/student/dashboard'],
  ] as const)('routes %s to its dashboard', (accountType, expectedPath) => {
    expect(landingPath(accountType)).toBe(expectedPath)
  })
})
