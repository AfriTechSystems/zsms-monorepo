'use client'

/**
 * What this school shows in the public directory.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## The screen's job is to make withholding feel as legitimate as publishing
 *
 * Every field here defaults to withheld, and the copy is written so that leaving it withheld reads as
 * a choice rather than an omission. A settings page that nags a school into publishing its class sizes
 * would be ZSMS using its position to extract data from a customer — and the whole design decision
 * behind this directory was that the badge should be something a school wants, not something it is
 * pressured into.
 *
 * ## The numbers are shown before the switch
 *
 * A head teacher cannot sensibly decide whether to publish their pupils-per-teacher without seeing
 * it. So the real figures appear next to each toggle, with the raw counts behind them — which is why
 * `school_verified_metrics()` is reachable with an account and not without one. This is the only
 * screen in ZSMS that shows them.
 *
 * ## Fees are the school's claim, not ours
 *
 * The band is typed in rather than derived from `fee_structures`. Derived would leak the real fee
 * table and would also be wrong, since a term's structure carries optional lines many parents never
 * pay. Labelled as the school's own statement wherever it appears.
 */

import type { JSX } from 'react'
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck, ExternalLink, Eye, EyeOff } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Field, Input, Textarea } from '../../../../../components/ui/field'
import { CheckboxField, FormActions, FormGrid, FormSection } from '../../../../../components/ui/form'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { useToast } from '../../../../../components/ui/toast'

interface ProfileRow {
  is_published: boolean
  about: string | null
  established_year: number | null
  website_url: string | null
  publish_ratio: boolean
  publish_class_sizes: boolean
  publish_fee_band: boolean
  fee_band_min: string | number | null
  fee_band_max: string | number | null
  has_boarding: boolean
  has_transport: boolean
  has_science_lab: boolean
  has_computer_lab: boolean
  has_library: boolean
  has_sports: boolean
  has_feeding: boolean
  has_special_needs: boolean
}

interface Payload {
  schoolCode: string
  schoolName: string
  profile: ProfileRow | null
  metrics: {
    pupils: number
    teachers: number
    classes: number
    pupilsPerTeacher: number | null
    avgClassSize: number | null
  } | null
}

const FACILITIES = [
  ['hasBoarding', 'has_boarding', 'Boarding'],
  ['hasTransport', 'has_transport', 'School transport'],
  ['hasScienceLab', 'has_science_lab', 'Science laboratory'],
  ['hasComputerLab', 'has_computer_lab', 'Computer laboratory'],
  ['hasLibrary', 'has_library', 'Library'],
  ['hasSports', 'has_sports', 'Sports facilities'],
  ['hasFeeding', 'has_feeding', 'Feeding programme'],
  ['hasSpecialNeeds', 'has_special_needs', 'Special needs support'],
] as const

