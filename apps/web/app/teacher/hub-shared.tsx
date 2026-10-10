'use client'

/**
 * Shared pieces for the Teacher Hub screens.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## The entitlement banner is the most important component here
 *
 * A teacher on an exhausted trial, or a lapsed subscription, must be told which of those
 * it is and what it means for the work they have already saved. "Your subscription has
 * ended" on its own reads as "your lesson plans are gone" — which is not true and is the
 * single most alarming thing this product could imply. Every message the API sends says
 * what still works.
 */

import type { JSX, ReactNode } from 'react'

import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'

export interface HubEntitlement {
  may_generate: boolean
  reason: string | null
  plan_code: string | null
  subscription_status: string | null
  allowance: number | null
  used: number | null
  remaining: number | null
  subscription_ends_at: string | null
}

export interface HubPlan {
  plan_code: string
  display_name: string
  billing_period: string
  price: number | string
  currency_code: string
  included_resources: number | null
}

export interface HubAccount {
  clerk_user_id: string
  full_name: string
  email: string
  phone_e164: string | null
  country_code: string
  curriculum_types: string[]
  subjects: string[]
  grade_levels: string[]
  plan_code: string
  subscription_status: string
  trial_resources_used: number
  resources_created: number
  subscription_ends_at: string | null
}

export interface HubPayload {
  account: HubAccount | null
  entitlement: HubEntitlement | null
  plans: HubPlan[]
  needsRegistration: boolean
  entitlementMessage: string | null
  modelBacked: boolean
}

export interface ResourceRow {
  id: string
  resource_kind: 'lesson_plan' | 'quiz' | 'homework'
  title: string
  subject: string
  grade_level: string
  topic: string
  curriculum_type: string
  duration_minutes: number | null
  lesson_type: string | null
  is_shared: boolean
  generator_name: string
  generator_version: string
  school_id: string | null
  created_at: string
  updated_at: string
}

export const KIND_LABELS: Record<string, string> = {
  lesson_plan: 'Lesson plan',
  quiz: 'Quiz',
  homework: 'Homework',
}

export const CURRICULUM_LABELS: Record<string, string> = {
  ecz: 'ECZ',
  cambridge_igcse: 'Cambridge IGCSE',
  cambridge_alevel: 'Cambridge A-Level',
  custom: 'School-defined',
}

export const shortDate = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'

/** Prices come back from PostgREST as strings, being NUMERIC. */
export const money = (value: number | string, currency: string): string => {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  const symbol = currency === 'ZMW' ? 'K' : `${currency} `
  return `${symbol}${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/** Thin wrapper so every screen handles the `{ data }` / `{ error }` envelope identically. */
export async function hubFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    })
    const body = (await response.json()) as { data?: T; error?: string }
    if (!response.ok) return { data: null, error: body.error ?? `Request failed (${response.status}).` }
    return { data: body.data ?? null, error: null }
  } catch {
    return { data: null, error: 'Could not reach the server. Check your connection.' }
  }
}

export function PlanBadge({ entitlement }: { entitlement: HubEntitlement | null }): JSX.Element | null {
  if (!entitlement) return null

  const { subscription_status: status, remaining, allowance } = entitlement

  if (status === 'trial') {
    // The count, not just the word. "Trial" tells a teacher nothing about whether they can
    // press the button; "3 of 5 left" tells them exactly.
    const left = remaining ?? allowance ?? 0
    return (
      <Badge variant={left > 1 ? 'info' : left === 1 ? 'warning' : 'danger'}>
        Free trial · {left} of {allowance ?? 0} left
      </Badge>
    )
  }
  if (status === 'active') return <Badge variant="success">Subscribed</Badge>
  if (status === 'cancelled') return <Badge variant="warning">Cancelled</Badge>
  if (status === 'suspended') return <Badge variant="danger">Suspended</Badge>
  return null
}

/**
 * Says what is blocked and what is not. `message` comes from the API so the wording is
 * identical everywhere it appears.
 */
export function EntitlementNotice({
  entitlement,
  message,
  action,
}: {
  entitlement: HubEntitlement | null
  message: string | null
  action?: ReactNode
}): JSX.Element | null {
  if (!entitlement || entitlement.may_generate || !message) return null

  return (
    <Alert
      variant={entitlement.reason === 'account_suspended' ? 'danger' : 'warning'}
      title={
        entitlement.reason === 'trial_exhausted'
          ? 'Free trial used up'
          : entitlement.reason === 'no_account'
            ? 'Finish setting up'
            : 'Creating new resources is paused'
      }
    >
      <p>{message}</p>
      {action}
    </Alert>
  )
}

/**
 * The honesty label.
 *
 * There is no model behind the generator yet — no `ANTHROPIC_API_KEY`, and no curriculum
 * knowledge base has ever been ingested. A teacher who has been sold AI lesson planning and
 * silently handed a template has been misled, so this says what they are getting. It
 * disappears on its own once `isModelBacked()` is true; nothing needs editing.
 */
export function GeneratorNotice({ modelBacked }: { modelBacked: boolean }): JSX.Element | null {
  if (modelBacked) return null

  return (
    <Alert variant="info" title="Structured plans, not AI-written ones — yet">
      <p>
        Right now the Hub builds a complete, correctly timed lesson structure for you to fill
        in — objectives, phases that add up to your lesson length, assessment and homework
        prompts. It is the paper planning sheet, already laid out.
      </p>
      <p className="mt-2">
        The Zambian-curriculum AI writing is not switched on yet. When it is, everything you
        have saved stays exactly where it is, and you will be able to tell which is which.
      </p>
    </Alert>
  )
}
