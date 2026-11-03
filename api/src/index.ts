import { Hono } from 'hono'
import { validator } from 'hono/validator'

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
    await c.env.DB.prepare(
      'INSERT INTO homes (id, name) VALUES (?, ?)'
    ).bind(id, name).run()
    return c.json({ id, name }, 201)
  }
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
    const home = await c.env.DB.prepare(
      'SELECT 1 FROM homes WHERE id = ?'
    ).bind(homeId).first()
    if (!home) return c.json({ error: 'Home not found' }, 404)

    const id = crypto.randomUUID()
    await c.env.DB.prepare(
      'INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)'
    ).bind(id, homeId, name).run()

    return c.json({ id, homeId, name }, 201)
  }
)

export default app
