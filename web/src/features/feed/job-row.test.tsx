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
  tier: 'C',
  locations: ['New York, NY'],
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  primarySource: 'greenhouse',
  firstSeenAt: new Date().toISOString(),
  effectiveAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  salaryMinUsd: 120000,
  salaryMaxUsd: 150000,
  state: 'new',
  appliedAt: null,
  stage: null,
  baseline: false,
  closedAt: null,
  isNew: false,
  entryLevel: true,
  matchedLocations: ['New York, NY'],
  duplicateIds: [],
  score: 0,
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
  const { unmount } = render(
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
  return { onState, unmount }
}

describe('JobRow', () => {
  it('shows age, salary, tier, sources, and the entry-level badge', () => {
    renderRow(job(), true)
    expect(screen.getByText('2h')).toBeInTheDocument()
    expect(screen.getByText('NEW')).toBeInTheDocument()
    expect(screen.getByText('$120k–$150k')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
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

  it('drops a trailing United States from places', () => {
    renderRow(
      job({
        locations: ['Parsippany, NJ, United States'],
        matchedLocations: ['Parsippany, NJ, United States'],
      }),
    )
    expect(screen.getAllByText('Parsippany, NJ')).toHaveLength(2)
  })

  it('splits places packed into one string', () => {
    renderRow(
      job({
        locations: ['New York, NY | Austin, TX | King of Prussia, PA'],
        matchedLocations: ['New York, NY | Austin, TX | King of Prussia, PA'],
      }),
    )
    expect(screen.getByText('New York, NY · Austin, TX +1')).toBeInTheDocument()
  })

  it('notes reposts of the same role', () => {
    renderRow(job({ duplicateIds: ['gh:2', 'gh:3'] }))
    expect(screen.getByText('· 3 postings')).toBeInTheDocument()
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
    const { onState } = renderRow(
      job({
        state: 'applied',
        appliedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        closedAt: new Date().toISOString(),
      }),
    )
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('Applied 3 d ago')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /not applied/i }))
    expect(onState).toHaveBeenCalledWith('new')
  })

  it('sets an applied job’s stage from its badge', async () => {
    const user = userEvent.setup()
    const onStage = vi.fn()
    render(
      <ul>
        <JobRow
          job={job({ state: 'applied', appliedAt: new Date().toISOString(), stage: null })}
          highlighted={false}
          sourceLabel={(id) => id}
          onState={vi.fn()}
          onStage={onStage}
          busy={false}
        />
      </ul>,
    )
    await user.click(screen.getByRole('button', { name: 'Application status: Waiting' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Interviewing' }))
    expect(onStage).toHaveBeenCalledWith('interviewing')
  })

  it('flags an application still waiting after three weeks, not one with an answer', () => {
    const old = new Date(Date.now() - 22 * 86_400_000).toISOString()
    const { unmount } = renderRow(job({ state: 'applied', appliedAt: old, stage: null }))
    expect(screen.getByText('No reply in 3+ weeks')).toBeInTheDocument()
    unmount()
    renderRow(job({ state: 'applied', appliedAt: old, stage: 'rejected' }))
    expect(screen.queryByText('No reply in 3+ weeks')).not.toBeInTheDocument()
  })
})
