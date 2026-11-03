import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createBill, createHome, type Share } from './helpers'

async function setup() {
  const { homeId } = await createHome(['Asha', 'Ben'])
  const bill = await createBill(homeId, 1000)
  const firstShare = bill.body.shares[0]
  if (!firstShare) throw new Error('bill has no shares')
  return { billId: bill.body.id, firstShare }
}

function pay(billId: string, shareId: string, key?: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: key ? { 'Idempotency-Key': key } : {},
  })
}

describe('pay a share: additional coverage', () => {
  it.each(['', '   '])('rejects an invalid Idempotency-Key %j', async (key) => {
    const { billId, firstShare } = await setup()

    const paid = await call<Share>('POST', `/api/bills/${billId}/shares/${firstShare.id}/pay`, {
      headers: { 'Idempotency-Key': key },
    })

    expect(paid.status).toBe(400)
  })

  it('returns 404 when the share belongs to another bill', async () => {
    const { homeId } = await createHome(['Asha'])
    const firstBill = await createBill(homeId, 100)
    const secondBill = await createBill(homeId, 100)
    const secondBillShare = secondBill.body.shares[0]
    if (!secondBillShare) throw new Error('bill has no shares')

    const paid = await pay(firstBill.body.id, secondBillShare.id, crypto.randomUUID())

    expect(paid.status).toBe(404)

    const stored = await env.DB.prepare('SELECT paid_at FROM shares WHERE id = ?')
      .bind(secondBillShare.id)
      .first<{ paid_at: string | null }>()
    expect(stored?.paid_at).toBeNull()
  })

  it('pays once when two requests with the same key race', async () => {
    const { billId, firstShare } = await setup()
    const key = crypto.randomUUID()

    const [first, second] = await Promise.all([
      pay(billId, firstShare.id, key),
      pay(billId, firstShare.id, key),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.paidAt).toBe(first.body.paidAt)

    const stored = await env.DB.prepare('SELECT paid_at, idempotency_key FROM shares WHERE id = ?')
      .bind(firstShare.id)
      .first<{ paid_at: string | null; idempotency_key: string | null }>()
    expect(stored).toEqual({ paid_at: first.body.paidAt, idempotency_key: key })
  })

  it('allows only one of two concurrent requests with different keys to pay', async () => {
    const { billId, firstShare } = await setup()
    const firstKey = crypto.randomUUID()
    const secondKey = crypto.randomUUID()

    const [first, second] = await Promise.all([
      pay(billId, firstShare.id, firstKey),
      pay(billId, firstShare.id, secondKey),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])

    const winner = first.status === 200 ? first : second
    const winningKey = first.status === 200 ? firstKey : secondKey

    const stored = await env.DB.prepare('SELECT paid_at, idempotency_key FROM shares WHERE id = ?')
      .bind(firstShare.id)
      .first<{ paid_at: string | null; idempotency_key: string | null }>()
    expect(stored).toEqual({ paid_at: winner.body.paidAt, idempotency_key: winningKey })
  })
})
