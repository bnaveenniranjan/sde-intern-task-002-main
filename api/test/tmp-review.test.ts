import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createHome, type Member } from './helpers'

describe('review probes', () => {
  it('concurrent member creation yields unique positions', async () => {
    const { homeId } = await createHome([])
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

    const results = await Promise.all(
      names.map((name) =>
        call<Member>('POST', `/api/homes/${homeId}/members`, { body: { name } }),
      ),
    )

    expect(results.map((result) => result.status)).toEqual(names.map(() => 201))

    const rows = await env.DB.prepare(
      'SELECT position FROM members WHERE home_id = ? ORDER BY position ASC',
    )
      .bind(homeId)
      .all<{ position: number }>()
    expect(rows.results.map((row) => row.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('probe: direct non-integer amount insert', async () => {
    const { homeId } = await createHome(['A'])

    await env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), homeId, 'Probe', 10.5)
      .run()

    const stored = await env.DB.prepare(
      'SELECT total_cents AS value, typeof(total_cents) AS type FROM bills WHERE home_id = ?',
    )
      .bind(homeId)
      .first<{ value: number; type: string }>()

    expect(stored).toEqual({ value: 10.5, type: 'real' })
  })
})
