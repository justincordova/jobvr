import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Building2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/page'
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
import { Segmented } from '@/components/ui/segmented'
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
      toast.error(err.message)
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.api.companies[':id'].$delete({ param: { id } })),
    onError: (err) => toast.error(err.message),
    onSettled: invalidate,
  })

  /** Hides the row now; the delete only runs if Undo isn't pressed. */
  const removeWithUndo = async (company: Company) => {
    await qc.cancelQueries({ queryKey: queryKeys.companies })
    const prev = qc.getQueryData<Company[]>(queryKeys.companies) ?? []
    const index = prev.findIndex((c) => c.id === company.id)
    qc.setQueryData<Company[]>(queryKeys.companies, (list) =>
      list?.filter((c) => c.id !== company.id),
    )
    toast.undoable(`Deleted ${company.name}`, {
      undo: () =>
        qc.setQueryData<Company[]>(queryKeys.companies, (list) =>
          !list || list.some((c) => c.id === company.id)
            ? list
            : [...list.slice(0, index), company, ...list.slice(index)],
        ),
      commit: () => remove.mutate(company.id),
    })
  }
  return { patch, removeWithUndo, invalidate }
}

function Health({ c }: { c: Company }) {
  if (c.ats === 'other') return <span className="text-faint">n/a</span>
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
    onSuccess: (c) => {
      invalidate()
      toast(editing ? `${c.name} saved` : `${c.name} added`)
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
          {error && <p className="animate-fade-in text-sm text-stop">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={save.isPending}>
              {editing ? 'Save changes' : 'Add company'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Quick = 'all' | 'polled' | 'review' | 'manual'

function SkeletonTable() {
  return (
    <tbody aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <tr key={i} className="border-b border-line/60" style={{ opacity: 1 - i * 0.1 }}>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </td>
          <td className="px-2 py-3">
            <Skeleton className="h-7 w-24" />
          </td>
          <td className="px-2 py-3">
            <Skeleton className="h-5 w-9 rounded-full" />
          </td>
          <td className="hidden px-2 py-3 md:table-cell">
            <Skeleton className="h-4 w-28" />
          </td>
          <td className="px-2 py-3">
            <Skeleton className="h-4 w-16" />
          </td>
          <td className="hidden px-2 py-3 md:table-cell">
            <Skeleton className="h-4 w-20" />
          </td>
          <td />
        </tr>
      ))}
    </tbody>
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
  const { patch, removeWithUndo } = useCompanyMutations()
  const [filter, setFilter] = useState('')
  const [quick, setQuick] = useState<Quick>('all')
  const [dialog, setDialog] = useState<{ open: boolean; editing: Company | null }>({
    open: false,
    editing: null,
  })
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" jumps to search, like most list UIs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key !== '/' || target.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const atsOptions = (settings.data?.sources ?? []).filter((s) => s.kind === 'ats')
  const atsLabel = (id: string) => atsOptions.find((a) => a.id === id)?.label ?? 'Other'
  const tiersToTrack = settings.data?.settings.tiersToTrack
  const tracked = useMemo(() => new Set(tiersToTrack ?? []), [tiersToTrack])

  const isPolled = (c: Company) =>
    c.track && !trackBlocker(c) && c.status !== 'manual_only' && tracked.has(c.tier)
  const matchesQuick = (c: Company) =>
    quick === 'all' ||
    (quick === 'polled' && isPolled(c)) ||
    (quick === 'review' && c.status === 'needs_review') ||
    (quick === 'manual' && c.status === 'manual_only')

  const all = companies.data ?? []
  const q = filter.trim().toLowerCase()
  const rows = all.filter(
    (c) =>
      matchesQuick(c) &&
      (!q || [c.name, c.city, c.slug, c.ats, c.tier].some((v) => v?.toLowerCase().includes(q))),
  )
  const counts = {
    all: all.length,
    polled: all.filter(isPolled).length,
    review: all.filter((c) => c.status === 'needs_review').length,
    manual: all.filter((c) => c.status === 'manual_only').length,
  }
  const count = (n: number) => (
    <span className="ml-1 font-mono text-[0.7rem] text-faint tabular-nums">{n}</span>
  )

  return (
    <section>
      <PageHeader
        title="Companies"
        description="Your watchlist. Tracked companies in a tracked tier are polled on every run."
        actions={
          <Button variant="primary" onClick={() => setDialog({ open: true, editing: null })}>
            <Plus /> Add
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input
            ref={searchRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('')
                e.currentTarget.blur()
              }
            }}
            placeholder="Search name, city, slug, tier"
            aria-label="Search companies"
            className="pr-9 pl-9"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[0.65rem] text-faint sm:block">
            /
          </kbd>
        </div>
        <Segmented
          label="Show"
          value={quick}
          onChange={setQuick}
          className="scrollbar-none max-w-full overflow-x-auto"
          options={[
            { id: 'all', label: <>All{count(counts.all)}</> },
            { id: 'polled', label: <>Polled{count(counts.polled)}</> },
            { id: 'review', label: <>Needs review{count(counts.review)}</> },
            { id: 'manual', label: <>Manual{count(counts.manual)}</> },
          ]}
        />
      </div>

      {companies.isError ? (
        <ErrorState
          error={companies.error}
          onRetry={() => companies.refetch()}
          retrying={companies.isFetching}
        />
      ) : companies.data && rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={all.length === 0 ? 'No companies yet' : 'No matches'}
          body={
            all.length === 0
              ? 'Add a company to start polling its job board.'
              : q
                ? `Nothing matches “${filter.trim()}”.`
                : 'No companies in this group.'
          }
          action={
            all.length === 0 ? (
              <Button size="sm" onClick={() => setDialog({ open: true, editing: null })}>
                <Plus /> Add company
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setFilter('')
                  setQuick('all')
                }}
              >
                Show all companies
              </Button>
            )
          }
        />
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0 sm:rounded-xl sm:border sm:border-line">
          <table className="w-full min-w-[34rem] text-sm md:min-w-[52rem]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[0.68rem] tracking-wider text-faint uppercase">
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-2 py-2.5 font-medium">Tier</th>
                <th className="px-2 py-2.5 font-medium">Track</th>
                <th className="hidden px-2 py-2.5 font-medium md:table-cell">ATS / slug</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="hidden px-2 py-2.5 font-medium md:table-cell">Last good poll</th>
                <th className="w-10 px-2 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {!companies.data ? (
              <SkeletonTable />
            ) : (
              <tbody>
                {rows.map((c) => {
                  const blocker = trackBlocker(c)
                  const edit = () => setDialog({ open: true, editing: c })
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-line/60 transition-colors duration-150 last:border-0 hover:bg-panel/60"
                    >
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={edit}
                          className="rounded-sm text-left font-medium decoration-signal/60 underline-offset-4 hover:underline"
                        >
                          {c.name}
                        </button>
                        <p className="text-xs text-faint">
                          {[c.city, c.state].filter(Boolean).join(' · ')}
                          <span className="md:hidden">
                            {(c.city || c.state) && ' · '}
                            {atsLabel(c.ats)}
                          </span>
                        </p>
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
                            (tracked.has(c.tier) ? undefined : `${c.tier} isn’t in Tiers to track`)
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
                      <td className="hidden px-2 py-2.5 md:table-cell">
                        <span className="text-dim">{atsLabel(c.ats)}</span>
                        {c.slug && (
                          <span className="ml-1.5 font-mono text-xs text-paper/80">{c.slug}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                      </td>
                      <td className="hidden px-2 py-2.5 font-mono text-xs md:table-cell">
                        <Health c={c} />
                      </td>
                      <td className="px-2 py-2.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Actions for ${c.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={edit}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-stop data-[highlighted]:bg-stop/10"
                              onSelect={() => void removeWithUndo(c)}
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
            )}
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
