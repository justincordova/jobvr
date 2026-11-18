import { describe, expect, it } from 'vitest'
import {
  defaultSort,
  forgetSearches,
  isBlankSearch,
  parseAppliedSearch,
  parseFeedSearch,
  recallSearch,
  rememberSearch,
  toJobQuery,
} from './search'

describe('feed search params', () => {
  it('validates and normalizes, dropping the old place, source and company filters', () => {
    expect(
      parseFeedSearch({ view: 'saved', age: 'nope', tier: ['Mid', 'X'], location: 'NYC,PA' }),
    ).toEqual({
      view: 'saved',
      age: undefined,
      tier: ['Mid'],
      sort: undefined,
      q: undefined,
    })
    expect(parseFeedSearch({ age: '1w' }).age).toBe('1w')
  })

  it('builds a compact API query', () => {
    expect(toJobQuery({ age: '1h', tier: ['Mid', 'Startup'] })).toEqual({
      age: '1h',
      tier: 'Mid,Startup',
    })
    expect(toJobQuery({ tier: [] })).toEqual({})
  })

  it('implies the view on the Applied page and sorts it by applied date', () => {
    expect(parseAppliedSearch({ view: 'hidden', q: 'stripe' }).view).toBeUndefined()
    expect(defaultSort('applied')).toBe('applied')
    expect(defaultSort(undefined)).toBe('best')
    expect(defaultSort('saved')).toBe('newest')
  })

  it('keeps filters per view, so the feed’s tiers never narrow Applied', () => {
    localStorage.clear()
    forgetSearches()
    rememberSearch('feed', { tier: ['Mid', 'Startup'], q: 'backend' })
    expect(recallSearch('applied')).toEqual({})
    expect(recallSearch('saved')).toEqual({ view: 'saved' })
    rememberSearch('saved', { view: 'saved', age: '3d' })
    expect(recallSearch('feed')).toEqual({ tier: ['Mid', 'Startup'], q: 'backend' })
    expect(recallSearch('saved')).toEqual({ age: '3d', view: 'saved' })
  })

  it('keeps filters across a reload, without the text search', () => {
    localStorage.clear()
    forgetSearches()
    rememberSearch('feed', { tier: ['Mid', 'Startup', 'Corporate', 'Unlisted'], q: 'backend' })
    forgetSearches()
    expect(recallSearch('feed')).toEqual({ tier: ['Mid', 'Startup', 'Corporate', 'Unlisted'] })
    localStorage.setItem('jobvr.filters', 'not json')
    forgetSearches()
    expect(recallSearch('feed')).toEqual({})
  })

  it('treats a search with only a view as blank', () => {
    expect(isBlankSearch({ view: 'saved' })).toBe(true)
    expect(isBlankSearch({ tier: [] })).toBe(true)
    expect(isBlankSearch({ tier: ['Mid'] })).toBe(false)
    expect(isBlankSearch({ age: '3d' })).toBe(false)
  })
})
