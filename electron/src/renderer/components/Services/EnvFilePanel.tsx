import { useState, useEffect } from 'react'
import { KeyRound, Eye, EyeOff, Copy, Check } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface EnvFile {
  name: string
  path: string
  varCount: number
}

interface EnvVar {
  key: string
  value: string
  comment?: string
}

interface EnvFilePanelProps {
  files: EnvFile[]
}

export default function EnvFilePanel({ files }: EnvFilePanelProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [vars, setVars] = useState<EnvVar[]>([])
  const [loading, setLoading] = useState(false)
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  const activeFile = files[activeIndex]

  useEffect(() => {
    if (!activeFile) return

    let cancelled = false
    setLoading(true)
    setRevealedKeys(new Set())

    api.services
      .readEnvFile(activeFile.path)
      .then((data) => {
        if (!cancelled) setVars(data)
      })
      .catch((err) => {
        console.error('Failed to read env file:', err)
        if (!cancelled) setVars([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeFile?.path])

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const [copied, setCopied] = useState(false)

  const handleCopyToEnv = async () => {
    if (!activeFile || vars.length === 0) return
    // Derive the .env path by replacing the filename with ".env" in the same directory
    const dirSep = activeFile.path.includes('\\') ? '\\' : '/'
    const dir = activeFile.path.substring(0, activeFile.path.lastIndexOf(dirSep))
    const envPath = `${dir}${dirSep}.env`

    if (!window.confirm(`Copy ${vars.length} variables from ${activeFile.name} to .env?\n\nThis will overwrite the existing .env file if it exists.`)) {
      return
    }

    const content = vars
      .map((v) => (v.comment ? `${v.comment}\n${v.key}=${v.value}` : `${v.key}=${v.value}`))
      .join('\n')

    try {
      await api.files.write(envPath, content + '\n')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to .env:', err)
    }
  }

  if (files.length === 0) return null

  // Show "Copy to .env" when active file is not literally ".env"
  const canCopyToEnv = activeFile && activeFile.name !== '.env' && vars.length > 0

  return (
    <div>
      {/* Tab strip for multiple files */}
      {files.length > 1 && (
        <div className="flex items-center gap-1 mb-2">
          {files.map((file, idx) => (
            <button
              key={file.path}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                idx === activeIndex
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60'
              }`}
            >
              {file.name}
            </button>
          ))}
          {canCopyToEnv && (
            <>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleCopyToEnv}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60 transition-colors"
                title={`Copy ${activeFile.name} variables to .env`}
              >
                {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                {copied ? 'Copied!' : 'Copy to .env'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Variable list */}
      {loading ? (
        <p className="text-[10px] text-neutral-500 py-2">Loading...</p>
      ) : vars.length === 0 ? (
        <p className="text-[10px] text-neutral-500 py-2">No variables found</p>
      ) : (
        <div className="space-y-1">
          {vars.map((v) => (
            <div
              key={v.key}
              className="group flex items-center gap-2 py-1 px-2 rounded hover:bg-neutral-800/60 transition-colors"
            >
              <KeyRound size={12} className="text-neutral-600 shrink-0" />
              <span className="font-mono text-xs text-neutral-300 shrink-0">{v.key}</span>
              <span className="text-[10px] text-neutral-600">=</span>
              <span className="font-mono text-xs text-neutral-500 truncate flex-1 min-w-0">
                {revealedKeys.has(v.key) ? v.value : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
              </span>
              <button
                type="button"
                onClick={() => toggleReveal(v.key)}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                {revealedKeys.has(v.key) ? (
                  <EyeOff size={12} className="text-neutral-500 hover:text-neutral-300" />
                ) : (
                  <Eye size={12} className="text-neutral-500 hover:text-neutral-300" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
