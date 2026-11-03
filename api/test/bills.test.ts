import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { type Bill, call, createBill, createHome } from './helpers'

describe('create a bill', () => {
  it('splits an even amount equally', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const bill = await createBill(homeId, 3000)

    expect(bill.status).toBe(201)
    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([1000, 1000, 1000])
  })

  it('gives the extra cents to the first members, in the order they were added', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben', 'Chitra'])

    const bill = await createBill(homeId, 1000)

    expect(bill.status).toBe(201)
    expect(bill.body.shares.map((share) => share.memberId)).toEqual(members.map((m) => m.id))
    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([334, 333, 333])
  })

  it('always makes the shares add up to the total', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra', 'Dev', 'Esha', 'Farid', 'Gita'])

    const bill = await createBill(homeId, 100001)

    const sum = bill.body.shares.reduce((total, share) => total + share.amountCents, 0)
    expect(sum).toBe(100001)
  })

  it('gives the whole amount to a home with one member', async () => {
    const { homeId } = await createHome(['Asha'])

    const bill = await createBill(homeId, 4999)

    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([4999])
  })

  it('starts every share as unpaid', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])

    const bill = await createBill(homeId, 500)

    expect(bill.body.shares.every((share) => share.paidAt === null)).toBe(true)
  })

  it('rejects a home with no members', async () => {
    const { homeId } = await createHome([])

    const bill = await createBill(homeId, 1000)

    expect(bill.status).toBe(422)
  })

  it.each([0, -100, 10.5, '1000', null])('rejects the amount %j', async (totalCents) => {
    const { homeId } = await createHome(['Asha', 'Ben'])

    const bill = await call('POST', `/api/homes/${homeId}/bills`, {
      body: { title: 'Rent', totalCents },
    })

    expect(bill.status).toBe(422)
  })

  it('returns 404 when the home does not exist', async () => {
    const bill = await createBill('does-not-exist', 1000)

    expect(bill.status).toBe(404)
  })

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

  it('rolls back the bill when creating a share fails', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])

    // One cent cannot be shared between two members without creating a
    // zero-cent share, which the shares table rejects.
    const bill = await createBill(homeId, 1)

    expect(bill.status).toBe(500)

    const storedBills = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM bills WHERE home_id = ?',
    )
      .bind(homeId)
      .first<{ count: number }>()
    expect(storedBills?.count).toBe(0)
  })
})
