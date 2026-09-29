'use client'

/**
 * `/register` — a school owner signs their own school up for a 30-day trial.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md` → Path 2
 *       `Official Documentation/06 School and Tenant Management/TRIAL.md`
 *
 * ## Account first, school second — the documented order, reversed
 *
 * `SCHOOL_SETUP.md` describes a fully public form that creates the school and then the account.
 * Built that way, the endpoint behind it mints a school identifier and a Clerk organisation for
 * anybody with `curl`, and there is no rate limiter to put in front of it — Upstash Redis does not
 * exist yet.
 *
 * So the halves are swapped. A visitor who is not signed in sees the reason and a button to create
 * an account; Clerk verifies their email by OTP, they come back, and the form appears. The end state
 * is the document's — a school, an organisation, an owner — and the verification that was going to
 * happen anyway happens before anything is created instead of after.
 *
 * It also removes a step: the registering person **becomes** the owner rather than being emailed an
 * invitation to a school they created ten seconds earlier.
 *
 * ## Three steps, and why the first one is the school
 *
 * The order is the document's, and it is the right way round for a reason worth keeping: asking for
 * the school before the person means the first thing the visitor does is describe something they
 * are proud of, not hand over their phone number.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'

import { getCountryConfig } from '@zsms/config'
import { SignedIn, SignedOut, useAuth, useOrganization } from '@zsms/auth-provider/react'

import { Button } from '../../components/ui/button'
import { Field, Input, Select } from '../../components/ui/field'
import { CheckboxField, FormGrid, FormSection } from '../../components/ui/form'

const TRIAL_DAYS = 30

type Step = 1 | 2 | 3

export default function RegisterPage(): JSX.Element {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-cards px-gutter py-10"
    >
      <header className="flex flex-col items-center gap-3 text-center">
        <Image
          src="/brand/zsms-lockup.png"
          alt="ZSMS — school management by AfriTech Systems"
          width={200}
          height={64}
          priority
          className="h-auto w-[150px] sm:w-[180px]"
        />
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Start your free trial
        </h1>
        <p className="max-w-lg text-sm text-muted-foreground">
          {TRIAL_DAYS} days, every feature, no card. Someone from AfriTech will call within a day to
          help you set up.
        </p>
      </header>

      <SignedOut>
        <FormSection
          title="First, create your account"
          description="We verify your email before setting up a school, so nobody can create one in your name."
        >
          <div className="flex flex-col gap-3">
            <Button asChild>
              {/* Back to this page after sign-up, so the flow continues where it left off rather
                  than dropping them at a school portal they do not have yet. */}
              <Link href="/sign-up?redirect_url=/register">
                Create an account
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have one?{' '}
              <Link href="/sign-in?redirect_url=/register" className="underline">
                Sign in
              </Link>{' '}
              and you will come straight back here.
            </p>
          </div>
        </FormSection>
      </SignedOut>

      <SignedIn>
        <RegistrationForm />
      </SignedIn>

      <p className="text-center text-xs text-subtle">
        ZSMS is a product of AfriTech Systems Limited.
      </p>
    </main>
  )
}

