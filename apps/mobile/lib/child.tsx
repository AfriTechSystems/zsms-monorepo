/**
 * Which child a parent is looking at.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * ## Why this is shared state and not a prop
 *
 * Every parent screen answers the same question about a different subject — Alice's
 * attendance, Alice's fees, Alice's results. Passing the choice down would mean each
 * tab holding its own copy, and a parent who switched to Ben on the fees tab would
 * find Alice still selected on results. That is the kind of thing somebody acts on.
 *
 * ## Many children, often at different schools
 *
 * A Zambian family with children at two schools is ordinary, and a parent's access is
 * scoped by the link row rather than by any organisation, so both appear in one list.
 * The school name is shown only when the family actually spans schools — telling a
 * single-school parent which school their child attends is noise.
 */

import type { JSX, ReactNode } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'

export interface Child {
  id: string
  studentId: string
  firstName: string
  lastName: string
  schoolId: string
  schoolName: string | null
  /** Set by the SCHOOL. A parent sees it and cannot change it (`0265`). */
  photoUrl?: string | null
}

interface ChildContext {
  childId: string | null
  setChildId: (id: string) => void
}

const Ctx = createContext<ChildContext>({ childId: null, setChildId: () => {} })

export function ChildProvider({ children }: { children: ReactNode }): JSX.Element {
  const [childId, setChildId] = useState<string | null>(null)
  const value = useMemo(() => ({ childId, setChildId }), [childId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChild(): ChildContext {
  return useContext(Ctx)
}

/**
 * The query string for a parent endpoint.
 *
 * Empty until a child is chosen, which lets the server pick — it returns the first
 * child and says which, so the first load works before this context knows anything.
 */
export function childQuery(childId: string | null): string {
  return childId ? `?childId=${encodeURIComponent(childId)}` : ''
}
