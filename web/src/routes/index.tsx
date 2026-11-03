import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError, fetchHome, type Home, type PaidShare, payShare, type Share } from '../api'

type HomeSearch = {
  homeId?: string
}

function validateHomeSearch(search: Record<string, unknown>): HomeSearch {
  const value = search.homeId
  return {
    homeId: typeof value === 'string' && value.trim() ? value.trim() : undefined,
  }
}

export const Route = createFileRoute('/')({
  validateSearch: validateHomeSearch,
  component: HomePage,
})

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; refreshing: boolean }
  | { status: 'success'; home: Home }
  | { status: 'error'; message: string }

type PaymentNotice = {
  kind: 'success' | 'error'
  text: string
}

type PaymentState = {
  pending: boolean
  notice: PaymentNotice | null
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function formatCents(cents: number): string {
  return currency.format(cents / 100)
}

function formatPaidAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0] ?? '?'
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : ''
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '?'
}

function describeLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return 'That home could not be found. Check the home ID and try again.'
    }
    if (error.status === 0) return error.message
    if (error.status >= 500) {
      return 'The server could not load this home. Please try again.'
    }
    return error.message
  }
  return 'Could not load this home. Check your connection and try again.'
}

function describePaymentError(error: unknown): {
  notice: PaymentNotice
  uncertain: boolean
} {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return {
          notice: {
            kind: 'error',
            text: 'The payment request was rejected because the idempotency key was invalid.',
          },
          uncertain: false,
        }
      case 404:
        return {
          notice: {
            kind: 'error',
            text: 'This bill or share no longer exists. Refresh the home to see its latest state.',
          },
          uncertain: false,
        }
      case 409:
        return {
          notice: {
            kind: 'error',
            text: 'This share was already paid by a different payment attempt. Refresh the home to see its latest state.',
          },
          uncertain: false,
        }
      case 422:
        return {
          notice: {
            kind: 'error',
            text: 'The server rejected this payment as invalid. Refresh the home and try again.',
          },
          uncertain: false,
        }
      case 0:
        return {
          notice: {
            kind: 'error',
            text: 'The payment response could not be verified. Retry with the same key to check the result safely.',
          },
          uncertain: true,
        }
      case 500:
        return {
          notice: {
            kind: 'error',
            text: 'The server could not confirm this payment. It may still have succeeded, so retry safely with the same key.',
          },
          uncertain: true,
        }
      default:
        return {
          notice: { kind: 'error', text: error.message },
          uncertain: error.status >= 500,
        }
    }
  }

  return {
    notice: {
      kind: 'error',
      text: 'The payment could not be confirmed because of a network problem. Retry safely with the same key.',
    },
    uncertain: true,
  }
}

function applyConfirmedPayments(
  home: Home,
  payments: Map<string, { billId: string; paid: PaidShare }>,
): Home {
  if (payments.size === 0) return home

  return {
    ...home,
    bills: home.bills.map((bill) => ({
      ...bill,
      shares: bill.shares.map((share) => {
        const confirmed = payments.get(share.id)
        if (!confirmed || confirmed.billId !== bill.id) return share

        return {
          ...share,
          memberId: confirmed.paid.memberId,
          amountCents: confirmed.paid.amountCents,
          paidAt: confirmed.paid.paidAt,
        }
      }),
    })),
  }
}

