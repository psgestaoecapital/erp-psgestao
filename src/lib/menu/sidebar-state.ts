'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'ps-sidebar-expanded-module'

export function useSidebarState() {
  const [expandedModule, setExpandedModule] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setExpandedModule(saved)
    } catch {
      // localStorage indisponivel
    }
    setIsHydrated(true)
  }, [])

  function persist(next: string | null) {
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignora
    }
  }

  function toggleModule(moduleId: string) {
    const next = expandedModule === moduleId ? null : moduleId
    setExpandedModule(next)
    persist(next)
  }

  function setActiveModule(moduleId: string) {
    setExpandedModule(moduleId)
    persist(moduleId)
  }

  return { expandedModule, toggleModule, setActiveModule, isHydrated }
}
