'use client'

/**
 * Unit economics — what each school actually consumes.
 *
 * Spec: `03 Infrastructure Services/COST_MANAGEMENT.md`
 *
 * ## Why there is no money on this page
 *
 * COST_MANAGEMENT.md lists nine billed services and ZSMS can read none of them. A
 * kwacha figure here would be invented, and somebody would eventually price a tier off
 * it. So the page reports consumption and says plainly which bills it cannot see.
 *
 * What it is for: noticing that a 40-pupil school sends 2,000 messages a month while a
 * 900-pupil school sends 50. No invoice from Vercel will tell you that, and it is the
 * thing that decides whether a tier is priced right.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Coins, Info, Users } from 'lucide-react'

import { Card } from '../../../components/ui/card'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { StatCard } from '../../../components/ui/stat-card'

interface School {
  id: string
  name: string
  code: string
  status: string
  tier: string
  pupils: number
  staff: number
  aiCreditsSpent: number
  messagesUsed: number
  messageQuota: number | null
  documents: number
  writes: number
}

interface Payload {
  days: number
  schools: School[]
  totals: {
    schools: number
    pupils: number
    staff: number
    aiCreditsSpent: number
    messagesUsed: number
    documents: number
  }
  externalServices: string[]
}

export default function CostsPage(): JSX.Element {
  const [data, setData] = useState<Payload | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (window: number) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/costs?days=${window}`)
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load cost drivers.')
        return
      }
      setError(null)
      setData(body.data)
    } catch {
      setError('Could not reach ZSMS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [load, days])

  if (loading && !data) {
    return <div className="p-card text-muted-foreground">Loading cost drivers…</div>
  }

  if (error) {
    return (
      <Card className="p-card">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" className="mt-stack" onClick={() => void load(days)}>
          Try again
        </Button>
      </Card>
    )
  }

  const d = data!

  /*
    Per pupil, because that is the comparison that matters. Absolute numbers just
    rank schools by size, which you already know.
  */
  const perPupil = (value: number, pupils: number): string =>
    pupils === 0 ? '—' : (value / pupils).toFixed(1)

  return (
    <div className="space-y-stack">
      <header className="flex flex-wrap items-start justify-between gap-stack">
        <div>
          <h1 className="text-2xl font-semibold">Unit economics</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What each school consumes, over the last{' '}
            <span data-numeric>{d.days}</span> days.
          </p>
        </div>

        <div className="flex gap-1">
          {[7, 30, 90].map((w) => (
            <Button
              key={w}
              size="sm"
              variant={days === w ? 'default' : 'outline'}
              onClick={() => setDays(w)}
            >
              {w}d
            </Button>
          ))}
        </div>
      </header>

      <Card className="border-border bg-muted/30 p-card">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {/*
              Stated rather than implied. A page headed "costs" with no money on it
              should explain itself before somebody concludes the bills are zero.
            */}
            <span className="font-medium text-foreground">
              These are consumption figures, not bills.
            </span>{' '}
            ZSMS cannot read invoices from {d.externalServices.join(', ')} — those are
            separate accounts. What is here is what drives those bills, which is what you
            need before setting any threshold.
          </span>
        </p>
      </Card>

      <div className="grid gap-stack sm:grid-cols-2 lg:grid-cols-4">
        {/*
          `StatCard` takes a formatted string, not a number — it leaves presentation to
          the caller, so thousands separators are applied here.
        */}
        <StatCard label="Schools" value={d.totals.schools.toLocaleString()} />
        <StatCard label="Pupils" value={d.totals.pupils.toLocaleString()} />
        <StatCard label="AI credits spent" value={d.totals.aiCreditsSpent.toLocaleString()} />
        <StatCard label="Messages sent" value={d.totals.messagesUsed.toLocaleString()} />
      </div>

      <Card className="p-card">
        <h2 className="flex items-center gap-2 font-medium">
          <Coins className="h-4 w-4" />
          By school
        </h2>

        {d.schools.length === 0 ? (
          <p className="mt-stack text-sm text-muted-foreground">No schools yet.</p>
        ) : (
          <div className="mt-stack overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-4 font-medium">School</th>
                  <th className="px-2 pb-2 text-right font-medium">Pupils</th>
                  <th className="px-2 pb-2 text-right font-medium">Staff</th>
                  <th className="px-2 pb-2 text-right font-medium">AI credits</th>
                  <th className="px-2 pb-2 text-right font-medium">Messages</th>
                  <th className="px-2 pb-2 text-right font-medium">Docs</th>
                  <th className="px-2 pb-2 text-right font-medium">Writes</th>
                  <th className="px-2 pb-2 text-right font-medium">Msg/pupil</th>
                </tr>
              </thead>
              <tbody>
                {d.schools.map((s) => (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <span className="block font-medium">{s.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span data-numeric>{s.code}</span>
                        <Badge variant="neutral">{s.tier}</Badge>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right" data-numeric>{s.pupils}</td>
                    <td className="px-2 py-2 text-right" data-numeric>{s.staff}</td>
                    <td className="px-2 py-2 text-right" data-numeric>{s.aiCreditsSpent}</td>
                    <td className="px-2 py-2 text-right" data-numeric>
                      {s.messagesUsed}
                      {s.messageQuota ? (
                        <span className="text-muted-foreground">/{s.messageQuota}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right" data-numeric>{s.documents}</td>
                    <td className="px-2 py-2 text-right" data-numeric>{s.writes}</td>
                    {/*
                      The one derived column, because it is the one that finds the
                      outlier a list of totals hides.
                    */}
                    <td className="px-2 py-2 text-right font-medium" data-numeric>
                      {perPupil(s.messagesUsed, s.pupils)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-stack flex items-start gap-2 text-xs text-muted-foreground">
          <Users className="mt-0.5 h-3 w-3 shrink-0" />
          &ldquo;Writes&rdquo; counts audited changes, not requests — reads are not
          audited, so it understates real traffic considerably. It is useful for
          comparing schools with each other, not for predicting a hosting bill.
        </p>
      </Card>
    </div>
  )
}