function HomePage() {
  const { homeId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [homeInput, setHomeInput] = useState(homeId ?? '')
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' })
  const [paymentStates, setPaymentStates] = useState<Record<string, PaymentState>>({})
  const [reloadToken, setReloadToken] = useState(0)
  const uncertainKeys = useRef(new Map<string, string>())
  const confirmedPayments = useRef(new Map<string, { billId: string; paid: PaidShare }>())
  const inFlight = useRef(new Set<string>())
  const mounted = useRef(true)
  const currentHomeId = useRef(homeId)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    currentHomeId.current = homeId
    setHomeInput(homeId ?? '')
    uncertainKeys.current.clear()
    confirmedPayments.current.clear()
    setPaymentStates({})
  }, [homeId])

  useEffect(() => {
    if (!homeId) {
      setLoadState({ status: 'idle' })
      return
    }

    const controller = new AbortController()
    let active = true
    setLoadState({ status: 'loading', refreshing: reloadToken > 0 })

    fetchHome(homeId, controller.signal)
      .then((home) => {
        if (active) {
          setLoadState({
            status: 'success',
            home: applyConfirmedPayments(home, confirmedPayments.current),
          })
        }
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        setLoadState({ status: 'error', message: describeLoadError(error) })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [homeId, reloadToken])

  function handleLoad(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextHomeId = homeInput.trim()
    if (!nextHomeId) return

    if (nextHomeId === homeId) {
      setReloadToken((value) => value + 1)
      return
    }

    void navigate({ to: '/', search: { homeId: nextHomeId } })
  }

  async function handlePay(billId: string, share: Share) {
    if (inFlight.current.has(share.id)) return

    const pageHomeId = homeId
    const key = uncertainKeys.current.get(share.id) ?? crypto.randomUUID()
    uncertainKeys.current.set(share.id, key)
    inFlight.current.add(share.id)
    setPaymentStates((previous) => ({
      ...previous,
      [share.id]: { pending: true, notice: null },
    }))

    const isCurrent = () =>
      mounted.current && pageHomeId !== undefined && currentHomeId.current === pageHomeId

    try {
      const paid = await payShare(billId, share.id, key)
      if (!isCurrent()) return

      uncertainKeys.current.delete(share.id)
      confirmedPayments.current.set(share.id, { billId, paid })
      setLoadState((previous) => {
        if (previous.status !== 'success') return previous

        return {
          status: 'success',
          home: {
            ...previous.home,
            bills: previous.home.bills.map((bill) =>
              bill.id !== billId
                ? bill
                : {
                    ...bill,
                    shares: bill.shares.map((item) =>
                      item.id === share.id
                        ? {
                            ...item,
                            memberId: paid.memberId,
                            amountCents: paid.amountCents,
                            paidAt: paid.paidAt,
                          }
                        : item,
                    ),
                  },
            ),
          },
        }
      })
      setPaymentStates((previous) => ({
        ...previous,
        [share.id]: {
          pending: false,
          notice: { kind: 'success', text: 'Payment recorded.' },
        },
      }))
    } catch (error: unknown) {
      if (!isCurrent()) return

      const result = describePaymentError(error)
      if (!result.uncertain) {
        uncertainKeys.current.delete(share.id)
      }
      setPaymentStates((previous) => ({
        ...previous,
        [share.id]: { pending: false, notice: result.notice },
      }))
    } finally {
      inFlight.current.delete(share.id)
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Shared Bill Splitter</p>
          <h1>Bills and shares</h1>
          <p className="subtitle">
            Load a home by ID to see its bills, shares, and payment status.
          </p>
        </div>

        <form className="home-form" onSubmit={handleLoad}>
          <label htmlFor="home-id">Home ID</label>
          <div className="home-form-row">
            <input
              id="home-id"
              value={homeInput}
              onChange={(event) => setHomeInput(event.target.value)}
              placeholder="Paste a home ID"
              autoComplete="off"
            />
            <button type="submit">Load home</button>
          </div>
        </form>
      </header>

      {loadState.status === 'idle' && (
        <section className="panel state-panel">
          <h2>No home selected</h2>
          <p>Enter the ID of a home above to view its bills and shares.</p>
        </section>
      )}

      {loadState.status === 'loading' && (
        <section className="panel state-panel" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <div>
            <h2>{loadState.refreshing ? 'Refreshing home' : 'Loading home'}</h2>
            <p>
              Fetching the latest bills and shares from the API. Slow connections may take a moment.
            </p>
          </div>
        </section>
      )}

      {loadState.status === 'error' && (
        <section className="panel state-panel error-panel" role="alert">
          <div>
            <h2>Could not load home</h2>
            <p>{loadState.message}</p>
          </div>
          <button type="button" onClick={() => setReloadToken((value) => value + 1)}>
            Try again
          </button>
        </section>
      )}

      {loadState.status === 'success' && (
        <>
          <section className="panel home-summary">
            <div>
              <p className="eyebrow">Home</p>
              <h2>{loadState.home.name}</h2>
              <code>{loadState.home.id}</code>
            </div>
            <div className="home-summary-side">
              <p>
                {loadState.home.members.length}{' '}
                {loadState.home.members.length === 1 ? 'member' : 'members'}
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                Refresh
              </button>
            </div>
            {loadState.home.members.length > 0 ? (
              <ul className="member-list" aria-label="Members">
                {loadState.home.members.map((member) => (
                  <li key={member.id}>
                    <span className="avatar" aria-hidden="true">
                      {initials(member.name)}
                    </span>
                    {member.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">This home has no members yet.</p>
            )}
          </section>

          <section className="bills-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Bills</p>
                <h2>Shared expenses</h2>
              </div>
              <span className="count-badge">
                {loadState.home.bills.length} {loadState.home.bills.length === 1 ? 'bill' : 'bills'}
              </span>
            </div>

            {loadState.home.bills.length === 0 ? (
              <div className="panel state-panel">
                <h3>No bills yet</h3>
                <p>When a bill is added to this home, its shares will appear here.</p>
              </div>
            ) : (
              <div className="bill-list">
                {loadState.home.bills.map((bill) => {
                  const paidCents = bill.shares.reduce(
                    (total, share) => total + (share.paidAt ? share.amountCents : 0),
                    0,
                  )
                  const paidCount = bill.shares.filter((share) => share.paidAt).length

                  return (
                    <article className="panel bill-card" key={bill.id}>
                      <header className="bill-header">
                        <div>
                          <h3>{bill.title}</h3>
                          <p className="muted">
                            {paidCount} of {bill.shares.length} shares paid
                          </p>
                        </div>
                        <div className="bill-total">
                          <span>Total</span>
                          <strong>{formatCents(bill.totalCents)}</strong>
                        </div>
                      </header>

                      <div className="progress-track" aria-hidden="true">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${
                              bill.totalCents > 0
                                ? Math.min(100, (paidCents / bill.totalCents) * 100)
                                : 0
                            }%`,
                          }}
                        />
                      </div>

                      {bill.shares.length === 0 ? (
                        <p className="muted">This bill has no shares.</p>
                      ) : (
                        <ul className="share-list">
                          {bill.shares.map((share) => {
                            const payment = paymentStates[share.id]
                            const pending = payment?.pending ?? false

                            return (
                              <li
                                className={`share-row ${share.paidAt ? 'is-paid' : 'is-unpaid'}`}
                                key={share.id}
                              >
                                <div className="share-main">
                                  <span className="avatar" aria-hidden="true">
                                    {initials(share.memberName)}
                                  </span>
                                  <div>
                                    <strong>{share.memberName}</strong>
                                    <p className="share-amount">{formatCents(share.amountCents)}</p>
                                  </div>
                                </div>

                                <div className="share-actions">
                                  <span
                                    className={`status-pill ${
                                      share.paidAt ? 'status-paid' : 'status-unpaid'
                                    }`}
                                  >
                                    {share.paidAt ? `Paid ${formatPaidAt(share.paidAt)}` : 'Unpaid'}
                                  </span>

                                  {!share.paidAt && (
                                    <button
                                      type="button"
                                      disabled={pending}
                                      onClick={() => void handlePay(bill.id, share)}
                                    >
                                      {pending ? 'Paying…' : 'Pay share'}
                                    </button>
                                  )}
                                </div>

                                {payment?.notice && (
                                  <p
                                    className={`payment-notice notice-${payment.notice.kind}`}
                                    role={payment.notice.kind === 'error' ? 'alert' : 'status'}
                                  >
                                    {payment.notice.text}
                                  </p>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
