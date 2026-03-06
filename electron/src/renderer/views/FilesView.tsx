import { useState } from 'react'
import FileTree from '@renderer/components/Files/FileTree'
import CodeViewer from '@renderer/components/Files/CodeViewer'

interface FilesViewProps {
  projectId: string
  projectPath: string
}

export default function FilesView({ projectPath }: FilesViewProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  return (
    <div className="flex h-full">
      {/* File tree panel (30%) */}
      <div className="w-[30%] min-w-[200px] border-r border-neutral-800 shrink-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-neutral-800 shrink-0">
          <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Files</h3>
        </div>
        <div className="h-[calc(100%-33px)]">
          <FileTree
            rootPath={projectPath}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </div>
      </div>

      {/* Code viewer panel (70%) */}
      <div className="flex-1 min-w-0">
        <CodeViewer filePath={selectedFile} projectPath={projectPath} />
      </div>
    </div>
  )
}
