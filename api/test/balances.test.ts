import { describe, expect, it } from 'vitest'
import { type Balance, call, createBill, createHome, type Member, type Share } from './helpers'

type BalancesResponse = { balances: Balance[] }

function balances(homeId: string) {
  return call<BalancesResponse>('GET', `/api/homes/${homeId}/balances`)
}

function pay(billId: string, shareId: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
}

describe('balances', () => {
  it('returns zero for a member who has no bills', async () => {
    const { homeId, members } = await createHome(['Asha'])
    await createBill(homeId, 300)
    const ben = await call<Member>('POST', `/api/homes/${homeId}/members`, {
      body: { name: 'Ben' },
    })

    const result = await balances(homeId)

    expect(result.status).toBe(200)
    expect(result.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Asha', outstandingCents: 300 },
      { memberId: ben.body.id, name: 'Ben', outstandingCents: 0 },
    ])
  })

  it('returns zero for a member whose shares are all paid', async () => {
    const { homeId, members } = await createHome(['Asha'])
    const bill = await createBill(homeId, 500)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')
    await pay(bill.body.id, share.id)

    const result = await balances(homeId)

    expect(result.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Asha', outstandingCents: 0 },
    ])
  })

  it('adds up multiple unpaid bills for one member', async () => {
    const { homeId, members } = await createHome(['Asha'])
    await createBill(homeId, 300)
    await createBill(homeId, 700)

    const result = await balances(homeId)

    expect(result.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Asha', outstandingCents: 1000 },
    ])
  })

  it('counts only the unpaid shares when a member has paid and unpaid bills', async () => {
    const { homeId, members } = await createHome(['Asha'])
    const paidBill = await createBill(homeId, 500)
    await createBill(homeId, 700)
    const paidShare = paidBill.body.shares[0]
    if (!paidShare) throw new Error('bill has no shares')
    await pay(paidBill.body.id, paidShare.id)

    const result = await balances(homeId)

    expect(result.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Asha', outstandingCents: 700 },
    ])
  })

  it('returns all members in creation order with their own balances', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben', 'Chitra'])
    const bill = await createBill(homeId, 1000)
    const benShare = bill.body.shares[1]
    if (!benShare) throw new Error('bill has no share for Ben')
    await pay(bill.body.id, benShare.id)

    const result = await balances(homeId)

    expect(result.status).toBe(200)
    expect(result.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Asha', outstandingCents: 334 },
      { memberId: members[1]?.id, name: 'Ben', outstandingCents: 0 },
      { memberId: members[2]?.id, name: 'Chitra', outstandingCents: 333 },
    ])
  })

  it('returns 404 when the home does not exist', async () => {
    const result = await balances('does-not-exist')

    expect(result.status).toBe(404)
  })
})
