import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ChipsInput } from './chips-input'

function Harness({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial)
  return <ChipsInput label="Keywords" value={value} onChange={setValue} />
}

describe('ChipsInput', () => {
  it('adds on Enter and comma, skipping repeats', async () => {
    render(<Harness initial={['swe']} />)
    await userEvent.type(screen.getByLabelText('Keywords'), 'sde, SWE{Enter}')
    expect(screen.getByRole('button', { name: 'Remove sde' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(2)
  })

  it('needs two Backspaces to remove the last chip, and another key disarms it', async () => {
    render(<Harness initial={['a', 'b']} />)
    const input = screen.getByLabelText('Keywords')
    await userEvent.type(input, '{Backspace}')
    expect(screen.getByText('Press Backspace again to remove b')).toBeInTheDocument()
    await userEvent.type(input, '{ArrowLeft}{Backspace}')
    expect(screen.getByRole('button', { name: 'Remove b' })).toBeInTheDocument()
    await userEvent.type(input, '{Backspace}')
    expect(screen.queryByRole('button', { name: 'Remove b' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove a' })).toBeInTheDocument()
  })
})
