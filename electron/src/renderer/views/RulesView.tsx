import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@renderer/lib/api'
import RuleFileList from '@renderer/components/Rules/RuleFileList'
import RuleEditor from '@renderer/components/Rules/RuleEditor'
import type { RuleFile } from '@renderer/components/Rules/RuleFileList'

interface RulesViewProps {
  projectId: string
  projectPath: string
}

export default function RulesView({ projectId, projectPath }: RulesViewProps) {
  const [files, setFiles] = useState<RuleFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedScope, setSelectedScope] = useState<string | null>(null)
  const [editorContent, setEditorContent] = useState('')

  // Load rule files on mount
  const loadFiles = useCallback(async () => {
    try {
      const result = await api.rules.list(projectPath)
      setFiles(result)
      return result
    } catch (err) {
      console.error('Failed to load rule files:', err)
      setError('Failed to load rule files')
      return []
    }
  }, [projectPath])

  useEffect(() => {
    let cancelled = false

    async function init() {
      setLoading(true)
      const result = await loadFiles()
      if (!cancelled) setLoading(false)
    }

    init()
    return () => {
      cancelled = true
    }
  }, [loadFiles])

  // Get the currently selected file object
  const selectedFile = files.find((f) => f.scope === selectedScope) ?? null

  // Handle selecting a file
  const handleSelect = useCallback(
    async (file: RuleFile) => {
      setSelectedScope(file.scope)

      if (file.exists) {
        try {
          const content = await api.rules.read(file.path)
          setEditorContent(content)
        } catch (err) {
          console.error('Failed to read rule file:', err)
          setEditorContent('')
        }
      } else {
        setEditorContent('')
      }
    },
    []
  )

  // Handle creating a file
  const handleCreate = useCallback(
    async (file: RuleFile) => {
      try {
        await api.rules.create(file.path, file.scope)
        const updatedFiles = await loadFiles()
        setSelectedScope(file.scope)

        // Load the newly created file content
        const created = updatedFiles.find((f) => f.scope === file.scope)
        if (created?.exists) {
          const content = await api.rules.read(created.path)
          setEditorContent(content)
        }
      } catch (err) {
        console.error('Failed to create rule file:', err)
      }
    },
    [loadFiles]
  )

  // Handle creating from the editor panel
  const handleEditorCreate = useCallback(
    async (filePath: string) => {
      try {
        await api.rules.create(filePath)
        const updatedFiles = await loadFiles()

        // Load the newly created file content
        const created = updatedFiles.find((f) => f.path === filePath)
        if (created?.exists) {
          const content = await api.rules.read(created.path)
          setEditorContent(content)
        }
      } catch (err) {
        console.error('Failed to create rule file:', err)
      }
    },
    [loadFiles]
  )

  // Handle saving
  const handleSave = useCallback(
    async (filePath: string, content: string) => {
      try {
        await api.rules.write(filePath, content)
      } catch (err) {
        console.error('Failed to save rule file:', err)
      }
    },
    []
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-error">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Left panel — file list */}
      <div className="w-52 border-r border-neutral-800 shrink-0">
        <RuleFileList
          files={files}
          selectedScope={selectedScope}
          onSelect={handleSelect}
          onCreate={handleCreate}
        />
      </div>

      {/* Right panel — editor */}
      <div className="flex-1">
        <RuleEditor
          scope={selectedFile?.scope ?? null}
          label={selectedFile?.label ?? ''}
          color={selectedFile?.color ?? 'orange'}
          filePath={selectedFile?.path ?? ''}
          exists={selectedFile?.exists ?? false}
          content={editorContent}
          projectPath={projectPath}
          onSave={handleSave}
          onCreate={handleEditorCreate}
        />
      </div>
    </div>
  )
}
