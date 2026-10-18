'use client'

/**
 * Editing a member of staff's record.
 *
 * Spec: `Official Documentation/08 Staff Management/STAFF.md` → *Staff Profile Fields*
 *
 * ## What this closes
 *
 * The Staff screen could invite somebody and change their Clerk role, and could change
 * **nothing about the person**. Staff number, department, employment type and join date
 * were displayed but read-only; phone, location and qualifications were not shown at all.
 * A school correcting a misspelled name had nowhere to do it.
 *
 * ## Role is not here, and that is deliberate
 *
 * Changing what somebody may DO lives on the row's own control, next to removal, where it
 * reads as an access decision. This panel changes who they ARE. Putting both in one form
 * would make "Save" sometimes grant a principal's powers, which is the kind of thing that
 * gets clicked by accident on a busy morning.
 *
 * ## Email is shown and cannot be edited
 *
 * It is the Clerk identity — the address the invitation went to and the one they sign in
 * with. Changing it here would desynchronise the record from the account, so it is
 * displayed for recognition and left alone.
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Loader2, Save, X } from 'lucide-react'

import { Button } from '../../../../components/ui/button'
import { Field, Input, Select, Textarea } from '../../../../components/ui/field'
import { FormGrid } from '../../../../components/ui/form'
import { Dialog } from '../../../../components/ui/dialog'
import { apiSend } from '../../../../lib/use-api'
import { useToast } from '../../../../components/ui/toast'
import { DateField } from '../../../../components/ui/date-field'

export interface StaffRecord {
  id: string
  first_name: string
  last_name: string
  email: string | null
  staff_number: string | null
  phone_e164: string | null
  department: string | null
  employment_type: string | null
  join_date: string | null
  location: string | null
  qualifications: string | null
}

const EMPLOYMENT = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'volunteer', label: 'Volunteer' },
] as const

export function EditStaff({
  staff,
  onSaved,
  onCancel,
}: {
  staff: StaffRecord
  onSaved: () => void
  onCancel: () => void
}): JSX.Element {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  // Seeded from the record so every field shows what is stored. `?? ''` because a
  // controlled input given null warns and then behaves as uncontrolled.
  const [form, setForm] = useState({
    firstName: staff.first_name ?? '',
    lastName: staff.last_name ?? '',
    staffNumber: staff.staff_number ?? '',
    phone: staff.phone_e164 ?? '',
    department: staff.department ?? '',
    employmentType: staff.employment_type ?? 'full_time',
    joinDate: staff.join_date ?? '',
    location: staff.location ?? '',
    qualifications: staff.qualifications ?? '',
  })

  const set = useCallback(
    (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value })),
    [],
  )

  const save = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      setBusy(true)
      try {
        const result = await apiSend('/api/school/staff/record', 'PATCH', {
          staffId: staff.id,
          ...form,
        })
        if (result.error) {
          toast(result.error, 'danger')
          return
        }
        toast('Staff record updated.', 'success')
        onSaved()
      } finally {
        setBusy(false)
      }
    },
    [staff.id, form, toast, onSaved],
  )

  return (
    /*
      A modal, not a panel above the table.

      Nine fields rendered inline pushed the row being edited off screen, so the
      person filling the form could no longer see who they were editing — and on a
      phone the table scrolled away entirely. `Dialog` uses `showModal()`, so the rest
      of the page is inert and focus cannot wander back into a table behind the form.
    */
    <Dialog
      open
      title={`${staff.first_name} ${staff.last_name}`}
      onClose={onCancel}
    >
      <form id="edit-staff" onSubmit={save} className="flex flex-col gap-cards">
      <div>
        {/* The Clerk identity. Shown for recognition, not editable — changing it here
            would desynchronise the record from the account they sign in with. */}
        <p className="text-sm text-muted-foreground">
          {staff.email ?? 'No email on the account'}
        </p>
      </div>

      <FormGrid columns={2}>
        <Field id="st-first" label="First name" required>
          {(props) => (
            <Input
              {...props}
              value={form.firstName}
              required
              onChange={(e) => set('firstName', e.target.value)}
            />
          )}
        </Field>

        <Field id="st-last" label="Last name" required>
          {(props) => (
            <Input
              {...props}
              value={form.lastName}
              required
              onChange={(e) => set('lastName', e.target.value)}
            />
          )}
        </Field>

        <Field
          id="st-number"
          label="Staff number"
          hint="Optional, and the school's own — ZSMS never generates one."
        >
          {(props) => (
            <Input
              {...props}
              value={form.staffNumber}
              onChange={(e) => set('staffNumber', e.target.value)}
            />
          )}
        </Field>

        <Field id="st-phone" label="Phone" hint="International format, e.g. +260971234567.">
          {(props) => (
            <Input {...props} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          )}
        </Field>

        <Field id="st-dept" label="Department" hint="Mathematics, Sciences, Administration…">
          {(props) => (
            <Input
              {...props}
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
            />
          )}
        </Field>

        <Field id="st-type" label="Employment type" required>
          {(props) => (
            <Select
              {...props}
              value={form.employmentType}
              onChange={(e) => set('employmentType', e.target.value)}
            >
              {EMPLOYMENT.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <DateField

          id="st-joined"
          label="Joined"
          hint="Set automatically when they accept an invitation; correct it here if they started earlier."
          value={form.joinDate}
          onChange={(v) => set('joinDate', v)}
          notFuture
        />

        <Field id="st-location" label="Location" hint="Town or province.">
          {(props) => (
            <Input
              {...props}
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
            />
          )}
        </Field>

        <Field
          id="st-quals"
          label="Qualifications"
          className="sm:col-span-2"
          hint="Degrees and teaching qualifications."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={form.qualifications}
              onChange={(e) => set('qualifications', e.target.value)}
            />
          )}
        </Field>
      </FormGrid>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" />}
          Save record
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          <X aria-hidden="true" />
          Cancel
        </Button>
        <p className="text-sm text-muted-foreground">
          Changing what they can <em>do</em> is the access control on their row.
        </p>
      </div>
      </form>
    </Dialog>
  )
}
