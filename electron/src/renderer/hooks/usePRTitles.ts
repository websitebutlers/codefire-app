import { useState, useEffect } from 'react'
import { api } from '@renderer/lib/api'

/**
 * Fetches GitHub PR titles for a project and builds a map of branch name → PR title.
 * Returns an empty map if the GitHub token is not set or the repo is not on GitHub.
 */
export function usePRTitles(projectId: string) {
  const [prTitleMap, setPrTitleMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let cancelled = false

    async function fetchPRTitles() {
      try {
        // Get the project to find its path
        const project = await api.projects.get(projectId)
        if (!project?.path || cancelled) return

        // Detect GitHub repo from git remote
        const repoInfo = await api.github.getRepoInfo(project.path)
        if (!repoInfo || cancelled) return

        // Fetch open and recently merged/closed PRs
        const [openPRs, mergedPRs] = await Promise.all([
          api.github.listPRs(repoInfo.owner, repoInfo.repo, { state: 'OPEN', limit: 50 }),
          api.github.listPRs(repoInfo.owner, repoInfo.repo, { state: 'MERGED', limit: 30 }),
        ])
        if (cancelled) return

        // Build branch → PR title map
        const map = new Map<string, string>()
        for (const pr of [...openPRs, ...mergedPRs]) {
          if (pr.headRefName && pr.title) {
            // If multiple PRs for same branch, prefer the open one (it's first)
            if (!map.has(pr.headRefName)) {
              map.set(pr.headRefName, pr.title)
            }
          }
        }

        if (!cancelled) {
          setPrTitleMap(map)
        }
      } catch {
        // Silently fail - PR titles are a nice-to-have enhancement
      }
    }

    fetchPRTitles()
    return () => { cancelled = true }
  }, [projectId])

  return prTitleMap
}
