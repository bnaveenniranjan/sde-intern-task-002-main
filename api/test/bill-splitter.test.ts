import { describe, expect, it } from 'vitest'
import { splitBill } from '../src/bill-splitter'

const members = [
  { id: 'm1', name: 'Asha' },
  { id: 'm2', name: 'Ben' },
  { id: 'm3', name: 'Chitra' },
  { id: 'm4', name: 'Dev' },
  { id: 'm5', name: 'Esha' },
]

describe('splitBill', () => {
  it('splits 1000 cents among 3 members as 334, 333, 333', () => {
    const result = splitBill(1000, members.slice(0, 3))
    expect(result).toEqual([
      { memberId: 'm1', amountCents: 334 },
      { memberId: 'm2', amountCents: 333 },
      { memberId: 'm3', amountCents: 333 },
    ])
  })

  it('splits 1000 cents among 4 members equally', () => {
    const result = splitBill(1000, members.slice(0, 4))
    expect(result).toEqual([
      { memberId: 'm1', amountCents: 250 },
      { memberId: 'm2', amountCents: 250 },
      { memberId: 'm3', amountCents: 250 },
      { memberId: 'm4', amountCents: 250 },
    ])
  })

  it('splits 2 cents among 5 members as 1, 1, 0, 0, 0', () => {
    const result = splitBill(2, members)
    expect(result).toEqual([
      { memberId: 'm1', amountCents: 1 },
      { memberId: 'm2', amountCents: 1 },
      { memberId: 'm3', amountCents: 0 },
      { memberId: 'm4', amountCents: 0 },
      { memberId: 'm5', amountCents: 0 },
    ])
  })

  it('splits 1 cent among 1 member as 1', () => {
    const result = splitBill(1, members.slice(0, 1))
    expect(result).toEqual([{ memberId: 'm1', amountCents: 1 }])
  })

  it('splits 1001 cents among 2 members as 501, 500', () => {
    const result = splitBill(1001, members.slice(0, 2))
    expect(result).toEqual([
      { memberId: 'm1', amountCents: 501 },
      { memberId: 'm2', amountCents: 500 },
    ])
  })

  it('rejects zero amount', () => {
    expect(() => splitBill(0, members)).toThrow('Amount must be positive')
  })

  it('rejects negative amount', () => {
    expect(() => splitBill(-100, members)).toThrow('Amount must be positive')
  })

  it('rejects decimal amount', () => {
    expect(() => splitBill(10.5, members)).toThrow('Amount must be an integer')
  })

  it('rejects non-number amount', () => {
    expect(() => splitBill('1000' as unknown as number, members)).toThrow('Amount must be a number')
  })

  it('rejects null amount', () => {
    expect(() => splitBill(null as unknown as number, members)).toThrow('Amount must be a number')
  })

  it('rejects undefined amount', () => {
    expect(() => splitBill(undefined as unknown as number, members)).toThrow(
      'Amount must be a number',
    )
  })

  it('rejects NaN and Infinity amounts', () => {
    expect(() => splitBill(Number.NaN, members)).toThrow('Amount must be an integer')
    expect(() => splitBill(Number.POSITIVE_INFINITY, members)).toThrow('Amount must be an integer')
    expect(() => splitBill(Number.NEGATIVE_INFINITY, members)).toThrow('Amount must be an integer')
  })

  it('rejects unsafe integer amounts', () => {
    expect(() => splitBill(Number.MAX_SAFE_INTEGER + 1, members)).toThrow(
      'Amount must be a safe integer',
    )
    expect(() => splitBill(Number.MAX_VALUE, members)).toThrow('Amount must be a safe integer')
  })

  it('rejects empty members list', () => {
    expect(() => splitBill(1000, [])).toThrow('Members list cannot be empty')
  })

  it('rejects a missing members list', () => {
    expect(() => splitBill(1000, null as unknown as [])).toThrow('Members list cannot be empty')
  })

  it('distributes the remainder one cent at a time in member order', () => {
    const result = splitBill(7, members.slice(0, 3))
    expect(result.map((share) => share.amountCents)).toEqual([3, 2, 2])
  })

  it('keeps shares in the same order as the members', () => {
    const result = splitBill(1000, members.slice(0, 3))
    expect(result.map((share) => share.memberId)).toEqual(['m1', 'm2', 'm3'])
  })

  it('ensures all shares are non-negative integers', () => {
    const result = splitBill(1000, members.slice(0, 3))
    result.forEach((share) => {
      expect(Number.isInteger(share.amountCents)).toBe(true)
      expect(share.amountCents).toBeGreaterThanOrEqual(0)
    })
  })

  it('ensures sum of shares equals totalCents', () => {
    const testCases = [
      { totalCents: 1000, memberCount: 3 },
      { totalCents: 1000, memberCount: 4 },
      { totalCents: 2, memberCount: 5 },
      { totalCents: 1, memberCount: 1 },
      { totalCents: 1001, memberCount: 2 },
      { totalCents: 999, memberCount: 7 },
      { totalCents: 5000, memberCount: 10 },
    ]

    testCases.forEach(({ totalCents, memberCount }) => {
      const result = splitBill(totalCents, members.slice(0, memberCount))
      const sum = result.reduce((total, share) => total + share.amountCents, 0)
      expect(sum).toBe(totalCents)
    })
  })

  it('accepts the largest safe integer without losing precision', () => {
    const totalCents = Number.MAX_SAFE_INTEGER
    const result = splitBill(totalCents, members.slice(0, 3))

    result.forEach((share) => {
      expect(Number.isSafeInteger(share.amountCents)).toBe(true)
    })
    expect(result.reduce((total, share) => total + share.amountCents, 0)).toBe(totalCents)
  })
})
