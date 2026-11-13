import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { EmptyState, ErrorState, PageHeader } from '@/components/page'
import { useToast } from '@/components/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api, queryKeys, unwrap } from '@/lib/api'
import { relative } from '@/lib/format'
import { type Company, TIERS, type Tier } from '@/lib/types'

type Status = Company['status']
type CompanyPatch = Partial<{
  name: string
  city: string | null
  state: string | null
  tier: Tier
  track: boolean
  ats: string
  slug: string | null
  careersUrl: string | null
  notes: string | null
  status: Status
}>

const STATUS_TONE = { ok: 'go', needs_review: 'signal', manual_only: 'neutral' } as const
const STATUS_LABEL: Record<Status, string> = {
  ok: 'ok',
  needs_review: 'needs review',
  manual_only: 'manual only',
}

/** Why a company can't be tracked, or null when it can. */
const trackBlocker = (c: Pick<Company, 'ats' | 'slug' | 'status'>) =>
  c.ats === 'other'
    ? 'Unsupported ATS: check this company manually'
    : !c.slug
      ? 'Add a slug to track this company'
      : null

function useCompanyMutations() {
  const qc = useQueryClient()
  const toast = useToast()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.companies })
    void qc.invalidateQueries({ queryKey: queryKeys.allJobs })
    void qc.invalidateQueries({ queryKey: queryKeys.suggestions })
  }
  const patch = useMutation({
    mutationFn: ({ id, json }: { id: string; json: CompanyPatch }) =>
      unwrap(api.api.companies[':id'].$patch({ param: { id }, json })),
    onMutate: async ({ id, json }) => {
      await qc.cancelQueries({ queryKey: queryKeys.companies })
      const prev = qc.getQueryData<Company[]>(queryKeys.companies)
      qc.setQueryData<Company[]>(queryKeys.companies, (list) =>
        list?.map((c) => (c.id === id ? { ...c, ...json } : c)),
      )
      return { prev }
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(queryKeys.companies, ctx?.prev)
      toast(err.message, 'error')
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.api.companies[':id'].$delete({ param: { id } })),
    onSuccess: () => toast('Company deleted'),
    onError: (err) => toast(err.message, 'error'),
    onSettled: invalidate,
  })
  return { patch, remove, invalidate }
}

function Health({ c }: { c: Company }) {
  if (c.ats === 'other') return <span className="text-faint">—</span>
  if (!c.health) return <span className="text-faint">not polled yet</span>
  const failing = c.health.consecutiveFailures > 0
  return (
    <span className="inline-flex items-center gap-1.5" title={c.health.lastError ?? undefined}>
      {failing && <AlertTriangle className="size-3.5 text-stop" />}
      <span className={failing ? 'text-stop' : 'text-dim'}>
        {relative(c.health.lastSuccessAt)}
        {failing && ` · ${c.health.consecutiveFailures} failed`}
      </span>
    </span>
  )
}

