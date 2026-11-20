import { fireEvent, render, screen, within } from '@testing-library/react'
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

  it('picks tiers from one menu, in tier order, and clears them', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<FilterBar search={{}} onChange={onChange} onView={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Tiers: tracked tiers' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Unlisted' }))
    expect(onChange).toHaveBeenLastCalledWith({ tier: ['Unlisted'] })

    rerender(<FilterBar search={{ tier: ['Unlisted'] }} onChange={onChange} onView={vi.fn()} />)
    // The menu stays open while picking
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'B' }))
    expect(onChange).toHaveBeenLastCalledWith({ tier: ['B', 'Unlisted'] })
    await userEvent.click(screen.getByRole('menuitem', { name: /Clear/ }))
    expect(onChange).toHaveBeenLastCalledWith({ tier: undefined })
  })

  it('names the picked tiers on the button', () => {
    render(
      <FilterBar
        search={{ tier: ['B', 'C', 'D', 'Unlisted'] }}
        onChange={vi.fn()}
        onView={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^Tiers: B, C/ })).toHaveTextContent('B +3')
  })

  it('puts the order toggle before the tiers', () => {
    render(<FilterBar search={{}} onChange={vi.fn()} onView={vi.fn()} />)
    const order = screen.getByRole('radiogroup', { name: 'Order' })
    const tiers = screen.getByRole('button', { name: /^Tiers/ })
    expect(order.compareDocumentPosition(tiers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has no place, source or company filters', () => {
    render(<FilterBar search={{}} onChange={vi.fn()} onView={vi.fn()} />)
    expect(screen.queryByText('Location')).toBeNull()
    expect(screen.queryByText('Source')).toBeNull()
    expect(screen.queryByLabelText('Company')).toBeNull()
  })

  it('drops a pending search when it unmounts', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const { unmount } = render(<FilterBar search={{}} onChange={onChange} onView={vi.fn()} />)
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'stripe' } })
      unmount()
      vi.advanceTimersByTime(500)
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
