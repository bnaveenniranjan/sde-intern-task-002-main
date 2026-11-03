import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { splitBill } from './bill-splitter'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Helper to validate non-empty strings
const validateName = (name: unknown): string | null => {
  if (typeof name !== 'string' || !name.trim()) return null
  return name.trim()
}

// POST /api/homes
app.post(
  '/api/homes',
  validator('json', (value, c) => {
    const name = validateName(value?.name)
    if (!name) return c.json({ error: 'Name is required' }, 400)
    return { name }
  }),
  async (c) => {
    const { name } = c.req.valid('json')
    const id = crypto.randomUUID()
    await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
    return c.json({ id, name }, 201)
  },
)

// POST /api/homes/:homeId/members
app.post(
  '/api/homes/:homeId/members',
  validator('json', (value, c) => {
    const name = validateName(value?.name)
    if (!name) return c.json({ error: 'Name is required' }, 400)
    return { name }
  }),
  async (c) => {
    const { homeId } = c.req.param()
    const { name } = c.req.valid('json')

    // Check home exists
    const home = await c.env.DB.prepare('SELECT 1 FROM homes WHERE id = ?').bind(homeId).first()
    if (!home) return c.json({ error: 'Home not found' }, 404)

    // Get next position for this home
    const lastMember = await c.env.DB.prepare(
      'SELECT position FROM members WHERE home_id = ? ORDER BY position DESC LIMIT 1',
    )
      .bind(homeId)
      .first()
    const position = lastMember ? (lastMember as { position: number }).position + 1 : 0

    const id = crypto.randomUUID()
    await c.env.DB.prepare('INSERT INTO members (id, home_id, name, position) VALUES (?, ?, ?, ?)')
      .bind(id, homeId, name, position)
      .run()

    return c.json({ id, homeId, name }, 201)
  },
)

// Helper to validate positive safe integer amount
const validateAmount = (amount: unknown): number | null => {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return null
  return amount
}

// POST /api/homes/:homeId/bills
app.post('/api/homes/:homeId/bills', async (c) => {
  const { homeId } = c.req.param()

  // Check home exists first
  const home = await c.env.DB.prepare('SELECT 1 FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'Home not found' }, 404)

  // Parse and validate body
  const body = await c.req.json().catch(() => null)
  const title = validateName(body?.title)
  if (!title) return c.json({ error: 'Title is required' }, 400)

  const totalCents = validateAmount(body?.totalCents)
  if (!totalCents) return c.json({ error: 'Amount must be a positive integer' }, 422)

  // Get members in explicit creation order
  const members = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY position ASC',
  )
    .bind(homeId)
    .all()
  if (!members.results || members.results.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const memberList = members.results as { id: string; name: string }[]

  // Use the shared splitting logic, then give every share its own ID.
  const billId = crypto.randomUUID()
  const shares = splitBill(totalCents, memberList).map((share) => ({
    ...share,
    id: crypto.randomUUID(),
  }))

  // Insert the bill and every share in one atomic D1 batch. If any share
  // insert fails, D1 rolls the whole batch back, including the bill.
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents, null),
    ),
  ]
  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares: shares.map((share) => ({
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: null,
      })),
    },
    201,
  )
})

