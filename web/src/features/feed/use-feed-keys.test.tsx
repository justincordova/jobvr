import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/lib/types'
import type { View } from './search'
import { useFeedKeys } from './use-feed-keys'

const job = (id: string): Job =>
  ({ id, title: `Role ${id}`, url: `https://x.test/${id}`, state: 'new' }) as Job

/** A bare list: acting on a row removes it, like the feed's optimistic update. */
function Feed({
  onState,
  onView,
  onButton = () => {},
}: {
  onState: (id: string, state: Job['state']) => void
  onView: (view: View) => void
  onButton?: (id: string) => void
}) {
  const [list, setList] = useState(['1', '2', '3'].map(job))
  const { selected, focusRow } = useFeedKeys({
    list,
    onState: (j, state) => {
      onState(j.id, state)
      setList((l) => l.filter((x) => x.id !== j.id))
    },
    onView,
    onHelp: () => {},
  })
  return (
    <ul>
      {list.map((j) => (
        <li key={j.id} data-job-id={j.id} aria-current={selected === j.id || undefined}>
          <a href={j.url} onFocus={() => focusRow(j.id)}>
            {j.title}
          </a>
          <button type="button" onClick={() => onButton(j.id)}>
            Save {j.id}
          </button>
        </li>
      ))}
    </ul>
  )
}

const current = () => document.querySelector('[aria-current="true"] a')?.textContent

// jsdom has no layout
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('feed keyboard triage', () => {
  it('moves with j/k, acts on the selection, then selects the next role', async () => {
    const onState = vi.fn()
    const onView = vi.fn()
    render(<Feed onState={onState} onView={onView} />)
    const user = userEvent.setup()

    await user.keyboard('j')
    expect(current()).toBe('Role 1')
    await user.keyboard('jjk')
    expect(current()).toBe('Role 2')
    expect(document.activeElement).toBe(screen.getByText('Role 2'))

    await user.keyboard('a')
    expect(onState).toHaveBeenCalledWith('2', 'applied')
    // Role 3 slid into place and is selected (and focused) for the next key
    expect(current()).toBe('Role 3')
    await user.keyboard('h')
    expect(onState).toHaveBeenLastCalledWith('3', 'hidden')
    expect(current()).toBe('Role 1')

    await user.keyboard('3')
    expect(onView).toHaveBeenCalledWith('applied')
  })

  it('lets Enter press a focused button instead of opening the posting', async () => {
    const onButton = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<Feed onState={vi.fn()} onView={vi.fn()} onButton={onButton} />)
    const user = userEvent.setup()
    await user.keyboard('j')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('Save 1'))
    await user.keyboard('{Enter}')
    expect(onButton).toHaveBeenCalledWith('1')
    expect(open).not.toHaveBeenCalled()
    // "o" still opens the selected posting from anywhere
    await user.keyboard('o')
    expect(open).toHaveBeenCalledWith('https://x.test/1', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('ignores keys typed into fields and with modifiers', async () => {
    const onState = vi.fn()
    render(
      <>
        <input aria-label="search" />
        <Feed onState={onState} onView={vi.fn()} />
      </>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('search'))
    await user.keyboard('ja')
    expect(current()).toBeUndefined()
    expect(onState).not.toHaveBeenCalled()
  })
})
