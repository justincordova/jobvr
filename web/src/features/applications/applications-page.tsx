import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ExternalLink, KanbanSquare, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { type DragEvent, type FormEvent, useState } from 'react'
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
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import { fromDateInput, shortDate, toDateInput } from '@/lib/format'
import { vtName, withViewTransition } from '@/lib/motion'
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '@/lib/types'

const COLUMN_ACCENT: Record<ApplicationStatus, string> = {
  applied: 'bg-dim',
  oa: 'bg-info',
  interview: 'bg-signal',
  offer: 'bg-go',
  rejected: 'bg-stop',
}

const statusLabel = (s: ApplicationStatus) =>
  APPLICATION_STATUSES.find((x) => x.id === s)?.label ?? s

type ApplicationPatch = {
  id: string
  status?: ApplicationStatus
  notes?: string | null
  appliedAt?: string
}

function useApplicationMutations() {
  const qc = useQueryClient()
  const toast = useToast()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.applications })
    void qc.invalidateQueries({ queryKey: queryKeys.allJobs })
  }
  const setList = (fn: (list: Application[]) => Application[]) =>
    qc.setQueryData<Application[]>(queryKeys.applications, (list) => list && fn(list))

  const update = useMutation({
    mutationFn: ({ id, ...json }: ApplicationPatch & { silent?: boolean }) =>
      unwrap(
        api.api.applications[':id'].$patch({
          param: { id },
          json: { status: json.status, notes: json.notes, appliedAt: json.appliedAt },
        }),
      ),
    onMutate: async ({ id, status, notes, appliedAt }) => {
      const patch = Object.fromEntries(
        Object.entries({ status, notes, appliedAt }).filter(([, v]) => v !== undefined),
      )
      await qc.cancelQueries({ queryKey: queryKeys.applications })
      const prev = qc.getQueryData<Application[]>(queryKeys.applications)
      const before = prev?.find((a) => a.id === id)
      await withViewTransition(() =>
        setList((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a))),
      )
      return { prev, before }
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(queryKeys.applications, ctx?.prev)
      toast.error(err.message)
    },
    onSuccess: (_d, { id, status, silent }, ctx) => {
      const from = ctx?.before?.status
      if (silent || !status || !from || from === status) return
      toast.undoable(`Moved to ${statusLabel(status)}`, {
        undo: () => update.mutate({ id, status: from, silent: true }),
      })
    },
    onSettled: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.api.applications[':id'].$delete({ param: { id } })),
    onError: (err) => toast.error(err.message),
    onSettled: invalidate,
  })

  /** Hides the card now; the delete only runs if Undo isn't pressed. */
  const removeWithUndo = async (app: Application) => {
    await qc.cancelQueries({ queryKey: queryKeys.applications })
    const index = qc.getQueryData<Application[]>(queryKeys.applications)?.indexOf(app) ?? -1
    await withViewTransition(() => setList((list) => list.filter((a) => a.id !== app.id)))
    toast.undoable(`Deleted ${app.companyName} · ${app.title}`, {
      undo: () =>
        void withViewTransition(() =>
          setList((list) =>
            list.some((a) => a.id === app.id)
              ? list
              : index < 0
                ? [...list, app]
                : [...list.slice(0, index), app, ...list.slice(index)],
          ),
        ),
      commit: () => remove.mutate(app.id),
    })
  }

  return { update, removeWithUndo }
}

