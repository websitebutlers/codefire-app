import { useState, useEffect } from 'react'
import MainLayout from '@renderer/layouts/MainLayout'
import ProjectLayout from '@renderer/layouts/ProjectLayout'
import DeepLinkModal from '@renderer/components/DeepLinkModal'
import SettingsModal from '@renderer/components/Settings/SettingsModal'
import ErrorBoundary from '@renderer/components/ErrorBoundary'

export default function App() {
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get('projectId')
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    return window.api.on('menu:openSettings', () => setShowSettings(true))
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+, → Open Settings
      if (ctrl && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
        return
      }

      // Ctrl+Shift+H → Show Planner (focus main window)
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        window.api.invoke('window:focusMain')
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <ErrorBoundary>
      {projectId ? <ProjectLayout projectId={projectId} /> : <MainLayout />}
      <DeepLinkModal />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </ErrorBoundary>
  )
}
