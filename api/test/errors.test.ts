import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { call, createBill, createHome } from './helpers'

async function callRaw(path: string, body: string) {
  const response = await exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  )
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed }
}

describe('error response consistency', () => {
  it('returns JSON for an unknown route', async () => {
    const response = await call('GET', '/api/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'Not found' })
  })

  it('returns JSON for an unexpected database failure', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    await env.DB.prepare(
      "CREATE TRIGGER fail_bill_insert BEFORE INSERT ON bills BEGIN SELECT RAISE(ABORT, 'boom'); END",
    ).run()

    try {
      const response = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Electricity', totalCents: 1000 },
      })

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ error: 'Internal server error' })
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS fail_bill_insert').run()
    }
  })

  it('returns JSON for a missing home on both read routes', async () => {
    const homeResponse = await call('GET', '/api/homes/does-not-exist')
    const balancesResponse = await call('GET', '/api/homes/does-not-exist/balances')

    expect(homeResponse.status).toBe(404)
    expect(homeResponse.body).toEqual({ error: 'Home not found' })
    expect(balancesResponse.status).toBe(404)
    expect(balancesResponse.body).toEqual({ error: 'Home not found' })
  })

  it('returns JSON for a missing share after a valid bill exists', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 100)

    const response = await call('POST', `/api/bills/${bill.body.id}/shares/nope/pay`, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'Share not found' })
  })

  it('rejects invalid names with JSON errors before touching the database', async () => {
    for (const name of [undefined, '', '   ', 42, null]) {
      const home = await call('POST', '/api/homes', { body: { name } })
      const member = await call('POST', '/api/homes/any-home/members', { body: { name } })

      expect(home.status).toBe(400)
      expect(home.body).toHaveProperty('error')
      expect(member.status).toBe(400)
      expect(member.body).toHaveProperty('error')
    }
  })

  it('preserves the status of malformed JSON requests as a JSON error', async () => {
    const home = await callRaw('/api/homes', '{bad json')
    const member = await callRaw('/api/homes/anything/members', '{bad json')

    expect(home.status).toBe(400)
    expect(member.status).toBe(400)
    expect(home.body).toHaveProperty('error')
    expect(member.body).toHaveProperty('error')
  })
})
