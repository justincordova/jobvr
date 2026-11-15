import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Job } from '@/lib/types'
import { JobRow } from './job-row'

const job = (extra: Partial<Job> = {}): Job => ({
  id: 'gh:1',
  title: 'Software Engineer, New Grad',
  companyId: null,
  companyName: 'Acme',
  tier: 'Startup',
  locations: ['New York, NY'],
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  primarySource: 'greenhouse',
  firstSeenAt: new Date().toISOString(),
  effectiveAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  salaryMinUsd: 120000,
  salaryMaxUsd: 150000,
  state: 'new',
  baseline: false,
  closedAt: null,
  isNew: false,
  entryLevel: true,
  sources: [
    { source: 'greenhouse', url: '', title: '', category: null, removedAt: null },
    { source: 'simplify', url: '', title: '', category: 'Software', removedAt: null },
  ],
  ...extra,
})

const renderRow = (j: Job, highlighted = false) => {
  const onState = vi.fn()
  render(
    <ul>
      <JobRow
        job={j}
        highlighted={highlighted}
        sourceLabel={(id) => (id === 'greenhouse' ? 'Greenhouse' : id)}
        onState={onState}
        busy={false}
      />
    </ul>,
  )
  return { onState }
}

describe('JobRow', () => {
  it('shows age, salary, sources, and the Simplify badge', () => {
    renderRow(job(), true)
    expect(screen.getByText('2h')).toBeInTheDocument()
    expect(screen.getByText('NEW')).toBeInTheDocument()
    expect(screen.getByText('$120k–$150k')).toBeInTheDocument()
    expect(screen.getByText('Greenhouse')).toBeInTheDocument()
    expect(screen.getByText('via SimplifyJobs')).toBeInTheDocument()
    expect(screen.getByText('Entry level')).toBeInTheDocument()
  })

  it('fires Applied, Save, and Hide', async () => {
    const user = userEvent.setup()
    const { onState } = renderRow(job())
    await user.click(screen.getByRole('button', { name: /applied/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))
    await user.click(screen.getByRole('button', { name: /hide/i }))
    expect(onState.mock.calls).toEqual([['applied'], ['saved'], ['hidden']])
  })

  it('offers Unsave', async () => {
    const user = userEvent.setup()
    const saved = renderRow(job({ state: 'saved' }))
    await user.click(screen.getByRole('button', { name: /unsave/i }))
    expect(saved.onState).toHaveBeenCalledWith('new')
  })

  it('marks closed and applied jobs, and can unmark applied', async () => {
    const user = userEvent.setup()
    const { onState } = renderRow(job({ state: 'applied', closedAt: new Date().toISOString() }))
    expect(screen.getByText('Closed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /not applied/i }))
    expect(onState).toHaveBeenCalledWith('new')
  })
})