function ApplicationCard({
  app,
  dragging,
  onDragState,
  onMove,
  onEdit,
  onDelete,
}: {
  app: Application
  dragging: boolean
  onDragState: (dragging: boolean) => void
  onMove: (s: ApplicationStatus) => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/application-id', app.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragState(true)
      }}
      onDragEnd={() => onDragState(false)}
      style={{ viewTransitionName: vtName('app', app.id) }}
      className={cn(
        'group rounded-lg border border-line bg-raised p-3 shadow-sm transition-[border-color,opacity,box-shadow] duration-150 hover:border-line-strong hover:shadow-md md:cursor-grab md:active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 rounded-sm text-left"
          aria-label={`Edit ${app.title} at ${app.companyName}`}
        >
          <p className="text-[0.72rem] font-medium tracking-wide text-dim uppercase">
            {app.companyName}
          </p>
          <p className="mt-0.5 leading-snug font-semibold tracking-tight">{app.title}</p>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="-mt-1 -mr-1 size-7"
              aria-label={`Actions for ${app.title}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {APPLICATION_STATUSES.filter((s) => s.id !== app.status).map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => onMove(s.id)}>
                <span className={cn('mx-1 size-2 rounded-full', COLUMN_ACCENT[s.id])} />
                {s.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit details
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-stop data-[highlighted]:bg-stop/10"
            >
              <Trash2 className="!text-stop" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {app.notes && (
        <p className="mt-2 line-clamp-3 text-sm whitespace-pre-line text-dim">{app.notes}</p>
      )}
      <div className="mt-2.5 flex items-center justify-between font-mono text-[0.7rem] text-faint">
        <span>applied {shortDate(app.appliedAt)}</span>
        {app.url && (
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-signal"
          >
            posting <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </article>
  )
}

function ApplicationDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: Application | null
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const { update } = useApplicationMutations()
  const [error, setError] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: (json: {
      companyName: string
      title: string
      url?: string | null
      status: ApplicationStatus
      appliedAt: string
      notes?: string | null
    }) => unwrap(api.api.applications.$post({ json })),
    onSuccess: (app) => {
      void qc.invalidateQueries({ queryKey: queryKeys.applications })
      toast(`${app.companyName} added to the board`)
      onOpenChange(false)
    },
    onError: (err) => setError(err.message),
  })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const f = new FormData(e.currentTarget)
    const str = (k: string) => String(f.get(k) ?? '').trim()
    const appliedAt = fromDateInput(str('appliedAt'))
    if (editing) {
      update.mutate(
        {
          id: editing.id,
          status: str('status') as ApplicationStatus,
          notes: str('notes') || null,
          appliedAt,
          silent: true,
        },
        {
          onSuccess: () => {
            toast('Changes saved')
            onOpenChange(false)
          },
        },
      )
      return
    }
    create.mutate({
      companyName: str('companyName'),
      title: str('title'),
      url: str('url') || null,
      status: str('status') as ApplicationStatus,
      appliedAt,
      notes: str('notes') || null,
    })
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
        title={editing ? 'Edit application' : 'Add an application'}
        description={
          editing
            ? `${editing.companyName} · ${editing.title}`
            : 'For roles you found outside the feed, like Workday postings.'
        }
      >
        <form key={editing?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          {!editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="companyName">Company</Label>
                <Input id="companyName" name="companyName" required maxLength={200} autoFocus />
              </div>
              <div>
                <Label htmlFor="title">Role</Label>
                <Input id="title" name="title" required maxLength={300} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="url">Posting URL</Label>
                <Input id="url" name="url" type="url" placeholder="https://" />
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="status">Status</Label>
              <NativeSelect id="status" name="status" defaultValue={editing?.status ?? 'applied'}>
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="appliedAt">Applied on</Label>
              <Input
                id="appliedAt"
                name="appliedAt"
                type="date"
                required
                defaultValue={toDateInput(editing?.appliedAt ?? new Date().toISOString())}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={editing?.notes ?? ''}
              maxLength={5000}
              placeholder="Recruiter, referral, next steps…"
              autoFocus={Boolean(editing)}
            />
          </div>
          {error && <p className="animate-fade-in text-sm text-stop">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={create.isPending || update.isPending}>
              {editing ? 'Save changes' : 'Add application'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ApplicationsPage() {
  const apps = useQuery({
    queryKey: queryKeys.applications,
    queryFn: () => unwrap(api.api.applications.$get()),
  })
  const { update, removeWithUndo } = useApplicationMutations()
  const [dialog, setDialog] = useState<{ open: boolean; editing: Application | null }>({
    open: false,
    editing: null,
  })
  const [dropTarget, setDropTarget] = useState<ApplicationStatus | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const onDrop = (status: ApplicationStatus) => (e: DragEvent) => {
    e.preventDefault()
    setDropTarget(null)
    setDraggingId(null)
    const id = e.dataTransfer.getData('text/application-id')
    const app = apps.data?.find((a) => a.id === id)
    if (app && app.status !== status) update.mutate({ id, status })
  }

  const openAdd = () => setDialog({ open: true, editing: null })
  const active = apps.data?.filter((a) => a.status !== 'rejected').length ?? 0

  return (
    <section>
      <PageHeader
        title="Applications"
        meta={
          apps.data &&
          apps.data.length > 0 && (
            <span className="font-mono text-xs text-faint tabular-nums">
              {active} active · {apps.data.length} total
            </span>
          )
        }
        actions={
          <Button variant="primary" onClick={openAdd}>
            <Plus /> Add
          </Button>
        }
      />
      {apps.isError ? (
        <ErrorState error={apps.error} onRetry={() => apps.refetch()} retrying={apps.isFetching} />
      ) : apps.data?.length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="Your board is empty"
          body="Press Applied on a role in the feed, or add one you found elsewhere."
          action={
            <>
              <Button size="sm" asChild>
                <Link to="/">Browse the feed</Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={openAdd}>
                <Plus /> Add manually
              </Button>
            </>
          }
        />
      ) : (
        <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
          {APPLICATION_STATUSES.map((col) => {
            const items = apps.data?.filter((a) => a.status === col.id) ?? []
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropTarget(col.id)
                }}
                onDragLeave={(e) => {
                  // Ignore leave events fired when crossing into a child card
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDropTarget((t) => (t === col.id ? null : t))
                  }
                }}
                onDrop={onDrop(col.id)}
                className={cn(
                  'flex w-[78vw] max-w-xs shrink-0 snap-start flex-col rounded-xl border border-line bg-panel/60 p-2.5 transition-colors duration-150 sm:w-72 lg:w-auto lg:max-w-none',
                  dropTarget === col.id && 'border-signal/60 bg-signal-soft/40',
                )}
              >
                <h2 className="mb-2.5 flex items-center gap-2 px-1 text-sm font-semibold">
                  <span className={cn('size-2 rounded-full', COLUMN_ACCENT[col.id])} />
                  {col.label}
                  <span className="ml-auto font-mono text-xs font-normal text-faint tabular-nums">
                    {items.length}
                  </span>
                </h2>
                <div className="flex flex-col gap-2">
                  {apps.isPending ? (
                    <Skeleton className="h-20 rounded-lg" />
                  ) : items.length === 0 ? (
                    <p
                      className={cn(
                        'rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-faint transition-colors',
                        draggingId && 'border-line-strong text-dim',
                      )}
                    >
                      {draggingId ? 'Drop here' : 'Nothing here'}
                    </p>
                  ) : (
                    items.map((app) => (
                      <ApplicationCard
                        key={app.id}
                        app={app}
                        dragging={draggingId === app.id}
                        onDragState={(d) => setDraggingId(d ? app.id : null)}
                        onMove={(status) => update.mutate({ id: app.id, status })}
                        onEdit={() => setDialog({ open: true, editing: app })}
                        onDelete={() => void removeWithUndo(app)}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ApplicationDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </section>
  )
}
