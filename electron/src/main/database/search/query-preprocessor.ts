/**
 * Query preprocessor for hybrid search.
 * Classifies queries and assigns adaptive weights for keyword vs. semantic search.
 * Ported from Swift QueryPreprocessor.swift.
 */

export type QueryType = 'symbol' | 'concept' | 'pattern'

export interface ProcessedQuery {
  original: string
  tokens: string[]
  queryType: QueryType
  semanticWeight: number // Weight for vector search
  keywordWeight: number // Weight for FTS search
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our',
])

const CONCEPT_INDICATORS = [
  'how', 'what', 'why', 'where', 'when', 'explain', 'describe', 'understand',
]

const SYMBOL_PATTERNS = [
  /^[A-Z][a-zA-Z0-9]*$/, // PascalCase
  /^[a-z][a-zA-Z0-9]*[A-Z]/, // camelCase
  /^[a-z_]+$/, // snake_case
  /\./, // dot notation
  /\(\)/, // function call
]

const WEIGHTS: Record<QueryType, { semantic: number; keyword: number }> = {
  symbol: { semantic: 0.4, keyword: 0.6 },
  concept: { semantic: 0.85, keyword: 0.15 },
  pattern: { semantic: 0.7, keyword: 0.3 },
}

/**
 * Classify and preprocess a search query.
 */
export function preprocessQuery(query: string): ProcessedQuery {
  const tokens = tokenize(query)
  const queryType = classifyQuery(query, tokens)

  return {
    original: query,
    tokens,
    queryType,
    semanticWeight: WEIGHTS[queryType].semantic,
    keywordWeight: WEIGHTS[queryType].keyword,
  }
}

function tokenize(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0)

  // Only filter stop words for longer queries (4+ words)
  if (words.length >= 4) {
    return words.filter((w) => !STOP_WORDS.has(w))
  }
  return words
}

function classifyQuery(query: string, tokens: string[]): QueryType {
  // Symbol queries: look like code identifiers
  if (tokens.length <= 2 && SYMBOL_PATTERNS.some((p) => p.test(query.trim()))) {
    return 'symbol'
  }

  // Concept queries: natural language questions/descriptions
  if (CONCEPT_INDICATORS.some((w) => tokens.includes(w)) || tokens.length >= 5) {
    return 'concept'
  }

  return 'pattern'
}
