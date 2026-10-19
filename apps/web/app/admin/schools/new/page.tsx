'use client'

/**
 * Add a school — the AfriTech-created path.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md` → Path 1
 *
 * ## The city field is the one that cannot be undone
 *
 * Everything on this form is editable later except the city, which becomes part of the school
 * identifier (`ZM-LSK-0001`) the moment this is submitted — and business rule 1 makes that
 * identifier permanent, because it is embedded in every pupil number and every receipt number the
 * school will ever issue. `SCHOOL_SETUP.md`'s own edge case says a school registered under the
 * wrong city keeps its identifier and AfriTech corrects only the field.
 *
 * So the city gets a warning the other fields do not, and the province is chosen first to narrow
 * the list — picking "Ndola" out of thirteen unsorted cities is how the wrong one gets chosen.
 *
 * ## What the draft deliberately does not keep
 *
 * `useFormDraft` is an allowlist, and the owner's email and phone and AfriTech's internal notes
 * are **not on it**. Draft state lives in `localStorage`, and "this school has missed two
 * payments" persisting on a laptop after sign-out is not something to do by accident. The school's
 * own details are on the list — losing those to a mistyped URL is an annoyance worth preventing.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert, Building2 } from 'lucide-react'

import { getCountryConfig } from '@zsms/config'
import { useAuth } from '@zsms/auth-provider/react'

import { Button } from '../../../../components/ui/button'
import { Field, Input, Select, Textarea } from '../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../components/ui/form'
import { PageHeader } from '../../../../components/ui/data-states'
import { DraftNotice } from '../../../../components/ui/draft-notice'
import { draftAge, useFormDraft } from '../../../../lib/use-form-draft'
import { useToast } from '../../../../components/ui/toast'
import { TIER_LABEL } from '../../health-shared'

interface ProvisionResult {
  id: string
  schoolCode: string
  name: string
  status: string
  ownerInvited: boolean
  ownerInvitationError: string | null
}

export default function NewSchoolPage(): JSX.Element {
  const router = useRouter()
  const { toast } = useToast()
  const { userId } = useAuth()
  const country = getCountryConfig()

  const [name, setName] = useState('')
  const [type, setType] = useState('day')
  const [level, setLevel] = useState('combined')
  const [provinceCode, setProvinceCode] = useState('')
  const [cityCode, setCityCode] = useState('')
  const [address, setAddress] = useState('')
  const [ministryRegNumber, setMinistryRegNumber] = useState('')
  const [subscriptionTier, setSubscriptionTier] = useState('starter')

  const [ownerFirstName, setOwnerFirstName] = useState('')
  const [ownerLastName, setOwnerLastName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draft = useFormDraft({
    formId: 'admin-new-school',
    userId,
    values: { name, type, level, provinceCode, cityCode, address, ministryRegNumber, subscriptionTier },
    // The school's own details only. Owner contact and internal notes are excluded — see above.
    fields: ['name', 'type', 'level', 'provinceCode', 'cityCode', 'address',
             'ministryRegNumber', 'subscriptionTier'],
    enabled: !submitting,
  })

  const provinces = useMemo(
    () => Object.entries(country.provinces).sort((a, b) => a[1].localeCompare(b[1])),
    [country],
  )

  const cities = useMemo(
    () =>
      Object.entries(country.cities)
        .filter(([code]) => country.cityProvince[code] === provinceCode)
        .sort((a, b) => a[1].localeCompare(b[1])),
    [country, provinceCode],
  )

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/schools/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          level,
          provinceCode,
          cityCode,
          address: address.trim() || null,
          ministryRegNumber: ministryRegNumber.trim() || null,
          ownerFirstName,
          ownerLastName,
          ownerEmail,
          ownerPhone: ownerPhone.trim() || null,
          subscriptionTier,
          internalNotes: internalNotes.trim() || null,
        }),
      })

      const body = (await response.json()) as
        | { data: ProvisionResult }
        | { error: string; details?: unknown }

      if (!response.ok || !('data' in body)) {
        setError('error' in body ? body.error : 'The school could not be created.')
        setSubmitting(false)
        return
      }

      const school = body.data
      draft.clear()

      /**
       * A provisioned school whose owner could not be invited is still a success — the school
       * exists and is reachable. Saying so plainly beats a generic "created" that leaves the
       * operator believing an email is on its way.
       */
      if (school.ownerInvited) {
        toast(`${school.schoolCode} created — ${ownerEmail} invited as owner.`)
      } else {
        toast(
          `${school.schoolCode} created, but the owner could not be invited. ` +
            `Send the invitation from the school's staff screen.`,
          'danger',
        )
      }

      router.push(`/admin/schools/${school.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The school could not be created.')
      setSubmitting(false)
    }
  }

  const ready =
    name.trim().length >= 2 &&
    provinceCode !== '' &&
    cityCode !== '' &&
    ownerFirstName.trim() !== '' &&
    ownerLastName.trim() !== '' &&
    ownerEmail.trim() !== ''

  return (
    <>
      <PageHeader
        title="Add a school"
        description="Creates the school, its Clerk organisation and its onboarding checklist, then invites the owner."
        backTo="/admin/schools"
        backLabel="Schools"
      />

      {draft.pending && (
        <DraftNotice
          savedAgo={draftAge(draft.savedAt)}
          onRestore={() => {
            const d = draft.restore()
            if (!d) return
            if (typeof d.name === 'string') setName(d.name)
            if (typeof d.type === 'string') setType(d.type)
            if (typeof d.level === 'string') setLevel(d.level)
            if (typeof d.provinceCode === 'string') setProvinceCode(d.provinceCode)
            if (typeof d.cityCode === 'string') setCityCode(d.cityCode)
            if (typeof d.address === 'string') setAddress(d.address)
            if (typeof d.ministryRegNumber === 'string') setMinistryRegNumber(d.ministryRegNumber)
            if (typeof d.subscriptionTier === 'string') setSubscriptionTier(d.subscriptionTier)
          }}
          onDiscard={draft.discard}
        />
      )}

      <form onSubmit={submit} className="flex flex-col gap-cards">
        <FormSection
          title="The school"
          description="Name and location. The city cannot be changed once the school exists."
        >
          <FormGrid>
            <Field id="name" label="School name" required className="sm:col-span-2">
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sunrise Academy"
                  maxLength={160}
                  required
                />
              )}
            </Field>

            <Field id="type" label="Type" required>
              {(props) => (
                <Select {...props} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="day">Day</option>
                  <option value="boarding">Boarding</option>
                  <option value="both">Both</option>
                </Select>
              )}
            </Field>

            <Field id="level" label="Level" required>
              {(props) => (
                <Select {...props} value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="pre">Pre-school</option>
                  <option value="primary">Primary</option>
                  <option value="secondary">Secondary</option>
                  <option value="combined">Combined</option>
                </Select>
              )}
            </Field>

            <Field id="province" label="Province" required>
              {(props) => (
                <Select
                  {...props}
                  value={provinceCode}
                  onChange={(e) => {
                    setProvinceCode(e.target.value)
                    // Clearing the city is not tidiness — keeping it would leave a city from the
                    // previous province selected and invisible, and the server would reject it
                    // after the operator had filled in the rest of the form.
                    setCityCode('')
                  }}
                  required
                >
                  <option value="">Choose a province…</option>
                  {provinces.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="city"
              label="City"
              required
              hint={
                cityCode
                  ? `The identifier will be ${country.code}-${cityCode}-nnnn, permanently.`
                  : 'Choose a province first.'
              }
            >
              {(props) => (
                <Select
                  {...props}
                  value={cityCode}
                  onChange={(e) => setCityCode(e.target.value)}
                  disabled={provinceCode === ''}
                  required
                >
                  <option value="">
                    {provinceCode === '' ? 'Choose a province first…' : 'Choose a city…'}
                  </option>
                  {cities.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="address" label="Physical address" className="sm:col-span-2">
              {(props) => (
                <Input
                  {...props}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Plot 1234, Great East Road"
                  maxLength={300}
                />
              )}
            </Field>

            <Field
              id="ministry"
              label="Ministry registration number"
              hint="For AfriTech's records. Not shown to parents."
            >
              {(props) => (
                <Input
                  {...props}
                  value={ministryRegNumber}
                  onChange={(e) => setMinistryRegNumber(e.target.value)}
                  placeholder="MOE/2019/4471"
                  maxLength={80}
                />
              )}
            </Field>

            <Field
              id="tier"
              label="Subscription tier"
              hint="Changeable at any time from the school's page."
            >
              {(props) => (
                <Select
                  {...props}
                  value={subscriptionTier}
                  onChange={(e) => setSubscriptionTier(e.target.value)}
                >
                  {Object.entries(TIER_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection
          title="The owner"
          description="They receive an email invitation and become the school's owner when they accept. No trial is started — AfriTech-created schools go straight to verification."
        >
          <FormGrid>
            <Field id="owner-first" label="First name" required>
              {(props) => (
                <Input
                  {...props}
                  value={ownerFirstName}
                  onChange={(e) => setOwnerFirstName(e.target.value)}
                  maxLength={80}
                  required
                />
              )}
            </Field>

            <Field id="owner-last" label="Last name" required>
              {(props) => (
                <Input
                  {...props}
                  value={ownerLastName}
                  onChange={(e) => setOwnerLastName(e.target.value)}
                  maxLength={80}
                  required
                />
              )}
            </Field>

            <Field
              id="owner-email"
              label="Email"
              required
              hint="Where the invitation goes. If they already have a ZSMS account, accepting adds it to this school."
            >
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  maxLength={200}
                  required
                />
              )}
            </Field>

            <Field id="owner-phone" label="Phone" hint="International format, e.g. +260971234567.">
              {(props) => (
                <Input
                  {...props}
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="+260971234567"
                  maxLength={20}
                />
              )}
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection
          title="Internal notes"
          description="AfriTech only — never shown to the school. Not kept in the browser draft."
        >
          <Field id="notes" label="Notes">
              {(props) => (
              <Textarea
                {...props}
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="How this school came to us, who the contact is, anything the next person should know."
              />
              )}
            </Field>
        </FormSection>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <FormActions>
          <Button type="submit" disabled={!ready || submitting}>
            <Building2 aria-hidden="true" />
            {submitting ? 'Creating…' : 'Create school'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push('/admin/schools')}>
            Cancel
          </Button>
          {draft.savedAt && !submitting && (
            <span className="text-sm text-muted-foreground">Draft saved {draftAge(draft.savedAt)}</span>
          )}
        </FormActions>
      </form>
    </>
  )
}
