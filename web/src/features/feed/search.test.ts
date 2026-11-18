import { describe, expect, it } from 'vitest'
import {
  defaultSort,
  forgetSearches,
  parseAppliedSearch,
  parseFeedSearch,
  recallSearch,
  rememberSearch,
  toJobQuery,
} from './search'

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
      level: undefined,
      sort: undefined,
      q: undefined,
    })
  })

  it('builds a compact API query', () => {
    expect(toJobQuery({ age: '1h', tier: ['Mid', 'Startup'], source: [] })).toEqual({
      age: '1h',
      tier: 'Mid,Startup',
    })
  })

  it('implies the view on the Applied page and sorts it by applied date', () => {
    expect(parseAppliedSearch({ view: 'hidden', q: 'stripe' }).view).toBeUndefined()
    expect(defaultSort('applied')).toBe('applied')
    expect(defaultSort(undefined)).toBe('best')
    expect(defaultSort('saved')).toBe('newest')
  })

  it('keeps filters per view, so the feed’s tiers never narrow Applied', () => {
    forgetSearches()
    rememberSearch('feed', { tier: ['Mid', 'Startup'], q: 'backend' })
    expect(recallSearch('applied')).toEqual({})
    expect(recallSearch('saved')).toEqual({ view: 'saved' })
    rememberSearch('saved', { view: 'saved', age: '3d' })
    expect(recallSearch('feed')).toEqual({ tier: ['Mid', 'Startup'], q: 'backend' })
    expect(recallSearch('saved')).toEqual({ age: '3d', view: 'saved' })
  })
})
