// Only import jest-dom matchers when running in jsdom environment (renderer tests)
if (typeof window !== 'undefined') {
  import('@testing-library/jest-dom')
}