function CompanyDialog({
  open,
  onOpenChange,
  editing,
  atsOptions,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: Company | null
  atsOptions: { id: string; label: string }[]
}) {
  const toast = useToast()
  const { invalidate } = useCompanyMutations()
  const [error, setError] = useState<string | null>(null)
  const [ats, setAts] = useState(editing?.ats ?? atsOptions[0]?.id ?? 'other')

  const save = useMutation({
    mutationFn: (json: CompanyPatch & { name: string; tier: Tier; ats: string }) =>
      editing
        ? unwrap(api.api.companies[':id'].$patch({ param: { id: editing.id }, json }))
        : unwrap(api.api.companies.$post({ json })),
    onSuccess: () => {
      invalidate()
      toast(editing ? 'Company saved' : 'Company added')
      onOpenChange(false)
    },
    onError: (err) => setError(err.message),
  })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const f = new FormData(e.currentTarget)
    const str = (k: string) => String(f.get(k) ?? '').trim()
    const other = ats === 'other'
    const slug = other ? null : str('slug') || null
    const status = (str('status') || undefined) as Status | undefined
    save.mutate({
      name: str('name'),
      city: str('city') || null,
      state: str('state') || null,
      tier: str('tier') as Tier,
      ats,
      slug,
      careersUrl: str('careersUrl') || null,
      notes: str('notes') || null,
      ...(other ? { status: 'manual_only', track: false } : status ? { status } : {}),
      ...(!other && !slug ? { track: false } : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? `Edit ${editing.name}` : 'Add a company'}
        description="Changing the ATS or slug resets polling: the next poll is a silent baseline."
      >
        <form key={editing?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required defaultValue={editing?.name} autoFocus />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" defaultValue={editing?.city ?? ''} placeholder="NYC" />
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" defaultValue={editing?.state ?? ''} placeholder="NY" />
            </div>
            <div>
              <Label htmlFor="tier">Tier</Label>
              <NativeSelect id="tier" name="tier" defaultValue={editing?.tier ?? 'Startup'}>
                {TIERS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="ats">ATS</Label>
              <NativeSelect id="ats" value={ats} onChange={(e) => setAts(e.target.value)}>
                {atsOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
                <option value="other">Other (manual only)</option>
              </NativeSelect>
            </div>
            {ats !== 'other' && (
              <div>
                <Label htmlFor="slug">Board slug</Label>
                <Input
                  id="slug"
                  name="slug"
                  defaultValue={editing?.slug ?? ''}
                  placeholder="exact case, e.g. BlueMatrix"
                  className="font-mono"
                />
              </div>
            )}
            {ats !== 'other' && editing && (
              <div>
                <Label htmlFor="status">Status</Label>
                <NativeSelect id="status" name="status" defaultValue={editing.status}>
                  <option value="ok">ok</option>
                  <option value="needs_review">needs review</option>
                  <option value="manual_only">manual only</option>
                </NativeSelect>
              </div>
            )}
            <div className="sm:col-span-2">
              <Label htmlFor="careersUrl">Careers page</Label>
              <Input
                id="careersUrl"
                name="careersUrl"
                type="url"
                defaultValue={editing?.careersUrl ?? ''}
                placeholder="https://"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={editing?.notes ?? ''} />
            </div>
          </div>
          {error && <p className="text-sm text-stop">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {editing ? 'Save' : 'Add company'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CompaniesPage() {
  const companies = useQuery({
    queryKey: queryKeys.companies,
    queryFn: () => unwrap(api.api.companies.$get()),
  })
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
  })
  const { patch, remove } = useCompanyMutations()
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<{ open: boolean; editing: Company | null }>({
    open: false,
    editing: null,
  })

  const atsOptions = (settings.data?.sources ?? []).filter((s) => s.kind === 'ats')
  const atsLabel = (id: string) => atsOptions.find((a) => a.id === id)?.label ?? 'Other'
  const tiersToTrack = settings.data?.settings.tiersToTrack
  const tracked = useMemo(() => new Set(tiersToTrack ?? []), [tiersToTrack])

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const all = companies.data ?? []
    return q
      ? all.filter((c) =>
          [c.name, c.city, c.slug, c.ats, c.tier].some((v) => v?.toLowerCase().includes(q)),
        )
      : all
  }, [companies.data, filter])

  const counts = useMemo(() => {
    const all = companies.data ?? []
    return {
      polled: all.filter(
        (c) => c.track && !trackBlocker(c) && c.status !== 'manual_only' && tracked.has(c.tier),
      ).length,
      review: all.filter((c) => c.status === 'needs_review').length,
    }
  }, [companies.data, tracked])

  return (
    <section>
      <PageHeader
        title="Companies"
        meta={
          companies.data && (
            <span className="font-mono text-xs text-faint">
              {counts.polled} polled · {counts.review} need review
            </span>
          )
        }
        actions={
          <Button variant="primary" onClick={() => setDialog({ open: true, editing: null })}>
            <Plus /> Add
          </Button>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search name, city, slug, tier"
          aria-label="Search companies"
          className="pl-9"
        />
      </div>

      {companies.isError ? (
        <ErrorState error={companies.error} onRetry={() => companies.refetch()} />
      ) : companies.data && rows.length === 0 ? (
        <EmptyState
          title={filter ? 'No matches' : 'No companies yet'}
          body={filter ? 'Try a different search.' : 'Add companies here or run `pnpm seed`.'}
        />
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0 sm:rounded-xl sm:border sm:border-line">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[0.68rem] tracking-wider text-faint uppercase">
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-2 py-2.5 font-medium">Tier</th>
                <th className="px-2 py-2.5 font-medium">Track</th>
                <th className="px-2 py-2.5 font-medium">ATS / slug</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="px-2 py-2.5 font-medium">Last good poll</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const blocker = trackBlocker(c)
                return (
                  <tr
                    key={c.id}
                    className="border-b border-line/60 last:border-0 hover:bg-panel/60"
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{c.name}</p>
                      {(c.city || c.state) && (
                        <p className="text-xs text-faint">
                          {[c.city, c.state].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <NativeSelect
                        aria-label={`Tier for ${c.name}`}
                        value={c.tier}
                        onChange={(e) =>
                          patch.mutate({ id: c.id, json: { tier: e.target.value as Tier } })
                        }
                        className="h-8 w-[7.5rem] py-1 text-xs"
                      >
                        {TIERS.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </NativeSelect>
                    </td>
                    <td className="px-2 py-2.5">
                      <span
                        title={
                          blocker ??
                          (tracked.has(c.tier) ? undefined : `${c.tier} isn't in Tiers to track`)
                        }
                      >
                        <Switch
                          aria-label={`Track ${c.name}`}
                          checked={c.track}
                          disabled={Boolean(blocker)}
                          onCheckedChange={(track) => patch.mutate({ id: c.id, json: { track } })}
                        />
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="text-dim">{atsLabel(c.ats)}</span>
                      {c.slug && (
                        <span className="ml-1.5 font-mono text-xs text-paper/80">{c.slug}</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-xs">
                      <Health c={c} />
                    </td>
                    <td className="px-2 py-2.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" aria-label={`Actions for ${c.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setDialog({ open: true, editing: c })}>
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-stop"
                            onSelect={() => {
                              if (
                                window.confirm(
                                  `Delete ${c.name}? Its jobs stay, without a company.`,
                                )
                              ) {
                                remove.mutate(c.id)
                              }
                            }}
                          >
                            <Trash2 className="!text-stop" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CompanyDialog
        key={dialog.editing?.id ?? 'new'}
        open={dialog.open}
        editing={dialog.editing}
        atsOptions={atsOptions}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </section>
  )
}
