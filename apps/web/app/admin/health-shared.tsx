'use client'

/**
 * Shared vocabulary for the health screens.
 *
 * The band-to-colour mapping lives here so the overview and the health page
 * cannot disagree about what "at risk" looks like — a school shown amber on one
 * screen and red on the next is a school nobody trusts the score for.
 */

import type { JSX } from 'react'

import { Badge } from '../../components/ui/badge'

export type HealthBand = 'excellent' | 'good' | 'at_risk' | 'critical'

export interface HealthRow {
  school_id: string
  school_code: string
  school_name: string
  status: string
  subscription_tier: string
  students: number
  operational_score: number
  financial_score: number
  engagement_score: number
  composite_score: number
  band: HealthBand
  inputs_available: number
  inputs_total: number
}

/**
 * Bands per SCHOOL_HEALTH_SCORES.md: 80+, 65+, 45+, below.
 *
 * The label is written out rather than implied by hue. Around 1 in 12 men
 * cannot reliably separate the amber and the coral, and this is the column an
 * operator sorts their day by.
 */
const BAND: Record<HealthBand, { label: string; variant: 'success' | 'primary' | 'warning' | 'danger' }> = {
  excellent: { label: 'Excellent', variant: 'success' },
  good: { label: 'Good', variant: 'primary' },
  at_risk: { label: 'At risk', variant: 'warning' },
  critical: { label: 'Critical', variant: 'danger' },
}

export function HealthBadge({ band }: { band: HealthBand }): JSX.Element {
  const b = BAND[band] ?? BAND.critical
  return <Badge variant={b.variant}>{b.label}</Badge>
}

/** School status, using the same semantic vocabulary as everything else. */
export function StatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, { label: string; variant: 'success' | 'primary' | 'warning' | 'danger' | 'neutral' }> = {
    active: { label: 'Active', variant: 'success' },
    trial: { label: 'Trial', variant: 'primary' },
    pending_verification: { label: 'Pending', variant: 'warning' },
    suspended: { label: 'Suspended', variant: 'danger' },
    terminated: { label: 'Terminated', variant: 'neutral' },
  }
  const s = map[status] ?? { label: status, variant: 'neutral' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/**
 * Kwacha, from the NUMERIC string PostgREST returns.
 *
 * Parsed rather than passed through: `sum()` over NUMERIC arrives as a string
 * like "588000.00", and rendering that raw puts an unseparated six-figure
 * number in front of someone reconciling accounts.
 */
export function formatKwacha(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  if (!Number.isFinite(n)) return 'K 0'

  return `K ${n.toLocaleString('en-ZM', { maximumFractionDigits: 0 })}`
}

export const TIER_LABEL: Record<string, string> = {
  starter: 'Starter',
  growth: 'Growth',
  professional: 'Professional',
  enterprise: 'Enterprise',
}
