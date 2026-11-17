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
  matchedLocations: ['New York, NY'],
  sources: [
    { source: 'greenhouse', url: '', title: '', category: null, removedAt: null, requiredYears: 0 },
    {
      source: 'simplify',
      url: '',
      title: '',
      category: 'Software',
      removedAt: null,
      requiredYears: null,
    },
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
  it('shows age, salary, tier, sources, and the entry-level badge', () => {
    renderRow(job(), true)
    expect(screen.getByText('2h')).toBeInTheDocument()
    expect(screen.getByText('NEW')).toBeInTheDocument()
    expect(screen.getByText('$120k–$150k')).toBeInTheDocument()
    expect(screen.getByText('Startup')).toBeInTheDocument()
    expect(screen.getByText('Greenhouse · simplify')).toBeInTheDocument()
    expect(screen.getByText('Entry level')).toBeInTheDocument()
    expect(screen.queryByText(/yrs/)).not.toBeInTheDocument()
  })

  it('leads with the matching location and skips the Unlisted tier', () => {
    renderRow(
      job({
        tier: 'Unlisted',
        locations: ['Farmington Hills, MI', 'King of Prussia, PA', 'Houston, TX'],
        matchedLocations: ['King of Prussia, PA'],
      }),
    )
    expect(screen.queryByText('Unlisted')).not.toBeInTheDocument()
    // Phone line shows one place, the desktop column two
    expect(screen.getByText('King of Prussia, PA +2')).toBeInTheDocument()
    expect(screen.getByText('King of Prussia, PA · Farmington Hills, MI +1')).toBeInTheDocument()
  })

  it('shows the experience a description asks for', () => {
    const base = job()
    const [gh, sj] = base.sources
    if (!gh || !sj) throw new Error('fixture')
    renderRow({ ...base, sources: [{ ...gh, requiredYears: 2 }, sj] })
    expect(screen.getByText('2+ yrs')).toBeInTheDocument()
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
