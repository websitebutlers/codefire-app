import { describe, it, expect } from 'vitest'

describe('test setup', () => {
  it('works', () => {
    expect(1 + 1).toBe(2)
  })

  it('can import shared types', async () => {
    const { COLORS } = await import('../shared/theme')
    expect(COLORS.orange).toBe('#f97316')
  })
})
