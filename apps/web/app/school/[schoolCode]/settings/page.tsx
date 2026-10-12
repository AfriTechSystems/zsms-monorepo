'use client'

/**
 * School settings — profile, academic structure, term dates.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_CONFIG.md`
 *
 * ## One page with three sections, not three pages
 *
 * The agreed navigation listed School profile, Academic structure and Term dates as three Settings
 * entries. Building it, three pages for roughly six fields, five fields and a small table is
 * fragmentation rather than structure — a settings panel is visited rarely and read top to bottom,
 * and splitting it would mean three round trips to change three related things. One page, three
 * clearly separated cards, one sidebar entry.
 *
 * ## Read-only fields are SHOWN, not hidden
 *
 * Subscription tier, status and the school identifier are rendered and disabled rather than left
 * out. A school owner seeing their tier greyed out learns something true: that ZSMS holds it and
 * AfriTech sets it. Omitting it would suggest the product has no record of what they are paying
 * for, and the first support question would be why.
 *
 * They are not editable here because `0140` revoked the column grants — before that, a school owner
 * could set their own tier to `enterprise`. Disabling the input is a courtesy on top of a
 * privilege boundary, never the boundary itself.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CalendarRange, Lock, Plus } from 'lucide-react'

import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card'
import { SectionTabs, useSectionTabs } from '../../../../components/ui/section-tabs'
import { SettingsHub } from './settings-hub'
import { Field, Input, Select } from '../../../../components/ui/field'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { SettingsHistory } from '../../../../components/ui/settings-history'
import { useToast } from '../../../../components/ui/toast'

interface Profile {
  id: string
  school_id: string
  name: string
  display_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  ministry_reg_number: string | null
  type: string
  level: string
  city_code: string
  country_code: string
  status: string
  subscription_tier: string
}

interface Academic {
  curriculum_type: string | null
  structure_type: string | null
  highest_level_offered: string | null
  grading_system: string | null
  report_card_format: string | null
  class_naming_convention: string | null
}

interface Term {
  id: string
  academic_year: string
  term_number: number
  starts_on: string
  ends_on: string
}

interface CurrentTerm {
  academic_year: string
  term_number: number
  starts_on: string
  ends_on: string
  is_between: boolean
}

interface Payload {
  profile: Profile
  academic: Academic | null
  terms: Term[]
  currentTerm: CurrentTerm | null
  readOnly: { commercial: string[]; identity: string[]; reason: string }
  role: string
}

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export default function SchoolSettingsPage(): JSX.Element {
  /*
    The school's own path prefix, for the hub's tile links.

    Read from the route rather than threaded through props: this screen is always
    at `/school/<code>/settings`, and `useParams` is how every sibling resolves it.
  */
  const routeParams = useParams<{ schoolCode: string }>()
  const base = `/school/${routeParams.schoolCode}`

  const { toast } = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [section, setSection] = useSectionTabs<'profile' | 'academic' | 'terms'>('profile', ['profile', 'academic', 'terms'])

  const [profile, setProfile] = useState<Partial<Profile>>({})
  const [academic, setAcademic] = useState<Partial<Academic>>({})
  const [term, setTerm] = useState<{
    id?: string
    academicYear: string
    termNumber: string
    startsOn: string
    endsOn: string
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/school/settings')
      const body = (await response.json()) as { data?: Payload; error?: string }
      if (!response.ok || !body.data) {
        setError(body.error ?? 'Could not load settings.')
        setLoading(false)
        return
      }
      setError(null)
      setData(body.data)
      setProfile(body.data.profile)
      setAcademic(body.data.academic ?? {})
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (body: unknown, message: string): Promise<void> => {
    setSaving(true)
    try {
      const response = await fetch('/api/school/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as { error?: string }
      toast(response.ok ? message : (payload.error ?? 'That did not work.'),
            response.ok ? 'success' : 'danger')
      if (response.ok) void load()
    } catch {
      toast('Could not reach the server.', 'danger')
    }
    setSaving(false)
  }

  const saveTerm = async (): Promise<void> => {
    if (!term) return
    setSaving(true)
    try {
      const response = await fetch('/api/school/settings/terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: term.id,
          academicYear: term.academicYear,
          termNumber: Number(term.termNumber),
          startsOn: term.startsOn,
          endsOn: term.endsOn,
        }),
      })
      const payload = (await response.json()) as { error?: string }
      toast(response.ok ? 'Term saved.' : (payload.error ?? 'That did not work.'),
            response.ok ? 'success' : 'danger')
      if (response.ok) {
        setTerm(null)
        void load()
      }
    } catch {
      toast('Could not reach the server.', 'danger')
    }
    setSaving(false)
  }

  if (loading) return <TableSkeleton rows={8} columns={2} />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (!data) return <ErrorState message="No settings to show." onRetry={() => void load()} />

  return (
    <>
      <PageHeader
        title="School settings"
        description="Your school's details, academic structure and term calendar."
        note="Your subscription tier and school identifier are shown but cannot be changed here — AfriTech sets the first, and the second appears inside every pupil number and receipt ever issued."
      />

      {/*
        Every settings area as a tile (reference W4).

        The image uses tiles as TABS across one page; ZSMS has fourteen settings areas
        that are already separate routes with their own permissions and deep links, so
        collapsing them into tabs would lose all three. As a hub the tiles solve the
        problem the image is actually solving — finding a setting without reading a
        sidebar of fourteen similar-sounding entries.
      */}
      <SettingsHub base={base} role={data.role} />

      {/* Three sections on one screen. Switched rather than scrolled past: term dates
          sat below two long forms, and nothing told anybody the screen had them. */}
      <SectionTabs
        tabs={[
          { key: 'profile', label: 'School profile' },
          { key: 'academic', label: 'Academic structure' },
          { key: 'terms', label: 'Term dates' },
        ]}
        active={section}
        onChange={setSection}
      />

      <div className="space-y-cards">
        {/* ---------------- Profile ---------------- */}
        {section === 'profile' && (
          <Card>
            <CardHeader>
              <CardTitle>School profile</CardTitle>
              <CardDescription>
                Appears on report cards, receipts and every message sent to a parent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="name" label="School name" required>
                  {(props) => (
                    <Input
                      {...props}
                      value={profile.name ?? ''}
                      onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    />
                  )}
                </Field>

                <Field
                  id="display-name"
                  label="Short name"
                  hint="For tight spaces like the portal header. Blank uses the full name."
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={profile.display_name ?? ''}
                      onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                    />
                  )}
                </Field>

                <Field id="phone" label="Phone" hint="International format, e.g. +260971234567.">
                  {(props) => (
                    <Input
                      {...props}
                      type="tel"
                      value={profile.phone ?? ''}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    />
                  )}
                </Field>

                <Field id="email" label="Email">
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      value={profile.email ?? ''}
                      onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    />
                  )}
                </Field>

                <Field id="address" label="Address" className="sm:col-span-2">
                  {(props) => (
                    <Input
                      {...props}
                      value={profile.address ?? ''}
                      onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                    />
                  )}
                </Field>

                <Field id="type" label="School type">
                  {(props) => (
                    <Select
                      {...props}
                      value={profile.type ?? 'day'}
                      onChange={(e) => setProfile({ ...profile, type: e.target.value })}
                    >
                      <option value="day">Day</option>
                      <option value="boarding">Boarding</option>
                      <option value="hybrid">Day and boarding</option>
                    </Select>
                  )}
                </Field>

                <Field id="level" label="Level">
                  {(props) => (
                    <Select
                      {...props}
                      value={profile.level ?? 'combined'}
                      onChange={(e) => setProfile({ ...profile, level: e.target.value })}
                    >
                      <option value="primary">Primary</option>
                      <option value="secondary">Secondary</option>
                      <option value="combined">Combined</option>
                    </Select>
                  )}
                </Field>

                <Field
                  id="ministry"
                  label="Ministry registration number"
                  hint="Optional. Printed on attendance certificates and formal documents."
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={profile.ministry_reg_number ?? ''}
                      onChange={(e) =>
                        setProfile({ ...profile, ministry_reg_number: e.target.value })
                      }
                    />
                  )}
                </Field>

                <Field id="logo" label="Logo URL" hint="Appears on PDFs and in the portal header.">
                  {(props) => (
                    <Input
                      {...props}
                      value={profile.logo_url ?? ''}
                      onChange={(e) => setProfile({ ...profile, logo_url: e.target.value })}
                    />
                  )}
                </Field>
              </div>

              {/*
                Shown and disabled rather than omitted. A school owner seeing their tier greyed out
                learns that ZSMS holds it and AfriTech sets it; hiding it would suggest the product
                has no record of what they pay for.
              */}
              <div className="rounded-lg border border-border bg-sunken p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium text-text">
                  <Lock className="size-4" aria-hidden />
                  Set by AfriTech
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-text">School identifier</p>
                    <p className="font-mono text-sm text-text">{data.profile.school_id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-text">Subscription</p>
                    <p className="text-sm text-text">
                      <Badge variant="info">{data.profile.subscription_tier}</Badge>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-text">Status</p>
                    <p className="text-sm text-text">
                      <Badge variant={data.profile.status === 'active' ? 'success' : 'warning'}>
                        {data.profile.status}
                      </Badge>
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-text">{data.readOnly.reason}</p>
              </div>

              <Button
                onClick={() =>
                  void save(
                    {
                      profile: {
                        name: profile.name,
                        displayName: profile.display_name,
                        address: profile.address,
                        phone: profile.phone || null,
                        email: profile.email || null,
                        logoUrl: profile.logo_url || null,
                        ministryRegNumber: profile.ministry_reg_number,
                        type: profile.type,
                        level: profile.level,
                      },
                    },
                    'Profile saved.',
                  )
                }
                disabled={saving || !profile.name || profile.name.trim().length < 2}
              >
                {saving ? 'Saving…' : 'Save profile'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ---------------- Academic structure ---------------- */}
        {section === 'academic' && (
          <Card>
            <CardHeader>
              <CardTitle>Academic structure</CardTitle>
              <CardDescription>
                Zambia runs two systems at once — traditional ECZ grades and the 2023 reform. This is
                which one your school follows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="curriculum" label="Curriculum">
                  {(props) => (
                    <Select
                      {...props}
                      value={academic.curriculum_type ?? 'ecz'}
                      onChange={(e) => setAcademic({ ...academic, curriculum_type: e.target.value })}
                    >
                      <option value="ecz">ECZ</option>
                      <option value="cambridge_igcse">Cambridge IGCSE</option>
                      <option value="cambridge_alevel">Cambridge A-Level</option>
                      <option value="mixed">Mixed</option>
                    </Select>
                  )}
                </Field>

                <Field id="grading" label="Grading system">
                  {(props) => (
                    <Select
                      {...props}
                      value={academic.grading_system ?? 'ecz'}
                      onChange={(e) => setAcademic({ ...academic, grading_system: e.target.value })}
                    >
                      <option value="ecz">ECZ traditional</option>
                      <option value="cambridge_o">Cambridge O-Level</option>
                      <option value="cambridge_a">Cambridge A-Level</option>
                      <option value="custom">School-defined</option>
                    </Select>
                  )}
                </Field>

                <Field
                  id="structure"
                  label="Grade structure"
                  hint="Grades 1–12, or the 2023 reform's Grades 1–6 then Forms 1–6."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={academic.structure_type ?? 'traditional'}
                      onChange={(e) => setAcademic({ ...academic, structure_type: e.target.value })}
                    >
                      <option value="traditional">Grades 1–12 (traditional)</option>
                      <option value="reform">Grades 1–6 then Forms 1–6 (2023 reform)</option>
                      <option value="hybrid">Both, mid-transition</option>
                    </Select>
                  )}
                </Field>

                <Field id="highest" label="Highest level offered">
                  {(props) => (
                    <Input
                      {...props}
                      value={academic.highest_level_offered ?? ''}
                      onChange={(e) =>
                        setAcademic({ ...academic, highest_level_offered: e.target.value })
                      }
                    />
                  )}
                </Field>
              </div>

              <Button
                onClick={() =>
                  void save(
                    {
                      academic: {
                        curriculumType: academic.curriculum_type ?? undefined,
                        gradingSystem: academic.grading_system ?? undefined,
                        structureType: academic.structure_type ?? undefined,
                        highestLevelOffered: academic.highest_level_offered ?? undefined,
                      },
                    },
                    'Academic structure saved.',
                  )
                }
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save academic structure'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ---------------- Term dates ---------------- */}
        {section === 'terms' && (
          <Card>
            <CardHeader>
              <CardTitle>Term dates</CardTitle>
              <CardDescription>
                When each term runs. Fees, marks and attendance are all recorded against a term —
                until these are set, nothing in ZSMS knows which term today falls in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.currentTerm ? (
                <Alert
                  variant={data.currentTerm.is_between ? 'warning' : 'info'}
                  title={
                    data.currentTerm.is_between
                      ? `On holiday — term ${data.currentTerm.term_number} starts ${shortDate(data.currentTerm.starts_on)}`
                      : `Currently in ${data.currentTerm.academic_year} term ${data.currentTerm.term_number}`
                  }
                >
                  {shortDate(data.currentTerm.starts_on)} to {shortDate(data.currentTerm.ends_on)}
                </Alert>
              ) : (
                <Alert variant="warning" title="No term dates set">
                  Add your terms below. Without them nothing can work out which term a payment or a
                  mark belongs to without being told.
                </Alert>
              )}

              {data.terms.length > 0 && (
                <ul className="divide-y divide-border">
                  {data.terms.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium text-text">
                          {t.academic_year} · Term {t.term_number}
                        </p>
                        <p className="text-xs text-muted-text">
                          {shortDate(t.starts_on)} to {shortDate(t.ends_on)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setTerm({
                            id: t.id,
                            academicYear: t.academic_year,
                            termNumber: String(t.term_number),
                            startsOn: t.starts_on,
                            endsOn: t.ends_on,
                          })
                        }
                      >
                        Edit
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {term ? (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field id="ay" label="Academic year" required>
                      {(props) => (
                        <Input
                          {...props}
                          value={term.academicYear}
                          onChange={(e) => setTerm({ ...term, academicYear: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field id="tn" label="Term" required>
                      {(props) => (
                        <Input
                          {...props}
                          type="number"
                          min={1}
                          max={6}
                          value={term.termNumber}
                          onChange={(e) => setTerm({ ...term, termNumber: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field id="so" label="Starts" required>
                      {(props) => (
                        <Input
                          {...props}
                          type="date"
                          value={term.startsOn}
                          onChange={(e) => setTerm({ ...term, startsOn: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field id="eo" label="Ends" required>
                      {(props) => (
                        <Input
                          {...props}
                          type="date"
                          value={term.endsOn}
                          onChange={(e) => setTerm({ ...term, endsOn: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void saveTerm()}
                      disabled={saving || !term.academicYear || !term.startsOn || !term.endsOn}
                    >
                      {saving ? 'Saving…' : 'Save term'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTerm(null)}>
                      Cancel
                    </Button>
                  </div>
                  <p className="text-xs text-muted-text">
                    Terms cannot overlap. If they do, ZSMS says which one clashes.
                  </p>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setTerm({
                      academicYear: String(new Date().getFullYear()),
                      termNumber: String(Math.min(data.terms.length + 1, 6)),
                      startsOn: '',
                      endsOn: '',
                    })
                  }
                >
                  <Plus className="size-4" aria-hidden />
                  Add a term
                </Button>
              )}

              <p className="flex items-center gap-2 text-xs text-muted-text">
                <CalendarRange className="size-3" aria-hidden />
                A term cannot be deleted here — fees, marks and attendance reference it by number.
                Contact AfriTech if one was added by mistake.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Renders nothing until something has actually been changed — see the component.
          The school sees its own history here; AfriTech sees the same rows on the school's
          admin page, because it is the same question asked by two people. */}
      <SettingsHistory className="mt-cards" />
    </>
  )
}
