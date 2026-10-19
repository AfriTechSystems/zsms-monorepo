'use client'

/**
 * Pupil fields — what else this school records about a child.
 *
 * Spec: migrations `0110` / `0111`
 *
 * ## Choosing sensitivity is not optional, and the screen explains why
 *
 * Every field has to be marked standard or sensitive before it can be created,
 * because the default that feels harmless is the one that leaks. The wording on
 * the control is about *who will be able to read it* rather than about a
 * category name — an administrator picking "sensitive" from a dropdown should
 * know they are excluding every class teacher, and an administrator picking
 * "standard" should know they are not.
 *
 * ## A key is chosen once; a label is not
 *
 * The key is what a CSV column and any integration match on, so the database
 * refuses to change it. The form therefore shows the key as fixed once created
 * and offers the label as the editable name — rather than offering both and
 * letting the database refuse one.
 *
 * ## Retire, never delete
 *
 * Deleting a definition would cascade away every recorded value. "We no longer
 * collect this" and "this was never true of these children" are different
 * claims, and only the first is what a school means.
 */

import type { FormEvent, JSX } from 'react'
import { use, useCallback, useState } from 'react'
import { LoaderCircle, Plus, ShieldAlert, Tag } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent } from '../../../../../components/ui/card'
import { DataTable } from '../../../../../components/ui/data-table'
import { EmptyState } from '../../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../../components/ui/form'
import { InfoHint } from '../../../../../components/ui/info-hint'
import { useToast } from '../../../../../components/ui/toast'

interface FieldDef {
  id: string
  field_key: string
  label: string
  help_text: string | null
  field_type: string
  options: string[]
  is_required: boolean
  sensitivity: 'standard' | 'sensitive'
  display_order: number
  is_active: boolean
}

interface Payload {
  fields: FieldDef[]
  canManage: boolean
}

const TYPE_LABEL: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes / No',
  select: 'One choice',
  multi_select: 'Several choices',
}

