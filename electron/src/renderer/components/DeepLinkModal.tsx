import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, X } from 'lucide-react'

interface DeepLinkResult {
  success: boolean
  cli?: string
  displayName?: string
  error?: string
  type?: string
}

export default function DeepLinkModal() {
  const [result, setResult] = useState<DeepLinkResult | null>(null)

  useEffect(() => {
    const unsub = window.api.on('deeplink:result', (data: unknown) => {
      const r = data as DeepLinkResult
      if (r.type === 'auth-callback') {
        // Auth callback — reload the page to refresh premium status
        window.location.reload()
        return
      }
      setResult(r)
    })
    return unsub
  }, [])

  if (!result) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[360px] p-8">
        {/* Close button */}
        <button
          onClick={() => setResult(null)}
          className="absolute top-3 right-3 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center text-center gap-4">
          {result.success ? (
            <>
              <CheckCircle size={48} className="text-green-500" />
              <h2 className="text-lg font-semibold text-neutral-100">MCP Configured</h2>
              <p className="text-sm text-neutral-300">
                CodeFire is now connected to {result.displayName}.
              </p>
              <p className="text-sm text-neutral-500">
                Restart your CLI session to activate.
              </p>
            </>
          ) : (
            <>
              <XCircle size={48} className="text-red-500" />
              <h2 className="text-lg font-semibold text-neutral-100">Configuration Failed</h2>
              <p className="text-sm text-neutral-400">
                {result.error || 'An unknown error occurred.'}
              </p>
            </>
          )}

          <button
            onClick={() => setResult(null)}
            className="mt-2 px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm rounded-lg border border-neutral-600 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
