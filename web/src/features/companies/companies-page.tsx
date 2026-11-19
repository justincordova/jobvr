import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Check,
  ExternalLink,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/page'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import { companiesQuery, pendingDeletes } from '@/lib/companies-query'
import { safeHref, shortAge } from '@/lib/format'
import { TIER_BADGE } from '@/lib/tier-style'
import { type Company, TIERS, type Tier } from '@/lib/types'

type CompanyPatch = { tier: Tier } | { autoTier: true }

/** How jobvr keeps up with a company, in plain words. */
type Watch = 'direct' | 'lists' | 'trouble' | 'paused'

const watchOf = (c: Company, trackedTiers: ReadonlySet<string>): Watch =>
  c.status === 'needs_review' || (c.health?.consecutiveFailures ?? 0) > 0
    ? 'trouble'
    : c.status === 'manual_only' || c.ats === 'other' || !c.slug || !c.track
      ? 'lists'
      : trackedTiers.has(c.tier)
        ? 'direct'
        : 'paused'

const WATCH: Record<Watch, { label: string; dot: string; hint: (c: Company) => string }> = {
  direct: {
    label: 'Checked directly',
    dot: 'bg-go',
    hint: () => 'Its job board is checked on every poll.',
  },
  lists: {
    label: 'Via job lists',
    dot: 'bg-dim',
    hint: () =>
      "jobvr can't read its careers site, so its jobs come from the new-grad lists (SimplifyJobs and others).",
  },
  trouble: {
    label: 'Having trouble',
    dot: 'bg-signal',
    hint: (c) =>
      `Its job board stopped answering${c.health?.lastError ? ` (${c.health.lastError})` : ''}. jobvr is looking for a new one; after 3 days it falls back to the job lists.`,
  },
  paused: {
    label: 'Paused',
    dot: 'bg-line-strong',
    hint: (c) => `${c.tier} isn’t in Tiers to track (Settings), so it isn’t checked.`,
  },
}

const tierHint = (c: Company, model: string | null | undefined) =>
  c.tierSource === 'auto'
    ? `Rated by AI: ${c.tierReason ?? ''}`
    : c.tierSource === 'manual'
      ? 'Picked by you'
      : c.tierSource === 'seed'
        ? 'From the starter list'
        : model
          ? 'Not rated yet: it will be within a few minutes'
          : 'Not rated: set OPENAI_API_KEY to rate new companies automatically'

function useCompanyMutations() {
  const qc = useQueryClient()
  const toast = useToast()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.companies })
    void qc.invalidateQueries({ queryKey: queryKeys.allJobs })
  }
  const patch = useMutation({
    mutationFn: ({ id, json }: { id: string; json: CompanyPatch }) =>
      unwrap(api.api.companies[':id'].$patch({ param: { id }, json })),
    onMutate: async ({ id, json }) => {
      await qc.cancelQueries({ queryKey: queryKeys.companies })
      const prev = qc.getQueryData<Company[]>(queryKeys.companies)
      if ('tier' in json) {
        qc.setQueryData<Company[]>(queryKeys.companies, (list) =>
          list?.map((c) =>
            c.id === id ? { ...c, tier: json.tier, tierSource: 'manual', tierReason: null } : c,
          ),
        )
      }
      return { prev }
    },
    onSuccess: (company, { json }) =>
      toast(
        'tier' in json
          ? `${company.name} is now ${company.tier}`
          : company.tierSource === 'auto'
            ? `${company.name}: rated ${company.tier} by AI`
            : `${company.name} will be rated shortly`,
      ),
    onError: (err, _v, ctx) => {
      qc.setQueryData(queryKeys.companies, ctx?.prev)
      toast.error(err.message)
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.api.companies[':id'].$delete({ param: { id } })),
    onError: (err) => toast.error(err.message),
    onSettled: (_d, _e, id) => {
      pendingDeletes.delete(id)
      invalidate()
    },
  })

  /** Hides the row now; the delete only runs if Undo isn't pressed. */
  const removeWithUndo = async (company: Company) => {
    await qc.cancelQueries({ queryKey: queryKeys.companies })
    const prev = qc.getQueryData<Company[]>(queryKeys.companies) ?? []
    const index = prev.findIndex((c) => c.id === company.id)
    pendingDeletes.add(company.id)
    qc.setQueryData<Company[]>(queryKeys.companies, (list) =>
      list?.filter((c) => c.id !== company.id),
    )
    toast.undoable(`Removed ${company.name}`, {
      undo: () => {
        pendingDeletes.delete(company.id)
        qc.setQueryData<Company[]>(queryKeys.companies, (list) =>
          !list || list.some((c) => c.id === company.id)
            ? list
            : [...list.slice(0, index), company, ...list.slice(index)],
        )
      },
      commit: () => remove.mutate(company.id),
    })
  }
  return { patch, removeWithUndo, invalidate }
}

