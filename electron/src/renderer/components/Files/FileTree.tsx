import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@renderer/lib/api'
import FileTreeRow from './FileTreeRow'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

interface FileTreeProps {
  rootPath: string
  selectedFile: string | null
  onSelectFile: (filePath: string) => void
  searchQuery?: string
}

interface TreeNode {
  entry: FileEntry
  children?: TreeNode[]
  isLoaded: boolean
  isExpanded: boolean
}

export default function FileTree({ rootPath, selectedFile, onSelectFile, searchQuery = '' }: FileTreeProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDirectory = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const entries = await api.files.list(dirPath)
    return entries.map((entry) => ({
      entry,
      isLoaded: false,
      isExpanded: false,
    }))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    loadDirectory(rootPath)
      .then((result) => {
        if (!cancelled) {
          setNodes(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load files')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [rootPath, loadDirectory])

  const toggleDirectory = useCallback(
    async (path: string[]) => {
      setNodes((prev) => {
        // Deep clone to avoid mutation
        const cloned = structuredClone(prev)
        const node = navigateToNode(cloned, path)
        if (!node) return prev

        if (node.isExpanded) {
          // Collapse
          node.isExpanded = false
          return cloned
        }

        // Expand — load children if not yet loaded
        node.isExpanded = true
        if (!node.isLoaded) {
          // Load async and update
          loadDirectory(node.entry.path).then((children) => {
            setNodes((current) => {
              const updated = structuredClone(current)
              const target = navigateToNode(updated, path)
              if (target) {
                target.children = children
                target.isLoaded = true
              }
              return updated
            })
          })
        }

        return cloned
      })
    },
    [loadDirectory]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 size={16} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-error">{error}</div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="p-3 text-xs text-neutral-600">No files found</div>
    )
  }

  const query = searchQuery.toLowerCase().trim()

  return (
    <div className="overflow-y-auto h-full py-1">
      {renderNodes(nodes, [], 0, selectedFile, onSelectFile, toggleDirectory, query)}
    </div>
  )
}

/** Navigate into nested nodes using a path of indices */
function navigateToNode(nodes: TreeNode[], path: string[]): TreeNode | null {
  if (path.length === 0) return null
  let current: TreeNode | undefined
  let list = nodes

  for (const segment of path) {
    const idx = parseInt(segment, 10)
    current = list[idx]
    if (!current) return null
    list = current.children ?? []
  }

  return current ?? null
}

/** Check if a node or any descendant matches the search query */
function nodeMatchesQuery(node: TreeNode, query: string): boolean {
  if (!query) return true
  if (node.entry.name.toLowerCase().includes(query)) return true
  if (node.children) {
    return node.children.some((child) => nodeMatchesQuery(child, query))
  }
  return false
}

function renderNodes(
  nodes: TreeNode[],
  pathPrefix: string[],
  depth: number,
  selectedFile: string | null,
  onSelectFile: (filePath: string) => void,
  onToggle: (path: string[]) => void,
  query: string = ''
): React.ReactNode[] {
  const elements: React.ReactNode[] = []

  nodes.forEach((node, idx) => {
    // Skip nodes that don't match search
    if (query && !nodeMatchesQuery(node, query)) return

    const currentPath = [...pathPrefix, String(idx)]
    const key = node.entry.path

    elements.push(
      <FileTreeRow
        key={key}
        name={node.entry.name}
        isDirectory={node.entry.isDirectory}
        isExpanded={node.isExpanded || (!!query && node.entry.isDirectory)}
        isSelected={selectedFile === node.entry.path}
        depth={depth}
        onClick={() => {
          if (node.entry.isDirectory) {
            onToggle(currentPath)
          } else {
            onSelectFile(node.entry.path)
          }
        }}
      />
    )

    if ((node.isExpanded || !!query) && node.children) {
      elements.push(
        ...renderNodes(
          node.children,
          currentPath,
          depth + 1,
          selectedFile,
          onSelectFile,
          onToggle,
          query
        )
      )
    }
  })

  return elements
}