// POST /api/bills/:billId/shares/:shareId/pay
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const { billId, shareId } = c.req.param()
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim()

  if (!idempotencyKey) return c.json({ error: 'Idempotency-Key header required' }, 400)

  try {
    // Verify the bill exists independently of the share lookup.
    const bill = await c.env.DB.prepare('SELECT 1 FROM bills WHERE id = ?').bind(billId).first()
    if (!bill) return c.json({ error: 'Bill not found' }, 404)

    // This is the critical section. The WHERE clause makes the payment a
    // compare-and-set: only an unpaid share belonging to this bill can be
    // claimed, and the successful row is returned in the same statement.
    const paidAt = new Date().toISOString()
    const paidShare = await c.env.DB.prepare(`
        UPDATE shares
        SET paid_at = ?, idempotency_key = ?
        WHERE id = ? AND bill_id = ? AND paid_at IS NULL
        RETURNING id, member_id, amount_cents, paid_at
      `)
      .bind(paidAt, idempotencyKey, shareId, billId)
      .first<{ id: string; member_id: string; amount_cents: number; paid_at: string }>()

    if (paidShare) {
      return c.json(
        {
          id: paidShare.id,
          memberId: paidShare.member_id,
          amountCents: paidShare.amount_cents,
          paidAt: paidShare.paid_at,
        },
        200,
      )
    }

    // The conditional update can only miss because the share is already paid,
    // does not exist, or belongs to another bill. Read it to distinguish a
    // successful replay from a conflict or a missing share.
    const existingShare = await c.env.DB.prepare(`
        SELECT id, member_id, amount_cents, paid_at, idempotency_key
        FROM shares
        WHERE id = ? AND bill_id = ?
      `)
      .bind(shareId, billId)
      .first<{
        id: string
        member_id: string
        amount_cents: number
        paid_at: string | null
        idempotency_key: string | null
      }>()

    if (!existingShare) return c.json({ error: 'Share not found' }, 404)

    if (existingShare.paid_at) {
      // Replaying the same successful request returns the original result.
      if (existingShare.idempotency_key === idempotencyKey) {
        return c.json(
          {
            id: existingShare.id,
            memberId: existingShare.member_id,
            amountCents: existingShare.amount_cents,
            paidAt: existingShare.paid_at,
          },
          200,
        )
      }

      return c.json({ error: 'Share already paid' }, 409)
    }

    // The share was unpaid when the update ran but is not claimable now, which
    // means its state changed concurrently. Never fall back to an
    // unconditional update.
    return c.json({ error: 'Share state changed, retry payment' }, 409)
  } catch (error) {
    console.error('Failed to pay share', error)
    return c.json({ error: 'Unable to process payment' }, 500)
  }
})

// GET /api/homes/:homeId
app.get('/api/homes/:homeId', async (c) => {
  const { homeId } = c.req.param()

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string; name: string }>()
  if (!home) return c.json({ error: 'Home not found' }, 404)

  const members = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY position ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string }>()

  const rows = await c.env.DB.prepare(`
      SELECT
        b.id AS billId,
        b.title AS title,
        b.total_cents AS totalCents,
        s.id AS shareId,
        s.member_id AS memberId,
        m.name AS memberName,
        s.amount_cents AS amountCents,
        s.paid_at AS paidAt
      FROM bills b
      LEFT JOIN shares s ON s.bill_id = b.id
      LEFT JOIN members m ON m.id = s.member_id
      WHERE b.home_id = ?
      ORDER BY b.created_at ASC, b.rowid ASC, m.position ASC
    `)
    .bind(homeId)
    .all<{
      billId: string
      title: string
      totalCents: number
      shareId: string | null
      memberId: string | null
      memberName: string | null
      amountCents: number | null
      paidAt: string | null
    }>()

  const bills = new Map<
    string,
    {
      id: string
      title: string
      totalCents: number
      shares: Array<{
        id: string
        memberId: string
        memberName: string
        amountCents: number
        paidAt: string | null
      }>
    }
  >()

  for (const row of rows.results) {
    let bill = bills.get(row.billId)
    if (!bill) {
      bill = {
        id: row.billId,
        title: row.title,
        totalCents: row.totalCents,
        shares: [],
      }
      bills.set(row.billId, bill)
    }

    if (
      row.shareId !== null &&
      row.memberId !== null &&
      row.memberName !== null &&
      row.amountCents !== null
    ) {
      bill.shares.push({
        id: row.shareId,
        memberId: row.memberId,
        memberName: row.memberName,
        amountCents: row.amountCents,
        paidAt: row.paidAt,
      })
    }
  }

  return c.json({
    id: home.id,
    name: home.name,
    members: members.results,
    bills: [...bills.values()],
  })
})

// GET /api/homes/:homeId/balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const { homeId } = c.req.param()

  // Check home exists
  const home = await c.env.DB.prepare('SELECT 1 FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'Home not found' }, 404)

  // One aggregation query keeps every member (including those with no shares)
  // and only counts unpaid shares belonging to bills in this home.
  const balances = await c.env.DB.prepare(`
      SELECT
        m.id AS memberId,
        m.name AS name,
        COALESCE(
          SUM(
            CASE
              WHEN s.paid_at IS NULL AND b.id IS NOT NULL THEN s.amount_cents
              ELSE 0
            END
          ),
          0
        ) AS outstandingCents
      FROM members m
      LEFT JOIN shares s ON s.member_id = m.id
      LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = m.home_id
      WHERE m.home_id = ?
      GROUP BY m.id, m.name, m.position
      ORDER BY m.position ASC
    `)
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: balances.results }, 200)
})

export default app