/** One field: a careers link or a name. jobvr finds the board and rates the tier. */
function AddDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast()
  const { invalidate } = useCompanyMutations()
  const [error, setError] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: (query: string) => unwrap(api.api.companies.add.$post({ json: { query } })),
    onSuccess: (c) => {
      invalidate()
      toast(
        c.ats === 'other'
          ? `${c.name} added: no job board found, so its jobs come from the job lists`
          : `${c.name} added`,
      )
      setError(null)
      onOpenChange(false)
    },
    onError: (err) => setError(err.message),
  })
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    add.mutate(String(new FormData(e.currentTarget).get('query') ?? '').trim())
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
    >
      <DialogContent
        title="Add a company"
        description="Paste its careers page or type its name. jobvr finds its job board and rates its tier."
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            name="query"
            required
            autoFocus
            autoComplete="off"
            aria-label="Careers link or company name"
            placeholder="https://jobs.lever.co/acme or Acme"
          />
          {error && <p className="animate-fade-in text-sm text-stop">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            {add.isPending && (
              <span className="mr-auto animate-fade-in text-sm text-dim">
                Looking for its job board…
              </span>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={add.isPending}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SkeletonTable() {
  return (
    <tbody aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <tr key={i} className="border-b border-line/60" style={{ opacity: 1 - i * 0.1 }}>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </td>
          <td className="px-2 py-3">
            <Skeleton className="h-5 w-16" />
          </td>
          <td className="hidden px-2 py-3 sm:table-cell">
            <Skeleton className="h-4 w-10" />
          </td>
          <td className="hidden px-2 py-3 sm:table-cell">
            <Skeleton className="h-4 w-12" />
          </td>
          <td className="px-2 py-3">
            <Skeleton className="h-4 w-24" />
          </td>
          <td />
        </tr>
      ))}
    </tbody>
  )
}

