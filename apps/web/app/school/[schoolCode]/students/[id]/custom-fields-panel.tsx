'use client'

/**
 * The school-defined fields on one pupil's record.
 *
 * Spec: migrations `0110` / `0111`
 *
 * ## A separate form, deliberately
 *
 * It saves through its own endpoint rather than joining the standard record
 * form. Two reasons, and the second matters more:
 *
 *   - The standard columns and the custom values are different tables with
 *     different policies, so one submit would half-succeed in ways neither
 *     form could report honestly.
 *   - A teacher can be allowed to save nothing here while still editing the
 *     standard record elsewhere. Merging them would mean the wider form
 *     inherits the narrower form's refusal.
 *
 * ## Only what changed is sent
 *
 * A sensitive field the reader could not see is never in the payload, so their
 * save cannot blank a medical note they were not shown. The endpoint treats an
 * absent key as "leave alone" and an empty string as "clear this" — which is
 * only safe because the two are genuinely distinguishable here.
 */

import type { FormEvent, JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Save } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Button } from '../../../../../components/ui/button'
import { FormActions, FormGrid, FormSection } from '../../../../../components/ui/form'
import { CustomFieldInput, type CustomFieldState } from '../../../../../components/ui/custom-field-input'
import { useToast } from '../../../../../components/ui/toast'
import { readCustomValue, type CustomValueColumns } from '../../../../../lib/custom-fields'

interface FieldRow extends CustomFieldState {
  value: Partial<CustomValueColumns> | null
  readable: boolean
}

interface Payload {
  fields: FieldRow[]
  canWriteStandard: boolean
  canWriteSensitive: boolean
}

export function CustomFieldsPanel({ studentId }: { studentId: string }): JSX.Element | null {
  const { toast } = useToast()
  const { data, loading, error, reload } = useApi<Payload>(
    `/api/school/students/${studentId}/custom-values`,
  )

  const [entries, setEntries] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    const seeded: Record<string, string> = {}
    for (const f of data.fields) {
      // A boolean reads back as "Yes"/"No" for display; the control wants the
      // lower-case token it renders as an option value.
      const raw = readCustomValue(f, f.value)
      seeded[f.field_key] = f.field_type === 'boolean' ? raw.toLowerCase() : raw
    }
    setEntries(seeded)
  }, [data])

  const editable = useMemo(
    () =>
      (data?.fields ?? []).filter(
        (f) => f.readable && (f.sensitivity === 'standard' || data?.canWriteSensitive),
      ),
    [data],
  )

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSaving(true)
      setFormError(null)

      // Only fields this reader can actually see and write. See the header.
      const values: Record<string, string> = {}
      for (const f of editable) values[f.field_key] = entries[f.field_key] ?? ''

      const result = await apiSend(
        `/api/school/students/${studentId}/custom-values`,
        'PUT',
        { values },
      )

      setSaving(false)
      if (result.error) {
        setFormError(result.error)
        return
      }
      toast('Pupil details saved.')
      reload()
    },
    [editable, entries, studentId, toast, reload],
  )

  // Nothing to render when the school has defined no extra fields. An empty
  // section headed "Additional details" reads as something being broken.
  if (loading || error || !data || data.fields.length === 0) return null

  return (
    <form onSubmit={save} noValidate>
      <FormSection
        title="Additional details"
        description="Fields this school has chosen to record."
      >
        <FormGrid columns={2}>
          {data.fields.map((f) => (
            <CustomFieldInput
              key={f.id}
              field={f}
              value={entries[f.field_key] ?? ''}
              disabled={
                !data.canWriteStandard ||
                (f.sensitivity === 'sensitive' && !data.canWriteSensitive)
              }
              onChange={(v) => setEntries((s) => ({ ...s, [f.field_key]: v }))}
            />
          ))}
        </FormGrid>

        {formError && (
          <Alert variant="danger" title="Not saved" className="mt-stack">
            {formError}
          </Alert>
        )}

        {data.canWriteStandard && editable.length > 0 && (
          <FormActions>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Save aria-hidden="true" />
              )}
              Save additional details
            </Button>
          </FormActions>
        )}
      </FormSection>
    </form>
  )
}
