import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createHome, type Member } from './helpers'

// High enough to expose a read-then-write race in position assignment, which
// used to collide on idx_members_home_position under load.
const CONCURRENCY = 50

describe('member position allocation under concurrency', () => {
  it(`gives ${CONCURRENCY} simultaneous members unique, contiguous positions`, async () => {
    const { homeId } = await createHome([])
    const names = Array.from({ length: CONCURRENCY }, (_, index) => `Member ${index}`)

    const results = await Promise.all(
      names.map((name) => call<Member>('POST', `/api/homes/${homeId}/members`, { body: { name } })),
    )

    expect(results.map((result) => result.status)).toEqual(names.map(() => 201))

    const rows = await env.DB.prepare(
      'SELECT position FROM members WHERE home_id = ? ORDER BY position ASC',
    )
      .bind(homeId)
      .all<{ position: number }>()

    // Every request got its own slot: no duplicates, no gaps, stable order.
    expect(rows.results.map((row) => row.position)).toEqual(
      Array.from({ length: CONCURRENCY }, (_, index) => index),
    )
    expect(rows.results).toHaveLength(CONCURRENCY)
  })

  it('keeps concurrent creations in separate homes independent', async () => {
    const [first, second] = await Promise.all([createHome([]), createHome([])])

    const results = await Promise.all(
      ['Asha', 'Ben', 'Chitra'].flatMap((name) => [
        call('POST', `/api/homes/${first.homeId}/members`, { body: { name } }),
        call('POST', `/api/homes/${second.homeId}/members`, { body: { name } }),
      ]),
    )

    expect(results.map((result) => result.status)).toEqual(results.map(() => 201))

    const positions = await env.DB.prepare(
      'SELECT home_id AS homeId, position FROM members ORDER BY home_id ASC, position ASC',
    ).all<{ homeId: string; position: number }>()

    for (const homeId of [first.homeId, second.homeId]) {
      const own = positions.results.filter((row) => row.homeId === homeId)
      expect(own.map((row) => row.position)).toEqual([0, 1, 2])
    }
  })
})
