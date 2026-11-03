import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createBill, createHome } from './helpers'

describe('database constraints', () => {
  it('rejects duplicate primary keys', async () => {
    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, 'Home').run()

    await expect(
      env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, 'Other').run(),
    ).rejects.toThrow()
  })

  it('rejects a member whose home does not exist', async () => {
    await expect(
      env.DB.prepare('INSERT INTO members (id, home_id, name, position) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), 'missing-home', 'Asha', 0)
        .run(),
    ).rejects.toThrow()
  })

  it('rejects two members with the same position in one home', async () => {
    const { homeId } = await createHome(['Asha'])
    const secondId = crypto.randomUUID()

    await expect(
      env.DB.prepare('INSERT INTO members (id, home_id, name, position) VALUES (?, ?, ?, ?)')
        .bind(secondId, homeId, 'Ben', 0)
        .run(),
    ).rejects.toThrow()
  })

  it('rejects a non-positive bill total', async () => {
    const { homeId } = await createHome(['Asha'])

    await expect(
      env.DB.prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), homeId, 'Bill', 0)
        .run(),
    ).rejects.toThrow()
  })

  it('rejects a negative share amount', async () => {
    const { homeId, members } = await createHome(['Asha'])
    const bill = await createBill(homeId, 100)
    const member = members[0]
    if (!member) throw new Error('missing member')

    await expect(
      env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), bill.body.id, member.id, -1, null)
        .run(),
    ).rejects.toThrow()
  })

  it('rejects two shares for the same member and bill', async () => {
    const { homeId, members } = await createHome(['Asha'])
    const bill = await createBill(homeId, 100)
    const member = members[0]
    if (!member) throw new Error('missing member')

    await expect(
      env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), bill.body.id, member.id, 100, null)
        .run(),
    ).rejects.toThrow()
  })

  it('cascades deletes from a home to its members, bills, and shares', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)

    await env.DB.prepare('DELETE FROM homes WHERE id = ?').bind(homeId).run()

    const members = await env.DB.prepare('SELECT COUNT(*) AS count FROM members WHERE home_id = ?')
      .bind(homeId)
      .first<{ count: number }>()
    const bills = await env.DB.prepare('SELECT COUNT(*) AS count FROM bills WHERE home_id = ?')
      .bind(homeId)
      .first<{ count: number }>()
    const shares = await env.DB.prepare('SELECT COUNT(*) AS count FROM shares WHERE bill_id = ?')
      .bind(bill.body.id)
      .first<{ count: number }>()

    expect(members?.count).toBe(0)
    expect(bills?.count).toBe(0)
    expect(shares?.count).toBe(0)
  })
})
