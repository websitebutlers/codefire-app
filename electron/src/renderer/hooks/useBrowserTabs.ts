import { useState, useCallback } from 'react'

export interface BrowserTab {
  id: string
  url: string
  title: string
  isLoading: boolean
}

let tabCounter = 0

export function useBrowserTabs(defaultUrl = 'https://www.google.com') {
  const [tabs, setTabs] = useState<BrowserTab[]>([
    {
      id: `tab-${++tabCounter}`,
      url: defaultUrl,
      title: 'New Tab',
      isLoading: false,
    },
  ])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)

  const addTab = useCallback((url = 'about:blank') => {
    const id = `tab-${++tabCounter}`
    const tab: BrowserTab = { id, url, title: 'New Tab', isLoading: false }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(id)
    return id
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== id)
        if (filtered.length === 0) {
          const newTab: BrowserTab = {
            id: `tab-${++tabCounter}`,
            url: 'about:blank',
            title: 'New Tab',
            isLoading: false,
          }
          setActiveTabId(newTab.id)
          return [newTab]
        }
        if (activeTabId === id) {
          setActiveTabId(filtered[filtered.length - 1].id)
        }
        return filtered
      })
    },
    [activeTabId]
  )

  const updateTab = useCallback(
    (id: string, updates: Partial<Omit<BrowserTab, 'id'>>) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      )
    },
    []
  )

  const navigateTab = useCallback(
    (id: string, url: string) => {
      updateTab(id, { url, isLoading: true })
    },
    [updateTab]
  )

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  return {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    updateTab,
    navigateTab,
  }
}
