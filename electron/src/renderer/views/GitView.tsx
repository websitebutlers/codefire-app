import { useState, useCallback } from 'react'
import { Loader2, GitCommitHorizontal } from 'lucide-react'
import { useGit } from '@renderer/hooks/useGit'
import { api } from '@renderer/lib/api'
import CollapsibleSection from '@renderer/components/Services/CollapsibleSection'
import GitHeader from '@renderer/components/Git/GitHeader'
import CommitComposer from '@renderer/components/Git/CommitComposer'
import FileRow from '@renderer/components/Git/FileRow'
import DiffViewer from '@renderer/components/Git/DiffViewer'
import CommitRow from '@renderer/components/Git/CommitRow'
import GitHubSection from '@renderer/components/Git/GitHubSection'

interface GitViewProps {
  projectId: string
  projectPath: string
}

export default function GitView({ projectPath }: GitViewProps) {
  const git = useGit(projectPath)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')

  const toggleDiff = useCallback(
    async (filePath: string, staged: boolean) => {
      const key = `${staged ? 'staged:' : 'unstaged:'}${filePath}`
      if (expandedFile === key) {
        setExpandedFile(null)
        setDiffContent('')
        return
      }
      try {
        const diff = await api.git.diff(projectPath, { file: filePath, staged })
        setExpandedFile(key)
        setDiffContent(diff)
      } catch {
        setExpandedFile(key)
        setDiffContent('')
      }
    },
    [expandedFile, projectPath]
  )

  if (git.loading && !git.branch) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  const totalChanges = git.staged.length + git.unstaged.length + git.untracked.length

  return (
    <div className="flex flex-col h-full">
      <GitHeader
        branch={git.branch}
        changeCount={totalChanges}
        loading={git.loading}
        onRefresh={git.refresh}
      />

      <CommitComposer
        stagedCount={git.staged.length}
        onStageAll={git.stageAll}
        onUnstageAll={git.unstageAll}
        onCommit={git.commit}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Staged Files */}
        {git.staged.length > 0 && (
          <CollapsibleSection
            title="Staged"
            count={git.staged.length}
            icon={<span className="w-2 h-2 rounded-full bg-green-500" />}
          >
            <div className="space-y-0.5">
              {git.staged.map((file) => {
                const key = `staged:${file.path}`
                return (
                  <div key={key}>
                    <FileRow
                      status={file.status}
                      path={file.path}
                      isExpanded={expandedFile === key}
                      action="unstage"
                      onClick={() => toggleDiff(file.path, true)}
                      onAction={() => git.unstageFiles([file.path])}
                    />
                    {expandedFile === key && <DiffViewer diff={diffContent} />}
                  </div>
                )
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Unstaged Changes */}
        {git.unstaged.length > 0 && (
          <CollapsibleSection
            title="Changes"
            count={git.unstaged.length}
            icon={<span className="w-2 h-2 rounded-full bg-codefire-orange" />}
          >
            <div className="space-y-0.5">
              {git.unstaged.map((file) => {
                const key = `unstaged:${file.path}`
                return (
                  <div key={key}>
                    <FileRow
                      status={file.status}
                      path={file.path}
                      isExpanded={expandedFile === key}
                      action="stage"
                      onClick={() => toggleDiff(file.path, false)}
                      onAction={() => git.stageFiles([file.path])}
                      onDiscard={() => git.discardFiles([file.path])}
                    />
                    {expandedFile === key && <DiffViewer diff={diffContent} />}
                  </div>
                )
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Untracked Files */}
        {git.untracked.length > 0 && (
          <CollapsibleSection
            title="Untracked"
            count={git.untracked.length}
            icon={<span className="w-2 h-2 rounded-full bg-neutral-500" />}
          >
            <div className="space-y-0.5">
              {git.untracked.map((file) => (
                <FileRow
                  key={file.path}
                  status="?"
                  path={file.path}
                  isExpanded={false}
                  action="stage"
                  onClick={() => {}}
                  onAction={() => git.stageFiles([file.path])}
                  onDiscard={() => git.discardFiles([file.path], true)}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Recent Commits */}
        {git.commits.length > 0 && (
          <CollapsibleSection
            title="Recent Commits"
            count={git.commits.length}
            icon={<GitCommitHorizontal size={14} className="text-blue-400" />}
            defaultOpen={false}
          >
            <div className="space-y-0.5">
              {git.commits.map((commit) => (
                <CommitRow
                  key={commit.hash}
                  hash={commit.hash}
                  subject={commit.subject}
                  date={commit.date}
                  author={commit.author}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* GitHub Integration */}
        <GitHubSection projectPath={projectPath} />

        {/* Empty state */}
        {git.isClean && git.commits.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <GitCommitHorizontal size={32} className="text-neutral-700" />
            <p className="text-sm text-neutral-500">No git data available</p>
          </div>
        )}
      </div>
    </div>
  )
}
