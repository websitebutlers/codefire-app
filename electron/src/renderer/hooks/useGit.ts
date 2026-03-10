import { useState, useEffect, useCallback } from 'react'
import { api } from '@renderer/lib/api'

interface GitFile {
  status: string
  path: string
}

interface Commit {
  hash: string
  author: string
  email: string
  date: string
  subject: string
  body: string
}

interface GitState {
  branch: string
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: GitFile[]
  isClean: boolean
  commits: Commit[]
  loading: boolean
}

export function useGit(projectPath: string) {
  const [state, setState] = useState<GitState>({
    branch: '',
    staged: [],
    unstaged: [],
    untracked: [],
    isClean: true,
    commits: [],
    loading: true,
  })

  const refresh = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true }))

      const [statusResult, logResult] = await Promise.all([
        api.git.status(projectPath),
        api.git.log(projectPath, { limit: 15 }),
      ])

      const staged: GitFile[] = []
      const unstaged: GitFile[] = []
      const untracked: GitFile[] = []

      for (const file of statusResult.files) {
        const s = file.status
        if (s === '??') {
          untracked.push(file)
        } else {
          // X = index status (first char), Y = worktree status (second char)
          const x = s[0]
          const y = s[1]

          if (x && x !== ' ' && x !== '?') {
            staged.push({ status: x, path: file.path })
          }
          if (y && y !== ' ' && y !== '?') {
            unstaged.push({ status: y, path: file.path })
          }
        }
      }

      setState({
        branch: statusResult.branch,
        staged,
        unstaged,
        untracked,
        isClean: statusResult.isClean,
        commits: logResult,
        loading: false,
      })
    } catch (err) {
      console.error('Failed to load git data:', err)
      setState((prev) => ({ ...prev, loading: false }))
    }
  }, [projectPath])

  useEffect(() => {
    refresh()
  }, [refresh])

  const stageFiles = useCallback(
    async (paths: string[]) => {
      await api.git.stage(projectPath, paths)
      await refresh()
    },
    [projectPath, refresh]
  )

  const unstageFiles = useCallback(
    async (paths: string[]) => {
      await api.git.unstage(projectPath, paths)
      await refresh()
    },
    [projectPath, refresh]
  )

  const stageAll = useCallback(async () => {
    const allPaths = [
      ...state.unstaged.map((f) => f.path),
      ...state.untracked.map((f) => f.path),
    ]
    if (allPaths.length > 0) {
      await api.git.stage(projectPath, allPaths)
      await refresh()
    }
  }, [projectPath, state.unstaged, state.untracked, refresh])

  const unstageAll = useCallback(async () => {
    const allPaths = state.staged.map((f) => f.path)
    if (allPaths.length > 0) {
      await api.git.unstage(projectPath, allPaths)
      await refresh()
    }
  }, [projectPath, state.staged, refresh])

  const discardFiles = useCallback(
    async (paths: string[], untracked: boolean = false) => {
      await api.git.discard(projectPath, paths, untracked)
      await refresh()
    },
    [projectPath, refresh]
  )

  const commit = useCallback(
    async (message: string) => {
      const result = await api.git.commit(projectPath, message)
      await refresh()
      return result
    },
    [projectPath, refresh]
  )

  const getDiff = useCallback(
    async (file: string, staged?: boolean) => {
      return api.git.diff(projectPath, { file, staged })
    },
    [projectPath]
  )

  return {
    ...state,
    refresh,
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    discardFiles,
    commit,
    getDiff,
  }
}
