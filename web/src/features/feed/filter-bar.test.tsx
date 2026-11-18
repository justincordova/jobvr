import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FilterBar } from './filter-bar'

// The segmented controls measure their thumb; jsdom has no ResizeObserver
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe('FilterBar', () => {
  it('lists ages as All, Today, 1h, 3 days, 1 week', () => {
    render(<FilterBar search={{}} onChange={vi.fn()} onView={vi.fn()} />)
    const ages = within(screen.getByRole('radiogroup', { name: 'Age' })).getAllByRole('radio')
    expect(ages.map((a) => a.textContent)).toEqual(['All', 'Today', '1h', '3 days', '1 week'])
  })

  it('toggles tiers in tier order and clears them', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<FilterBar search={{}} onChange={onChange} onView={vi.fn()} />)
    const tiers = screen.getByRole('group', { name: 'Tiers' })
    await userEvent.click(within(tiers).getByRole('button', { name: 'Unlisted' }))
    expect(onChange).toHaveBeenLastCalledWith({ tier: ['Unlisted'] })

    rerender(<FilterBar search={{ tier: ['Unlisted'] }} onChange={onChange} onView={vi.fn()} />)
    await userEvent.click(within(tiers).getByRole('button', { name: 'Mid' }))
    expect(onChange).toHaveBeenLastCalledWith({ tier: ['Mid', 'Unlisted'] })
    await userEvent.click(screen.getByRole('button', { name: 'Clear tiers' }))
    expect(onChange).toHaveBeenLastCalledWith({ tier: undefined })
  })

  it('has no place, source or company filters', () => {
    render(<FilterBar search={{}} onChange={vi.fn()} onView={vi.fn()} />)
    expect(screen.queryByText('Location')).toBeNull()
    expect(screen.queryByText('Source')).toBeNull()
    expect(screen.queryByLabelText('Company')).toBeNull()
  })
})
