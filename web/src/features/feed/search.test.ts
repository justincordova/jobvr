import { describe, expect, it } from 'vitest'
import { parseFeedSearch, toJobQuery } from './search'

describe('feed search params', () => {
  it('validates and normalizes', () => {
    expect(
      parseFeedSearch({ view: 'saved', age: 'nope', tier: ['Mid', 'X'], location: 'NYC,PA' }),
    ).toEqual({
      view: 'saved',
      age: undefined,
      location: ['NYC', 'PA'],
      tier: ['Mid'],
      source: undefined,
      company: undefined,
    })
  })

  it('builds a compact API query', () => {
    expect(toJobQuery({ age: '1h', tier: ['Mid', 'Startup'], source: [] })).toEqual({
      age: '1h',
      tier: 'Mid,Startup',
    })
  })
})
