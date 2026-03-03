import { describe, it, expect } from 'vitest'
import { preprocessQuery } from '../../../main/database/search/query-preprocessor'
import type { QueryType } from '../../../main/database/search/query-preprocessor'

describe('preprocessQuery', () => {
  describe('tokenization', () => {
    it('splits query into lowercase tokens', () => {
      const result = preprocessQuery('Hello World')
      expect(result.tokens).toEqual(['hello', 'world'])
    })

    it('removes stop words from longer queries', () => {
      const result = preprocessQuery('how does the authentication system work')
      // 'how', 'does', 'the' are stop words; with >= 4 words they get filtered
      expect(result.tokens).not.toContain('the')
      expect(result.tokens).not.toContain('does')
      expect(result.tokens).toContain('authentication')
      expect(result.tokens).toContain('system')
      expect(result.tokens).toContain('work')
    })

    it('keeps stop words in short queries', () => {
      const result = preprocessQuery('is it done')
      // Only 3 words, so stop words are kept
      expect(result.tokens).toEqual(['is', 'it', 'done'])
    })

    it('handles empty query', () => {
      const result = preprocessQuery('')
      expect(result.tokens).toEqual([])
    })

    it('handles extra whitespace', () => {
      const result = preprocessQuery('  hello   world  ')
      expect(result.tokens).toEqual(['hello', 'world'])
    })
  })

  describe('query classification', () => {
    it('classifies PascalCase as symbol', () => {
      const result = preprocessQuery('UserService')
      expect(result.queryType).toBe('symbol')
    })

    it('classifies camelCase as symbol', () => {
      const result = preprocessQuery('getUserById')
      expect(result.queryType).toBe('symbol')
    })

    it('classifies snake_case as symbol', () => {
      const result = preprocessQuery('get_user')
      expect(result.queryType).toBe('symbol')
    })

    it('classifies dot notation as symbol', () => {
      const result = preprocessQuery('user.name')
      expect(result.queryType).toBe('symbol')
    })

    it('classifies function call syntax as symbol', () => {
      const result = preprocessQuery('fetchData()')
      expect(result.queryType).toBe('symbol')
    })

    it('classifies natural language questions as concept', () => {
      const result = preprocessQuery('how does authentication work')
      expect(result.queryType).toBe('concept')
    })

    it('classifies long queries as concept', () => {
      const result = preprocessQuery('find all functions related to user data processing')
      expect(result.queryType).toBe('concept')
    })

    it('classifies queries with concept indicators as concept', () => {
      const indicators = ['how', 'what', 'why', 'where', 'when', 'explain', 'describe', 'understand']
      for (const indicator of indicators) {
        const result = preprocessQuery(`${indicator} authentication`)
        expect(result.queryType).toBe('concept')
      }
    })

    it('classifies short generic queries as pattern', () => {
      const result = preprocessQuery('error handling')
      expect(result.queryType).toBe('pattern')
    })

    it('classifies multi-word non-question queries as pattern', () => {
      const result = preprocessQuery('database connection')
      expect(result.queryType).toBe('pattern')
    })
  })

  describe('weight assignment', () => {
    it('assigns high keyword weight for symbol queries', () => {
      const result = preprocessQuery('UserService')
      expect(result.keywordWeight).toBe(0.6)
      expect(result.semanticWeight).toBe(0.4)
    })

    it('assigns high semantic weight for concept queries', () => {
      const result = preprocessQuery('how does authentication work')
      expect(result.semanticWeight).toBe(0.85)
      expect(result.keywordWeight).toBe(0.15)
    })

    it('assigns balanced weights for pattern queries', () => {
      const result = preprocessQuery('error handling')
      expect(result.semanticWeight).toBe(0.7)
      expect(result.keywordWeight).toBe(0.3)
    })

    it('weights always sum to 1', () => {
      const queries = ['UserService', 'how does auth work', 'error handling', 'x']
      for (const q of queries) {
        const result = preprocessQuery(q)
        expect(result.semanticWeight + result.keywordWeight).toBeCloseTo(1.0)
      }
    })
  })

  describe('original query preservation', () => {
    it('preserves the original query string', () => {
      const result = preprocessQuery('How Does AUTH Work?')
      expect(result.original).toBe('How Does AUTH Work?')
    })
  })
})
