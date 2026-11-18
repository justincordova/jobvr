import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Job } from '@/lib/types'
import { NewSinceBanner } from './new-banner'

const job = (id: string, title: string, extra: Partial<Job> = {}): Job => ({
  id,
  title,
  companyId: null,
  companyName: 'Twilio',
  tier: 'A',
  locations: ['Remote - US'],
  url: `https://boards.greenhouse.io/twilio/jobs/${id}`,
  primarySource: 'greenhouse',
  firstSeenAt: new Date().toISOString(),
  effectiveAt: new Date(Date.now() - 3_600_000).toISOString(),
  salaryMinUsd: null,
  salaryMaxUsd: null,
  state: 'new',
  appliedAt: null,
  baseline: false,
  closedAt: null,
  isNew: true,
  entryLevel: false,
  matchedLocations: [],
  duplicateIds: [],
  score: 0,
  sources: [],
  ...extra,
})

describe('NewSinceBanner', () => {
  it('lists the new postings and opens one, even when the filters hide it', async () => {
    const onOpen = vi.fn()
    const twilio = job('gh:1', 'Software Engineer, Platform Access')
    render(
      <NewSinceBanner
        count={1}
        jobs={[twilio]}
        inList={new Set()}
        onOpen={onOpen}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('1 new since your last visit')
    expect(screen.getByText('hidden by filters')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Platform Access/ }))
    expect(onOpen).toHaveBeenCalledWith(twilio)
  })

  it('shows three at first and the rest on request', async () => {
    const jobs = ['a', 'b', 'c', 'd', 'e'].map((id) => job(id, `Role ${id}`))
    render(
      <NewSinceBanner
        count={5}
        jobs={jobs}
        inList={new Set(['a'])}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.queryByText('Role d')).toBeNull()
    expect(screen.getAllByText('hidden by filters')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Show all 5' }))
    expect(screen.getByText('Role e')).toBeInTheDocument()
  })
})