function RegistrationForm(): JSX.Element {
  const country = getCountryConfig()
  const { userId } = useAuth()
  const { organization } = useOrganization()

  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [type, setType] = useState('day')
  const [level, setLevel] = useState('combined')
  const [provinceCode, setProvinceCode] = useState('')
  const [cityCode, setCityCode] = useState('')

  const [ownerFirstName, setOwnerFirstName] = useState('')
  const [ownerLastName, setOwnerLastName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [referralSource, setReferralSource] = useState('')

  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)

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

  /**
   * An account that already belongs to a school cannot register another from this session. Said
   * here as well as refused by the route, because the useful moment to say it is before somebody
   * fills in three steps.
   */
  if (organization) {
    return (
      <FormSection title="You already belong to a school">
        <p className="text-sm text-muted-foreground">
          This account is a member of <strong>{organization.name}</strong>. Registering a second
          school needs an account of its own — or AfriTech can add one to this account for you.
        </p>
        <div className="mt-stack flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/school">Go to {organization.name}</Link>
          </Button>
        </div>
      </FormSection>
    )
  }

  const stepOneReady = name.trim().length >= 2 && provinceCode !== '' && cityCode !== ''
  const stepTwoReady =
    ownerFirstName.trim() !== '' && ownerLastName.trim() !== '' && ownerEmail.trim() !== ''
  const canSubmit = stepOneReady && stepTwoReady && acceptedTerms && acceptedPrivacy

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/register/school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          level,
          provinceCode,
          cityCode,
          ownerFirstName,
          ownerLastName,
          ownerEmail,
          ownerPhone: ownerPhone.trim() || null,
          referralSource: referralSource || null,
          acceptedTerms,
          acceptedPrivacy,
        }),
      })

      const body = (await response.json()) as
        | { data: { schoolCode: string } }
        | { error: string }

      if (!response.ok || !('data' in body)) {
        setError('error' in body ? body.error : 'Your school could not be registered.')
        setSubmitting(false)
        return
      }

      /**
       * A full reload rather than a client navigation. The Clerk session was minted before the
       * organisation existed, so it carries no `o` claim — and every RLS policy in the product
       * resolves through that claim. Soft-navigating would land on a school portal that renders
       * correctly empty, which reads as "registration lost my data".
       */
      window.location.href = '/school'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your school could not be registered.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <ol className="flex items-center gap-2 text-sm" aria-label="Progress">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} className="flex flex-1 items-center gap-2">
            <span
              aria-current={step === n ? 'step' : undefined}
              className={
                'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ' +
                (step > n
                  ? 'bg-success text-success-foreground'
                  : step === n
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground')
              }
            >
              {step > n ? <Check aria-hidden="true" className="size-3.5" /> : n}
            </span>
            <span className={step === n ? 'font-medium' : 'text-muted-foreground'}>
              {n === 1 ? 'School' : n === 2 ? 'You' : 'Confirm'}
            </span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <FormSection
          title="Your school"
          description="The city becomes part of your school's permanent ZSMS code, so it cannot be changed later."
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
              label="City or town"
              required
              hint={provinceCode === '' ? 'Choose a province first.' : undefined}
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
          </FormGrid>

          <div className="mt-stack flex justify-end">
            <Button disabled={!stepOneReady} onClick={() => setStep(2)}>
              Continue
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </FormSection>
      )}

      {step === 2 && (
        <FormSection
          title="About you"
          description="You will be the school's owner — the only role that can add staff and change settings."
        >
          <FormGrid>
            <Field id="first" label="First name" required>
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

            <Field id="last" label="Last name" required>
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

            <Field id="email" label="Email" required hint="Where AfriTech will contact you.">
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

            <Field id="phone" label="Phone" hint="International format, e.g. +260971234567.">
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

            <Field id="referral" label="How did you hear about ZSMS?" className="sm:col-span-2">
              {(props) => (
                <Select
                  {...props}
                  value={referralSource}
                  onChange={(e) => setReferralSource(e.target.value)}
                >
                  <option value="">Prefer not to say</option>
                  <option value="word_of_mouth">Word of mouth</option>
                  <option value="referred_by_school">Another school referred us</option>
                  <option value="social_media">Social media</option>
                  <option value="search">Search</option>
                  <option value="other">Something else</option>
                </Select>
              )}
            </Field>
          </FormGrid>

          <div className="mt-stack flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            <Button disabled={!stepTwoReady} onClick={() => setStep(3)}>
              Continue
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </FormSection>
      )}

      {step === 3 && (
        <FormSection title="Check and confirm">
          <dl className="grid grid-cols-1 gap-stack sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">School</dt>
              <dd className="text-sm">{name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Where</dt>
              <dd className="text-sm">
                {country.cities[cityCode]}, {country.provinces[provinceCode]}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Owner</dt>
              <dd className="text-sm">
                {ownerFirstName} {ownerLastName}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Contact</dt>
              <dd className="text-sm">
                {ownerEmail}
                {ownerPhone ? ` · ${ownerPhone}` : ''}
              </dd>
            </div>
          </dl>

          <div className="mt-stack flex flex-col gap-2">
            <CheckboxField
              id="terms"
              label={
                <>
                  I accept the{' '}
                  <Link
                    href="/legal/terms"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Terms of Service
                  </Link>
                </>
              }
              checked={acceptedTerms}
              onChange={setAcceptedTerms}
            />
            <CheckboxField
              id="privacy"
              label={
                <>
                  I accept the{' '}
                  <Link
                    href="/legal/privacy"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Privacy Policy
                  </Link>
                  , and understand my school becomes responsible for its pupils&rsquo; data
                </>
              }
              checked={acceptedPrivacy}
              onChange={setAcceptedPrivacy}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="mt-stack flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="mt-stack flex justify-between">
            <Button variant="outline" disabled={submitting} onClick={() => setStep(2)}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            <Button disabled={!canSubmit || submitting || !userId} onClick={() => void submit()}>
              {submitting && <Loader2 aria-hidden="true" className="animate-spin" />}
              {submitting ? 'Setting up your school…' : `Start my ${TRIAL_DAYS}-day trial`}
            </Button>
          </div>
        </FormSection>
      )}
    </>
  )
}