function RowMenu({
  c,
  onTier,
  onAuto,
  onRemove,
}: {
  c: Company
  onTier: (t: Tier) => void
  onAuto: () => void
  onRemove: () => void
}) {
  const careers = c.careersUrl ? safeHref(c.careersUrl) : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Options for ${c.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-48">
        <DropdownMenuLabel>Tier</DropdownMenuLabel>
        {TIERS.map((t) => (
          <DropdownMenuItem key={t} onSelect={() => t !== c.tier && onTier(t)}>
            <Check className={cn(t === c.tier ? 'opacity-100' : 'opacity-0')} /> {t}
          </DropdownMenuItem>
        ))}
        {c.tierSource === 'manual' && (
          <DropdownMenuItem onSelect={onAuto}>
            <Sparkles /> Let jobvr rate it
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {careers && (
          <DropdownMenuItem asChild>
            <a href={careers} target="_blank" rel="noreferrer">
              <ExternalLink /> Careers page
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="text-stop data-[highlighted]:bg-stop/10" onSelect={onRemove}>
          <Trash2 className="!text-stop" /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CompaniesPage() {
  const companies = useQuery(companiesQuery)
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.api.settings.$get()),
  })
  const { patch, removeWithUndo } = useCompanyMutations()
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
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

  const tiersToTrack = settings.data?.settings.tiersToTrack
  const tracked = useMemo(() => new Set<string>(tiersToTrack ?? []), [tiersToTrack])
  const model = settings.data?.tierModel

  const all = companies.data ?? []
  const q = filter.trim().toLowerCase()
  const rows = all.filter(
    (c) => !q || [c.name, c.city, c.tier].some((v) => v?.toLowerCase().includes(q)),
  )

  return (
    <section>
      <PageHeader
        title="Companies"
        description={
          companies.data
            ? `${all.length} companies. New ones are found and rated automatically.`
            : 'New companies are found and rated automatically.'
        }
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus /> Add
          </Button>
        }
      />

      <div className="relative mb-4 w-full sm:w-72">
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
          placeholder="Search companies"
          aria-label="Search companies"
          className="pr-9 pl-9"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[0.65rem] text-faint pointer-fine:block">
          /
        </kbd>
      </div>
      {/* Phones show only the status dots, so say what they mean */}
      <ul className="-mt-1 mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint sm:hidden">
        {Object.values(WATCH).map((w) => (
          <li key={w.label} className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', w.dot)} />
            {w.label}
          </li>
        ))}
      </ul>

      {companies.isError && !companies.data ? (
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
              ? 'Companies show up here as jobvr finds them on the new-grad lists.'
              : `Nothing matches “${filter.trim()}”.`
          }
          action={
            all.length === 0 ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus /> Add company
              </Button>
            ) : (
              <Button size="sm" onClick={() => setFilter('')}>
                Show all companies
              </Button>
            )
          }
        />
      ) : (
        <div className="relative -mx-4 overflow-x-auto sm:mx-0 sm:rounded-xl sm:border sm:border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[0.68rem] tracking-wider text-faint uppercase">
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="w-px px-2 py-2.5 font-medium">Tier</th>
                <th
                  className="hidden px-2 py-2.5 font-medium sm:table-cell"
                  title="Matching roles in the last 30 days"
                >
                  Roles · 30d
                </th>
                <th className="hidden px-2 py-2.5 font-medium sm:table-cell">Newest</th>
                <th className="w-px px-2 py-2.5 font-medium sm:w-auto">
                  <span className="sr-only sm:not-sr-only">Status</span>
                </th>
                <th className="w-10 px-2 py-2.5">
                  <span className="sr-only">Options</span>
                </th>
              </tr>
            </thead>
            {!companies.data ? (
              <SkeletonTable />
            ) : (
              <tbody>
                {rows.map((c) => {
                  const watch = WATCH[watchOf(c, tracked)]
                  const place = [c.city, c.state].filter(Boolean).join(' · ')
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-line/60 transition-colors duration-150 last:border-0 hover:bg-panel/60"
                    >
                      <td className="max-w-0 px-4 py-2.5 sm:w-[45%]">
                        <p className="font-medium break-words max-sm:line-clamp-2 sm:truncate">
                          {c.name}
                        </p>
                        {(c.tierReason || place) && (
                          <p className="truncate text-xs text-faint">{c.tierReason ?? place}</p>
                        )}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span
                          title={tierHint(c, model)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ring-1 transition-colors duration-300',
                            c.tierSource === 'pending'
                              ? 'bg-raised text-faint ring-line'
                              : TIER_BADGE[c.tier],
                          )}
                        >
                          {c.tier}
                          {c.tierSource === 'auto' && (
                            <Sparkles aria-label="rated by AI" className="size-3 opacity-60" />
                          )}
                          {c.tierSource === 'pending' && <span aria-label="not rated yet">?</span>}
                        </span>
                      </td>
                      <td className="hidden px-2 py-2.5 font-mono text-xs tabular-nums sm:table-cell">
                        <span className={c.stats.roles30d > 0 ? 'text-paper' : 'text-faint'}>
                          {c.stats.roles30d}
                        </span>
                      </td>
                      <td className="hidden px-2 py-2.5 font-mono text-xs text-faint sm:table-cell">
                        {c.stats.lastRoleAt ? shortAge(c.stats.lastRoleAt) : '—'}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span
                          title={watch.hint(c)}
                          className="inline-flex items-center gap-2 text-xs text-dim"
                        >
                          <span className={cn('size-2 shrink-0 rounded-full', watch.dot)} />
                          <span className="sr-only sm:not-sr-only">{watch.label}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <RowMenu
                          c={c}
                          onTier={(tier) => patch.mutate({ id: c.id, json: { tier } })}
                          onAuto={() => patch.mutate({ id: c.id, json: { autoTier: true } })}
                          onRemove={() => void removeWithUndo(c)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            )}
          </table>
        </div>
      )}

      <AddDialog open={adding} onOpenChange={setAdding} />
    </section>
  )
}
