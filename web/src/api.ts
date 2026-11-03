export type Member = {
  id: string
  name: string
}

export type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

export type Bill = {
  id: string
  title: string
  totalCents: number
  shares: Share[]
}

export type Home = {
  id: string
  name: string
  members: Member[]
  bills: Bill[]
}

export type PaidShare = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseMember(value: unknown): Member | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null
  return { id: value.id, name: value.name }
}

type ParsedShare = Omit<Share, 'memberName'> & { memberName: string | null }

function parseShare(value: unknown): ParsedShare | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.memberId !== 'string' ||
    !isCents(value.amountCents)
  ) {
    return null
  }
  if (value.paidAt !== null && typeof value.paidAt !== 'string') return null

  return {
    id: value.id,
    memberId: value.memberId,
    memberName: typeof value.memberName === 'string' ? value.memberName : null,
    amountCents: value.amountCents,
    paidAt: value.paidAt,
  }
}

function parseBill(value: unknown, memberNames: Map<string, string>): Bill | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    !isCents(value.totalCents) ||
    !Array.isArray(value.shares)
  ) {
    return null
  }

  const shares: Share[] = []
  for (const rawShare of value.shares) {
    const share = parseShare(rawShare)
    if (!share) continue

    shares.push({
      id: share.id,
      memberId: share.memberId,
      memberName: share.memberName ?? memberNames.get(share.memberId) ?? 'Unknown member',
      amountCents: share.amountCents,
      paidAt: share.paidAt,
    })
  }

  return {
    id: value.id,
    title: value.title,
    totalCents: value.totalCents,
    shares,
  }
}

function parseHome(value: unknown): Home | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.members) ||
    !Array.isArray(value.bills)
  ) {
    return null
  }

  const members: Member[] = []
  for (const rawMember of value.members) {
    const member = parseMember(rawMember)
    if (member) members.push(member)
  }

  const memberNames = new Map(members.map((member) => [member.id, member.name]))
  const bills: Bill[] = []
  for (const rawBill of value.bills) {
    const bill = parseBill(rawBill, memberNames)
    if (bill) bills.push(bill)
  }

  return {
    id: value.id,
    name: value.name,
    members,
    bills,
  }
}

function parsePaidShare(value: unknown): PaidShare | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.memberId !== 'string' ||
    !isCents(value.amountCents) ||
    typeof value.paidAt !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    memberId: value.memberId,
    amountCents: value.amountCents,
    paidAt: value.paidAt,
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function errorMessage(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.error === 'string' && body.error.trim()) {
    return body.error
  }
  return `Request failed with status ${status}.`
}

export async function fetchHome(homeId: string, signal?: AbortSignal): Promise<Home> {
  const response = await fetch(`/api/homes/${encodeURIComponent(homeId)}`, {
    headers: { accept: 'application/json' },
    signal,
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new ApiError(errorMessage(body, response.status), response.status)
  }

  const home = parseHome(body)
  if (!home) {
    throw new ApiError('The server returned an unexpected home response.', 0)
  }

  return home
}

export async function payShare(
  billId: string,
  shareId: string,
  idempotencyKey: string,
): Promise<PaidShare> {
  const response = await fetch(
    `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
    },
  )
  const body = await readJson(response)

  if (!response.ok) {
    throw new ApiError(errorMessage(body, response.status), response.status)
  }

  const paidShare = parsePaidShare(body)
  if (!paidShare) {
    throw new ApiError('The server returned an unexpected payment response.', 0)
  }

  return paidShare
}