export default function PupilFieldsPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`
  const { toast } = useToast()

  const { data, loading, error, code, reload } = useApi<Payload>('/api/school/custom-fields')

  const [label, setLabel] = useState('')
  const [fieldKey, setFieldKey] = useState('')
  const [fieldType, setFieldType] = useState('text')
  const [options, setOptions] = useState('')
  const [sensitivity, setSensitivity] = useState('standard')
  const [isRequired, setIsRequired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const needsOptions = fieldType === 'select' || fieldType === 'multi_select'

  // Suggested from the label, still editable. The key is permanent, so it is
  // shown rather than hidden — an operator should see what they are fixing.
  const suggestKey = useCallback((text: string) => {
    setLabel(text)
    setFieldKey(
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 39),
    )
  }, [])

  const create = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSaving(true)
      setFormError(null)

      const result = await apiSend('/api/school/custom-fields', 'POST', {
        fieldKey,
        label,
        fieldType,
        sensitivity,
        isRequired,
        options: needsOptions
          ? options
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : undefined,
      })

      setSaving(false)
      if (result.error) {
        setFormError(result.error)
        return
      }

      toast(`"${label}" added to the pupil record.`)
      setLabel('')
      setFieldKey('')
      setOptions('')
      setIsRequired(false)
      reload()
    },
    [fieldKey, label, fieldType, sensitivity, isRequired, needsOptions, options, toast, reload],
  )

  const retire = useCallback(
    async (f: FieldDef) => {
      const result = await apiSend('/api/school/custom-fields', 'PATCH', {
        id: f.id,
        isActive: !f.is_active,
      })
      if (result.error) {
        setFormError(result.error)
        return
      }
      toast(
        f.is_active
          ? `"${f.label}" retired. Answers already recorded are kept.`
          : `"${f.label}" is in use again.`,
      )
      reload()
    },
    [toast, reload],
  )

  return (
    <>
      <PageHeader
        backTo={base}
        backLabel="Dashboard"
        title="Pupil fields"
        description="Extra details this school records about a child, beyond the standard record."
        note="Marking a field sensitive restricts it to you and the head teacher — class teachers and the accountant will not see it, and it cannot be bulk-imported from a spreadsheet. Use it for medical, welfare and safeguarding notes. A field's name for imports is fixed once created; its label can be changed at any time. Retiring a field stops it being collected and keeps every answer already recorded."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={5} columns={4} />}

      {!error && data && (
        <div className="space-y-cards">
          {formError && (
            <Alert variant="danger" title="Not saved">
              {formError}
            </Alert>
          )}

          {data.canManage && (
            <FormSection
              title="Add a field"
              description="It appears on the enrolment form and on every pupil's record."
            >
              <form onSubmit={create} noValidate>
                <FormGrid columns={2}>
                  <Field
                    id="cf-label"
                    label="Field name"
                    required
                    hint="What staff will see — “House”, “Transport route”."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={label}
                        required
                        maxLength={80}
                        onChange={(e) => suggestKey(e.target.value)}
                      />
                    )}
                  </Field>

                  <Field
                    id="cf-key"
                    label="Name for imports"
                    required
                    hint="The spreadsheet column header. Fixed once created."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={fieldKey}
                        required
                        maxLength={39}
                        onChange={(e) => setFieldKey(e.target.value)}
                        className="font-mono"
                      />
                    )}
                  </Field>

                  <Field id="cf-type" label="Kind of answer" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={fieldType}
                        onChange={(e) => setFieldType(e.target.value)}
                      >
                        {Object.entries(TYPE_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field
                    id="cf-sens"
                    label="Who can see it"
                    required
                    hint="Sensitive means you and the head teacher only."
                  >
                    {(props) => (
                      <Select
                        {...props}
                        value={sensitivity}
                        onChange={(e) => setSensitivity(e.target.value)}
                      >
                        <option value="standard">Any member of staff</option>
                        <option value="sensitive">
                          Head teacher and owner only — medical, welfare
                        </option>
                      </Select>
                    )}
                  </Field>

                  {needsOptions && (
                    <Field
                      id="cf-options"
                      label="Choices"
                      required
                      hint="Separate with commas — Red, Blue, Green."
                    >
                      {(props) => (
                        <Input
                          {...props}
                          value={options}
                          required
                          onChange={(e) => setOptions(e.target.value)}
                        />
                      )}
                    </Field>
                  )}

                  <div className="flex items-end">
                    <label className="flex min-h-tap items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isRequired}
                        onChange={(e) => setIsRequired(e.target.checked)}
                        className="size-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      Must be filled in for every pupil
                    </label>
                  </div>
                </FormGrid>

                {sensitivity === 'sensitive' && (
                  <Alert variant="info" title="This will be restricted" className="mt-stack">
                    Only you and the head teacher will be able to read or change it, and it cannot
                    be filled in by a spreadsheet import — medical and welfare details should be
                    entered on the pupil&apos;s record, not emailed around in a file.
                  </Alert>
                )}

                <FormActions>
                  <Button type="submit" disabled={saving || !label || !fieldKey}>
                    {saving ? (
                      <LoaderCircle aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Plus aria-hidden="true" />
                    )}
                    Add field
                  </Button>
                </FormActions>
              </form>
            </FormSection>
          )}

          <Card>
            <CardContent className="p-0">
              <DataTable
                caption="Pupil fields"
                rows={data.fields}
                rowKey={(f) => f.id}
                columns={[
                  {
                    key: 'label',
                    header: 'Field',
                    primary: true,
                    cell: (f) => (
                      <>
                        <span className="font-medium text-foreground">{f.label}</span>
                        <span className="block font-mono text-xs text-subtle">{f.field_key}</span>
                      </>
                    ),
                  },
                  {
                    key: 'type',
                    header: 'Answer',
                    cell: (f) => (
                      <>
                        {TYPE_LABEL[f.field_type] ?? f.field_type}
                        {f.options.length > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {f.options.join(', ')}
                          </span>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'who',
                    header: 'Visible to',
                    cell: (f) =>
                      f.sensitivity === 'sensitive' ? (
                        <Badge variant="warning">
                          <ShieldAlert aria-hidden="true" className="mr-1 size-3" />
                          Head only
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">All staff</span>
                      ),
                  },
                  {
                    key: 'state',
                    header: '',
                    cell: (f) =>
                      data.canManage ? (
                        <Button variant="ghost" size="sm" onClick={() => retire(f)}>
                          {f.is_active ? 'Retire' : 'Use again'}
                        </Button>
                      ) : f.is_active ? (
                        <span className="text-muted-foreground">In use</span>
                      ) : (
                        <Badge variant="neutral">Retired</Badge>
                      ),
                  },
                ]}
                empty={
                  <EmptyState
                    icon={Tag}
                    title="No extra fields yet"
                    description="The standard pupil record covers name, date of birth, grade, class and boarding. Add a field for anything else this school keeps — house, religion, transport route, medical notes."
                  />
                }
              />
            </CardContent>
          </Card>

          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Fields marked for all staff can be filled in by a spreadsheet import.
            <InfoHint label="how importing uses these fields">
              The importer matches a spreadsheet column header against the “name for imports”
              shown above. A column it does not recognise is reported rather than ignored, so a
              misspelled header never silently discards what you typed.
            </InfoHint>
          </p>
        </div>
      )}
    </>
  )
}
