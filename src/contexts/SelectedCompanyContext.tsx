'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type SelectedCompany = {
  id: string
  nome_fantasia: string
  is_bpo_cliente?: boolean
} | null

type Ctx = {
  selected: SelectedCompany
  setSelected: (c: SelectedCompany) => void
  clear: () => void
}

const SelectedCompanyContext = createContext<Ctx | undefined>(undefined)

export function SelectedCompanyProvider({ children }: { children: ReactNode }) {
  const [selected, setSelectedState] = useState<SelectedCompany>(null)

  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('psgc_selected_company') : null
      if (saved) setSelectedState(JSON.parse(saved))
    } catch {
      // localStorage indisponivel ou JSON corrompido - ignora
    }
  }, [])

  function setSelected(c: SelectedCompany) {
    setSelectedState(c)
    try {
      if (typeof window === 'undefined') return
      if (c) localStorage.setItem('psgc_selected_company', JSON.stringify(c))
      else localStorage.removeItem('psgc_selected_company')
    } catch {
      // localStorage cheio ou bloqueado - ignora silenciosamente
    }
  }

  function clear() {
    setSelected(null)
  }

  return (
    <SelectedCompanyContext.Provider value={{ selected, setSelected, clear }}>
      {children}
    </SelectedCompanyContext.Provider>
  )
}

export function useSelectedCompany() {
  const ctx = useContext(SelectedCompanyContext)
  if (!ctx) throw new Error('useSelectedCompany requer SelectedCompanyProvider')
  return ctx
}
