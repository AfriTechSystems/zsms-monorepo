'use client'

/**
 * The staff half of the account page.
 *
 * Spec: `08 Staff Management/STAFF.md` → *Staff Profile Self-Management*,
 *       *Multi-School Staff*
 *
 * ## Why this is on `/account` and not in a school's settings
 *
 * A phone number belongs to a PERSON, not to an employment. The same account can teach
 * at two schools, and STAFF.md's multi-school case is real in a Zambian town where a
 * maths teacher covers two timetables. Putting the form inside one school's settings
 * would ask them which copy of themselves to edit.
 *
 * So the editable fields sit once at the top, and the per-school rows below are
 * read-only facts about each post.
 *
 * ## Renders nothing for a non-staff account
 *
 * A parent opening this page is not staff anywhere. An empty "Staff profile" heading
 * reads as a broken section, so there is no heading at all.
 */

import type { ChangeEvent, JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Briefcase, Save } from 'lucide-react'

import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/field'
import { useToast } from '../ui/toast'

interface Profile {
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  photoUrl: string | null
  location: string | null
  qualifications: string | null
}

interface Post {
  id: string
  schoolName: string
  schoolCode: string
  staffNumber: string | null
  department: string | null
  employmentType: string | null
  joinDate: string | null
  isActive: boolean
}

export function StaffProfileSection(): JSX.Element | null {
  const { toast } = useToast()
  const [isStaff, setIsStaff] = useState(false)
  const [posts, setPosts] = useState<Post[]>([])
  const [form, setForm] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/staff/me')
      if (!response.ok) return
      const body = await response.json()
      setIsStaff(Boolean(body.data?.isStaff))
      setPosts(body.data?.records ?? [])
      if (body.data?.profile) setForm(body.data.profile)
    } catch {
      // Silent: the rest of the account page is unaffected, and a parent seeing an
      // error about a staff record they do not have would be confusing rather than useful.
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!loaded || !isStaff || !form) return null

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const response = await fetch('/api/staff/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form!.firstName,
          lastName: form!.lastName,
          /*
            `?? ''` deliberately. A field the user emptied must travel as an empty
            string so `0249` clears it — sending null would mean "leave alone" and the
            old value would silently come back.
          */
          phone: form!.phone ?? '',
          email: form!.email ?? '',
          location: form!.location ?? '',
          qualifications: form!.qualifications ?? '',
        }),
      })
      const body = await response.json()
      toast(
        body.data?.message ?? body.error ?? 'Saved.',
        response.ok ? 'success' : 'danger',
      )
    } finally {
      setSaving(false)
    }
  }

  function set(field: keyof Profile) {
    return (e: ChangeEvent<HTMLInputElement>) =>
      setForm((p) => (p ? { ...p, [field]: e.target.value } : p))
  }

  return (
    <Card className="p-card">
      <h2 className="flex items-center gap-2 font-medium">
        <Briefcase className="h-4 w-4" />
        Staff profile
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        These details are yours, not a school&rsquo;s — changing them here updates them
        everywhere you are on staff.
      </p>

      <div className="mt-stack grid gap-stack sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">First name</span>
          <Input value={form.firstName} onChange={set('firstName')} className="mt-1" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Last name</span>
          <Input value={form.lastName} onChange={set('lastName')} className="mt-1" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Phone</span>
          <Input
            value={form.phone ?? ''}
            onChange={set('phone')}
            placeholder="+260977123456"
            className="mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <Input value={form.email ?? ''} onChange={set('email')} className="mt-1" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Location</span>
          <Input
            value={form.location ?? ''}
            onChange={set('location')}
            placeholder="Lusaka"
            className="mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Qualifications</span>
          <Input
            value={form.qualifications ?? ''}
            onChange={set('qualifications')}
            placeholder="BEd Mathematics, University of Zambia"
            className="mt-1"
          />
        </label>
      </div>

      <Button className="mt-stack" onClick={() => void save()} disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving ? 'Saving…' : 'Save my details'}
      </Button>

      <div className="mt-stack border-t border-border pt-stack">
        <h3 className="text-sm font-medium">
          {posts.length === 1 ? 'Your post' : `Your ${posts.length} posts`}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {/*
            Named explicitly, because a teacher who cannot find where to change their
            staff number should know it is not hidden — it is somebody else's to set.
          */}
          Your staff number, department, employment type and start date are set by each
          school. Ask the school office to change them.
        </p>

        <ul className="mt-stack space-y-2">
          {posts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{p.schoolName}</span>{' '}
                <span className="text-xs text-muted-foreground" data-numeric>
                  {p.schoolCode}
                </span>
                {p.department ? (
                  <span className="block text-xs text-muted-foreground">{p.department}</span>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                {p.staffNumber ? (
                  <span className="text-xs text-muted-foreground" data-numeric>
                    {p.staffNumber}
                  </span>
                ) : null}
                <Badge variant={p.isActive ? 'neutral' : 'warning'}>
                  {p.isActive ? (p.employmentType ?? 'staff') : 'No longer active'}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
