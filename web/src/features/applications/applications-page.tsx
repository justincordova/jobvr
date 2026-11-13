import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { type DragEvent, type FormEvent, useState } from 'react'
import { EmptyState, ErrorState, PageHeader } from '@/components/page'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { api, queryKeys, unwrap } from '@/lib/api'
import { cn } from '@/lib/cn'
import { fromDateInput, shortDate, toDateInput } from '@/lib/format'
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '@/lib/types'

const COLUMN_ACCENT: Record<ApplicationStatus, string> = {
  applied: 'bg-dim',
  oa: 'bg-info',
  interview: 'bg-signal',
  offer: 'bg-go',
  rejected: 'bg-stop',
}

function useApplicationMutations() {
  const qc = useQueryClient()
  const toast = useToast()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.applications })
    void qc.invalidateQueries({ queryKey: queryKeys.allJobs })
  }
  const update = useMutation({
    mutationFn: ({
      id,
      ...json
    }: {
      id: string
      status?: ApplicationStatus
      notes?: string | null
      appliedAt?: string
    }) => unwrap(api.api.applications[':id'].$patch({ param: { id }, json })),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.applications })
      const prev = qc.getQueryData<Application[]>(queryKeys.applications)
      qc.setQueryData<Application[]>(queryKeys.applications, (list) =>
        list?.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      )
      return { prev }
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(queryKeys.applications, ctx?.prev)
      toast(err.message, 'error')
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.api.applications[':id'].$delete({ param: { id } })),
    onSuccess: () => toast('Application deleted'),
    onError: (err) => toast(err.message, 'error'),
    onSettled: invalidate,
  })
  return { update, remove }
}

function ApplicationCard({
  app,
  onMove,
  onEdit,
  onDelete,
}: {
  app: Application
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
      }}
      className="group cursor-grab rounded-lg border border-line bg-raised p-3 shadow-sm transition-colors hover:border-line-strong active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 hidden size-3.5 shrink-0 text-faint md:block" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.72rem] font-medium tracking-wide text-dim uppercase">
            {app.companyName}
          </p>
          <p className="mt-0.5 leading-snug font-semibold tracking-tight">{app.title}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="-mt-1 -mr-1 size-7" aria-label="Actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {APPLICATION_STATUSES.filter((s) => s.id !== app.status).map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => onMove(s.id)}>
                <span className={cn('size-2 rounded-full', COLUMN_ACCENT[s.id])} />
                Move to {s.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onEdit}>Edit details</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-stop">
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
            className="inline-flex items-center gap-1 hover:text-signal"
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.applications })
      toast('Application added')
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
        },
        { onSuccess: () => onOpenChange(false) },
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            />
          </div>
          {error && <p className="text-sm text-stop">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>
              {editing ? 'Save' : 'Add application'}
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
  const { update, remove } = useApplicationMutations()
  const [dialog, setDialog] = useState<{ open: boolean; editing: Application | null }>({
    open: false,
    editing: null,
  })
  const [dropTarget, setDropTarget] = useState<ApplicationStatus | null>(null)

  const onDrop = (status: ApplicationStatus) => (e: DragEvent) => {
    e.preventDefault()
    setDropTarget(null)
    const id = e.dataTransfer.getData('text/application-id')
    const app = apps.data?.find((a) => a.id === id)
    if (app && app.status !== status) update.mutate({ id, status })
  }

  const confirmDelete = (app: Application) => {
    const linked = app.jobId ? ' The job goes back to your feed.' : ''
    if (window.confirm(`Delete the application for ${app.title} at ${app.companyName}?${linked}`)) {
      remove.mutate(app.id)
    }
  }

  return (
    <section>
      <PageHeader
        title="Applications"
        meta={
          apps.data && (
            <span className="font-mono text-xs text-faint">{apps.data.length} total</span>
          )
        }
        actions={
          <Button variant="primary" onClick={() => setDialog({ open: true, editing: null })}>
            <Plus /> Add
          </Button>
        }
      />
      {apps.isError ? (
        <ErrorState error={apps.error} onRetry={() => apps.refetch()} />
      ) : apps.data?.length === 0 ? (
        <EmptyState
          title="Your board is empty"
          body="Press Applied on a role in the feed, or add one you found elsewhere."
        />
      ) : (
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:grid lg:grid-cols-5 lg:overflow-visible">
          {APPLICATION_STATUSES.map((col) => {
            const items = apps.data?.filter((a) => a.status === col.id) ?? []
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDropTarget(col.id)
                }}
                onDragLeave={() => setDropTarget((t) => (t === col.id ? null : t))}
                onDrop={onDrop(col.id)}
                className={cn(
                  'flex w-[78vw] max-w-xs shrink-0 snap-start flex-col rounded-xl border border-line bg-panel/60 p-2.5 transition-colors sm:w-72 lg:w-auto lg:max-w-none',
                  dropTarget === col.id && 'border-signal/60 bg-signal-soft/40',
                )}
              >
                <h2 className="mb-2.5 flex items-center gap-2 px-1 text-sm font-semibold">
                  <span className={cn('size-2 rounded-full', COLUMN_ACCENT[col.id])} />
                  {col.label}
                  <span className="ml-auto font-mono text-xs font-normal text-faint">
                    {items.length}
                  </span>
                </h2>
                <div className="flex min-h-24 flex-col gap-2">
                  {apps.isPending ? (
                    <div className="h-20 animate-pulse rounded-lg bg-raised" />
                  ) : (
                    items.map((app) => (
                      <ApplicationCard
                        key={app.id}
                        app={app}
                        onMove={(status) => update.mutate({ id: app.id, status })}
                        onEdit={() => setDialog({ open: true, editing: app })}
                        onDelete={() => confirmDelete(app)}
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
