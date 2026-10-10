'use client'

/**
 * Formatting and small shared pieces for the school portal.
 *
 * Kept together so the same number never renders two ways on two screens — the
 * failure mode is subtle and expensive: a fee statement showing `K 1,250` beside
 * a dashboard showing `K1250.00` reads as two different figures to a parent.
 */

import type { JSX } from 'react'

import { Badge } from '../../../components/ui/badge'

/**
 * Money, in Zambian kwacha.
 *
 * Two decimal places always. A balance is not a headline figure to be rounded —
 * `K 1,250` where the truth is `K 1,249.50` is a fifty-ngwee dispute at a fee
 * counter, and the person on the other side of it has the receipt.
 */
export function formatKwacha(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  if (!Number.isFinite(n)) return 'K 0.00'
  return `K ${n.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** A count. Locale-grouped, never padded. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-ZM')
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-ZM', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * A grade or class identifier as a person reads it.
 *
 * Stored as `grade_7a`, shown as "Grade 7A". Presentational only — the stored
 * value stays the identifier everywhere it is compared or sent.
 */
export function formatLevel(id: string | null | undefined): string {
  if (!id) return '—'
  return id
    .split('_')
    .map((part) => (/^\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

const STUDENT_STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  active: { label: 'Active', variant: 'success' },
  on_leave: { label: 'On leave', variant: 'warning' },
  transferred: { label: 'Transferred', variant: 'neutral' },
  graduated: { label: 'Graduated', variant: 'neutral' },
  withdrawn: { label: 'Withdrawn', variant: 'danger' },
}

export function StudentStatusBadge({ status }: { status: string }): JSX.Element {
  const s = STUDENT_STATUS[status] ?? { label: status, variant: 'neutral' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** The five statuses, for filters and the status select. Order is lifecycle order. */
export const STUDENT_STATUSES = [
  'active',
  'on_leave',
  'transferred',
  'graduated',
  'withdrawn',
] as const

export const STUDENT_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STUDENT_STATUS).map(([k, v]) => [k, v.label]),
)

/**
 * Statuses that occupy a place against the student ceiling.
 *
 * Mirrors `school_student_capacity()` in migration 0101. Stated here so a screen
 * explaining *why* a pupil counts does not invent its own rule.
 */
export const STATUSES_ON_ROLL = ['active', 'on_leave'] as const
