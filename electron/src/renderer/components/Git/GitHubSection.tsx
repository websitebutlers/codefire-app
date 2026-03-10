import { useState, useEffect, useRef } from 'react'
import { GitPullRequest, Activity, CircleDot, CheckCircle, XCircle, Clock, ShieldCheck, ShieldAlert, MessageCircle } from 'lucide-react'
import { api } from '@renderer/lib/api'
import CollapsibleSection from '@renderer/components/Services/CollapsibleSection'

interface GitHubSectionProps {
  projectPath: string
}

interface PR {
  number: number
  title: string
  draft: boolean
  state: string
  reviewDecision: string | null
  isDraft: boolean
  headRefName: string
}

interface Workflow {
  name: string
  status: string
  conclusion: string | null
  branch: string
}

interface Issue {
  number: number
  title: string
  labels: Array<{ name: string; color: string }>
}

export default function GitHubSection({ projectPath }: GitHubSectionProps) {
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repo: string } | null>(null)
  const [prs, setPrs] = useState<PR[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [loaded, setLoaded] = useState(false)

  const repoInfoRef = useRef<{ owner: string; repo: string } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const info = repoInfoRef.current ?? await api.github.getRepoInfo(projectPath)
        if (cancelled || !info) {
          setLoaded(true)
          return
        }
        repoInfoRef.current = info
        setRepoInfo(info)

        const [prList, workflowList, issueList] = await Promise.all([
          api.github.listPRs(info.owner, info.repo, { state: 'open', limit: 10 }),
          api.github.listWorkflows(info.owner, info.repo, { limit: 10 }),
          api.github.listIssues(info.owner, info.repo, { state: 'open', limit: 10 }),
        ])

        if (cancelled) return
        setPrs(prList)
        setWorkflows(workflowList)
        setIssues(issueList)
      } catch {
        // GitHub integration is optional — silently fail
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }

    load()

    // Auto-refresh every 60 seconds
    const interval = setInterval(load, 60_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [projectPath])

  if (!loaded || !repoInfo) return null

  const hasContent = prs.length > 0 || workflows.length > 0 || issues.length > 0
  if (!hasContent) return null

  return (
    <div className="border-t border-neutral-800 mt-1">
      {/* Pull Requests */}
      {prs.length > 0 && (
        <CollapsibleSection
          title="Pull Requests"
          count={prs.length}
          icon={<GitPullRequest size={14} className="text-purple-400" />}
        >
          <div className="space-y-1">
            {prs.map((pr) => (
              <div
                key={pr.number}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/40 transition-colors"
              >
                <span className="text-[11px] font-mono text-purple-400 shrink-0">
                  #{pr.number}
                </span>
                <span className="text-sm text-neutral-300 truncate flex-1">{pr.title}</span>
                {pr.headRefName && (
                  <span className="text-[10px] font-mono text-neutral-600 shrink-0 truncate max-w-[100px]">
                    {pr.headRefName}
                  </span>
                )}
                {pr.reviewDecision === 'APPROVED' && (
                  <span title="Approved"><ShieldCheck size={12} className="text-green-400 shrink-0" /></span>
                )}
                {pr.reviewDecision === 'CHANGES_REQUESTED' && (
                  <span title="Changes requested"><ShieldAlert size={12} className="text-orange-400 shrink-0" /></span>
                )}
                {pr.reviewDecision === 'REVIEW_REQUIRED' && (
                  <span title="Review required"><MessageCircle size={12} className="text-neutral-500 shrink-0" /></span>
                )}
                {(pr.draft || pr.isDraft) && (
                  <span className="text-[10px] bg-neutral-800 text-neutral-500 rounded px-1.5 py-0.5 leading-none">
                    draft
                  </span>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* CI/Workflows */}
      {workflows.length > 0 && (
        <CollapsibleSection
          title="CI / Workflows"
          count={workflows.length}
          icon={<Activity size={14} className="text-cyan-400" />}
        >
          <div className="space-y-1">
            {workflows.map((wf, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/40 transition-colors"
              >
                {wf.conclusion === 'success' ? (
                  <CheckCircle size={12} className="text-green-400 shrink-0" />
                ) : wf.conclusion === 'failure' ? (
                  <XCircle size={12} className="text-red-400 shrink-0" />
                ) : (
                  <Clock size={12} className="text-orange-400 shrink-0" />
                )}
                <span className="text-sm text-neutral-300 truncate flex-1">{wf.name}</span>
                <span className="text-[10px] text-neutral-600 shrink-0">{wf.branch}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Issues */}
      {issues.length > 0 && (
        <CollapsibleSection
          title="Issues"
          count={issues.length}
          icon={<CircleDot size={14} className="text-yellow-400" />}
        >
          <div className="space-y-1">
            {issues.map((issue) => (
              <div
                key={issue.number}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/40 transition-colors"
              >
                <span className="text-[11px] font-mono text-yellow-400 shrink-0">
                  #{issue.number}
                </span>
                <span className="text-sm text-neutral-300 truncate flex-1">{issue.title}</span>
                {issue.labels.map((label) => (
                  <span
                    key={label.name}
                    className="text-[10px] rounded px-1.5 py-0.5 leading-none"
                    style={{
                      backgroundColor: `#${label.color}20`,
                      color: `#${label.color}`,
                    }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}