export default function PublicProfileSettingsPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const { toast } = useToast()
  const { data, loading, error, code, reload } = useApi<Payload>('/api/school/public-profile')

  const [about, setAbout] = useState('')
  const [established, setEstablished] = useState('')
  const [website, setWebsite] = useState('')
  const [feeMin, setFeeMin] = useState('')
  const [feeMax, setFeeMax] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Seeded once the payload lands. The toggles below save immediately and read from `data`, so only
  // the free-text fields need local state at all.
  useEffect(() => {
    if (!data?.profile) return
    setAbout(data.profile.about ?? '')
    setEstablished(data.profile.established_year ? String(data.profile.established_year) : '')
    setWebsite(data.profile.website_url ?? '')
    setFeeMin(data.profile.fee_band_min !== null ? String(data.profile.fee_band_min) : '')
    setFeeMax(data.profile.fee_band_max !== null ? String(data.profile.fee_band_max) : '')
  }, [data])

  /**
   * One saver for everything. Toggles call it with a single field and save on the spot, because a
   * checkbox that needs a separate Save press is the commonest way a setting silently does not take.
   * The free-text block sends its fields together under an explicit button.
   */
  const save = useCallback(
    async (patch: Record<string, unknown>, label: string) => {
      setSaving(label)
      setSaveError(null)
      const result = await apiSend('/api/school/public-profile', 'PATCH', patch)
      setSaving(null)
      if (result.error) {
        setSaveError(result.error)
        return
      }
      reload()
      toast('Saved.')
    },
    [reload, toast],
  )

  const p = data?.profile
  const published = p?.is_published === true

  return (
    <>
      <PageHeader
        title="Public directory listing"
        description="What parents see when they find your school at zsms.co.zm. Everything beyond your name and town is yours to publish or withhold."
        backTo={`/school/${schoolCode}/settings`}
        backLabel="Settings"
        note="Your school always appears in the directory with its name, town, level and school code — parents need the code to sign in. Everything on this page is optional, and leaving it blank is a normal choice."
        actions={
          data && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/schools/${data.schoolCode}`} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                View your page
              </Link>
            </Button>
          )
        }
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={6} columns={2} />}

      {!error && data && (
        <div className="space-y-cards">
          <FormSection
            title={published ? 'Your extra details are live' : 'Your extra details are hidden'}
            description={
              published
                ? 'Parents can see everything you have switched on below.'
                : 'Only your name, town, level and school code appear. Turn this on when you are ready to show more.'
            }
            actions={
              <Badge variant={published ? 'success' : 'neutral'}>
                {published ? 'Published' : 'Hidden'}
              </Badge>
            }
          >
            <Button
              disabled={saving !== null}
              variant={published ? 'outline' : 'default'}
              onClick={() => void save({ isPublished: !published }, 'publish')}
            >
              {published ? (
                <>
                  <EyeOff aria-hidden="true" />
                  Hide extra details
                </>
              ) : (
                <>
                  <Eye aria-hidden="true" />
                  Publish extra details
                </>
              )}
            </Button>
          </FormSection>

          <FormSection
            title="Verified by ZSMS"
            description="We calculate these from your own pupil and staff records — you cannot edit them, and neither can we. Choose which to show."
          >
            <div className="space-y-stack">
              <div className="rounded-md border border-border p-card">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">Pupils per teacher</p>
                  <p data-numeric className="text-xl font-semibold">
                    {data.metrics?.pupilsPerTeacher ?? '—'}
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.metrics
                    ? `${data.metrics.pupils} pupils on the roll, ${data.metrics.teachers} ` +
                      `member${data.metrics.teachers === 1 ? '' : 's'} of staff with teaching assignments. ` +
                      'Staff without a teaching assignment are not counted.'
                    : 'Not enough information yet.'}
                </p>
                {/* Only the ratio is published, never the counts. Said here so a head teacher knows
                    exactly what a parent will see. */}
                <p className="mt-1 text-sm text-muted-foreground">
                  Parents see only the ratio, never your pupil or staff numbers.
                </p>
                <div className="mt-stack">
                  <CheckboxField
                    id="publish-ratio"
                    label="Show pupils per teacher"
                    checked={p?.publish_ratio === true}
                    disabled={saving !== null || !published}
                    onChange={(v) => void save({ publishRatio: v }, 'ratio')}
                    hint={!published ? 'Publish extra details first.' : undefined}
                  />
                </div>
              </div>

              <div className="rounded-md border border-border p-card">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">Average class size</p>
                  <p data-numeric className="text-xl font-semibold">
                    {data.metrics?.avgClassSize ?? '—'}
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.metrics
                    ? `Across ${data.metrics.classes} class${data.metrics.classes === 1 ? '' : 'es'} with pupils in them.`
                    : 'Not enough information yet.'}
                </p>
                <div className="mt-stack">
                  <CheckboxField
                    id="publish-class-sizes"
                    label="Show average class size"
                    checked={p?.publish_class_sizes === true}
                    disabled={saving !== null || !published}
                    onChange={(v) => void save({ publishClassSizes: v }, 'classes')}
                    hint={!published ? 'Publish extra details first.' : undefined}
                  />
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Fees"
            description="A range parents should expect, in your own words. We do not read this from your fee structures, and we do not label it as verified."
          >
            <FormGrid>
              <Field id="fee-min" label="Lowest term fee (K)">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    value={feeMin}
                    onChange={(e) => setFeeMin(e.target.value)}
                    placeholder="1500"
                  />
                )}
              </Field>
              <Field id="fee-max" label="Highest term fee (K)">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    value={feeMax}
                    onChange={(e) => setFeeMax(e.target.value)}
                    placeholder="3000"
                  />
                )}
              </Field>
            </FormGrid>
            <div className="mt-stack">
              <CheckboxField
                id="publish-fees"
                label="Show this range to parents"
                hint="Parents filter on affordability more than anything else. Showing a range is usually worth it."
                checked={p?.publish_fee_band === true}
                disabled={saving !== null || !published}
                onChange={(v) =>
                  void save(
                    {
                      publishFeeBand: v,
                      feeBandMin: feeMin === '' ? null : Number(feeMin),
                      feeBandMax: feeMax === '' ? null : Number(feeMax),
                    },
                    'fees',
                  )
                }
              />
            </div>
          </FormSection>

          <FormSection
            title="Facilities"
            description="Shown as a list on your page, and parents can filter on boarding and transport."
          >
            <FormGrid>
              {FACILITIES.map(([key, column, label]) => (
                <CheckboxField
                  key={key}
                  id={key}
                  label={label}
                  checked={p?.[column] === true}
                  disabled={saving !== null}
                  onChange={(v) => void save({ [key]: v }, key)}
                />
              ))}
            </FormGrid>
          </FormSection>

          <FormSection
            title="About your school"
            description="A short description, and where else parents can find you."
          >
            <FormGrid columns={1}>
              <Field
                id="about"
                label="Description"
                hint="Two or three sentences. Shown as plain text — the first 300 characters appear in search results."
              >
                {(props) => (
                  <Textarea
                    {...props}
                    value={about}
                    onChange={(e) => setAbout(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="A small day school in Chelston teaching Grade 1 to Grade 7, following the ECZ curriculum."
                  />
                )}
              </Field>
            </FormGrid>
            <FormGrid>
              <Field id="established" label="Year established">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={1850}
                    max={new Date().getFullYear()}
                    value={established}
                    onChange={(e) => setEstablished(e.target.value)}
                    placeholder="1998"
                  />
                )}
              </Field>
              <Field id="website" label="School website">
                {(props) => (
                  <Input
                    {...props}
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://example.sch.zm"
                  />
                )}
              </Field>
            </FormGrid>

            <FormActions>
              <Button
                disabled={saving !== null}
                onClick={() =>
                  void save(
                    {
                      about: about.trim(),
                      establishedYear: established === '' ? null : Number(established),
                      websiteUrl: website.trim() || undefined,
                    },
                    'about',
                  )
                }
              >
                {saving === 'about' ? 'Saving…' : 'Save description'}
              </Button>
            </FormActions>
          </FormSection>

          {saveError && (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
            >
              {saveError}
            </p>
          )}

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            ZSMS does not rank or score schools in the directory. We publish the facts you choose and
            calculate the ones we can verify.
          </p>
        </div>
      )}
    </>
  )
}
