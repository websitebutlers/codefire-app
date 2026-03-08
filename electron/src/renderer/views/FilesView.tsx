import { useState } from 'react'
import { Search } from 'lucide-react'
import FileTree from '@renderer/components/Files/FileTree'
import CodeViewer from '@renderer/components/Files/CodeViewer'

interface FilesViewProps {
  projectId: string
  projectPath: string
}

export default function FilesView({ projectPath }: FilesViewProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="flex h-full">
      {/* File tree panel (30%) */}
      <div className="w-[30%] min-w-[200px] border-r border-neutral-800 shrink-0 overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-neutral-800 shrink-0 space-y-1.5">
          <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Files</h3>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter files..."
              className="w-full bg-neutral-800 border border-neutral-700 rounded pl-7 pr-2 py-1
                         text-xs text-neutral-200 placeholder-neutral-500
                         focus:outline-none focus:border-codefire-orange/50"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <FileTree
            rootPath={projectPath}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            searchQuery={searchQuery}
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
