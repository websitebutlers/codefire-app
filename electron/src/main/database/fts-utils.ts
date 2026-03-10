/**
 * Sanitize a query string for FTS5 MATCH syntax.
 * Wraps each token in double quotes to treat them as literal terms,
 * preventing FTS5 operator injection (AND, OR, NOT, NEAR, *, etc.).
 */
export function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(/['"]/g, '') // Remove quotes that would break FTS5 syntax
    .split(/\s+/)
    .filter((t) => t.length > 0)

  if (tokens.length === 0) return ''

  // Wrap each token in double quotes to escape FTS5 special characters
  return tokens.map((t) => `"${t}"`).join(' ')
}
