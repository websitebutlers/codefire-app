import { useState, useEffect } from 'react'
import MainLayout from '@renderer/layouts/MainLayout'
import ProjectLayout from '@renderer/layouts/ProjectLayout'
import DeepLinkModal from '@renderer/components/DeepLinkModal'
import SettingsModal from '@renderer/components/Settings/SettingsModal'

export default function App() {
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get('projectId')
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    return window.api.on('menu:openSettings', () => setShowSettings(true))
  }, [])

  return (
    <>
      {projectId ? <ProjectLayout projectId={projectId} /> : <MainLayout />}
      <DeepLinkModal />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  )
}
