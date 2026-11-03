export type Member = { id: string; name: string }
export type Share = { memberId: string; amountCents: number }

/**
 * Splits a bill amount equally among members using integer arithmetic.
 * Remainder cents are distributed one by one in member creation order.
 *
 * Formula: with `n` members, every member receives `floor(total / n)` cents,
 * and the first `total % n` members receive one extra cent. This guarantees
 * that all shares differ by at most one cent and that they sum to `total`.
 *
 * @param totalCents - Total bill amount in cents (must be a positive safe integer)
 * @param members - Ordered list of members (must not be empty)
 * @returns Array of shares with memberId and amountCents, in member order
 * @throws Error if totalCents is invalid or members list is empty
 */
export function splitBill(totalCents: unknown, members: Member[]): Share[] {
  // Validate totalCents: must be a number, integer, positive, and safe.
  if (typeof totalCents !== 'number') {
    throw new Error('Amount must be a number')
  }
  if (!Number.isInteger(totalCents)) {
    throw new Error('Amount must be an integer')
  }
  if (totalCents <= 0) {
    throw new Error('Amount must be positive')
  }
  if (!Number.isSafeInteger(totalCents)) {
    throw new Error('Amount must be a safe integer')
  }

  // Validate members: must not be empty.
  if (!members || members.length === 0) {
    throw new Error('Members list cannot be empty')
  }

  const memberCount = members.length
  const baseAmount = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  return members.map((member, index) => ({
    memberId: member.id,
    // The first `remainder` members absorb the leftover cents, one each.
    amountCents: baseAmount + (index < remainder ? 1 : 0),
  }))
}
