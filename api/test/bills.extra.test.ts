import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { type Bill, call, createBill, createHome } from './helpers'

describe('create a bill: additional coverage', () => {
  it.each([undefined, '', '   ', 42, null])('rejects the title %j', async (title) => {
    const { homeId } = await createHome(['Asha', 'Ben'])

    const bill = await call('POST', `/api/homes/${homeId}/bills`, {
      body: { title, totalCents: 1000 },
    })

    expect(bill.status).toBe(400)
  })

  it('trims the title and returns the stored bill and shares', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])

    const bill = await call<Bill>('POST', `/api/homes/${homeId}/bills`, {
      body: { title: '  Electricity  ', totalCents: 1000 },
    })

    expect(bill.status).toBe(201)
    expect(bill.body).toMatchObject({
      homeId,
      title: 'Electricity',
      totalCents: 1000,
      shares: [
        { memberId: members[0]?.id, amountCents: 500, paidAt: null },
        { memberId: members[1]?.id, amountCents: 500, paidAt: null },
      ],
    })
    expect(bill.body.id).toEqual(expect.any(String))
    expect(new Set(bill.body.shares.map((share) => share.id)).size).toBe(2)

    const storedBill = await env.DB.prepare('SELECT title, total_cents FROM bills WHERE id = ?')
      .bind(bill.body.id)
      .first<{ title: string; total_cents: number }>()
    expect(storedBill).toEqual({ title: 'Electricity', total_cents: 1000 })

    const storedShares = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM shares WHERE bill_id = ?',
    )
      .bind(bill.body.id)
      .first<{ count: number }>()
    expect(storedShares?.count).toBe(2)
  })

  it('allows a bill smaller than the member count by giving zero-cent shares', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben', 'Chitra', 'Dev', 'Esha'])

    const bill = await createBill(homeId, 2)

    expect(bill.status).toBe(201)
    expect(bill.body.shares.map((share) => share.memberId)).toEqual(
      members.map((member) => member.id),
    )
    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([1, 1, 0, 0, 0])
    expect(bill.body.shares.reduce((total, share) => total + share.amountCents, 0)).toBe(2)

    const storedShares = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM shares WHERE bill_id = ?',
    )
      .bind(bill.body.id)
      .first<{ count: number }>()
    expect(storedShares?.count).toBe(5)
  })

  it('rolls back the whole batch when a share insert fails', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    await env.DB.prepare(
      "CREATE TRIGGER fail_share_insert BEFORE INSERT ON shares BEGIN SELECT RAISE(ABORT, 'boom'); END",
    ).run()

    try {
      const bill = await createBill(homeId, 1000)
      expect(bill.status).toBe(500)

      const storedBills = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM bills WHERE home_id = ?',
      )
        .bind(homeId)
        .first<{ count: number }>()
      expect(storedBills?.count).toBe(0)
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS fail_share_insert').run()
    }
  })
})
