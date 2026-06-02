'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import AreaSwitcher from './AreaSwitcher'

interface EmpresaResumo {
  id: string
  nome: string
}

interface CompanyRow {
  id: string
  nome_fantasia: string | null
  razao_social: string | null
}

export default function SidebarHeader() {
  const [empresaAtual, setEmpresaAtual] = useState<EmpresaResumo | null>(null)
  const [empresas, setEmpresas] = useState<EmpresaResumo[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: roleData } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
      let rows: CompanyRow[] = []
      if (roleData?.role === 'adm' || roleData?.role === 'acesso_total') {
        const { data } = await supabase.from('companies').select('id, nome_fantasia, razao_social').order('nome_fantasia')
        rows = (data ?? []) as CompanyRow[]
      } else {
        const { data } = await supabase
          .from('user_companies')
          .select('companies(id, nome_fantasia, razao_social)')
          .eq('user_id', user.id)
        const flat = (data ?? []) as unknown as Array<{ companies: CompanyRow | CompanyRow[] | null }>
        rows = flat.flatMap((u) => (Array.isArray(u.companies) ? u.companies : u.companies ? [u.companies] : []))
      }
      if (ignore) return
      const lista: EmpresaResumo[] = rows.map((c) => ({
        id: c.id,
        nome: c.nome_fantasia || c.razao_social || c.id,
      }))
      setEmpresas(lista)
      const atualId = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : null
      const atual = lista.find((e) => e.id === atualId) ?? lista[0]
      if (atual) setEmpresaAtual(atual)
    })()
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function trocarEmpresa(e: EmpresaResumo) {
    setEmpresaAtual(e)
    setOpen(false)
    if (typeof window !== 'undefined') {
      localStorage.setItem('ps_empresa_sel', e.id)
      window.location.reload()
    }
  }

  return (
    <div className="border-b border-[#4D2E1D]">
      <Link href="/dashboard/home" className="block px-4 pt-4 pb-3 hover:opacity-90 transition-opacity">
        <div className="text-[16px] font-medium text-[#FAF7F2] leading-tight">PS Gestão</div>
        <div className="text-[10px] text-[#FAF7F2]/60 uppercase tracking-[1px] mt-0.5">Capital · ERP</div>
      </Link>

      <div className="px-3 pb-3 space-y-2">
        {empresaAtual && (
          <div ref={ref} className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-haspopup="true"
              data-testid="empresa-switcher"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#C8941A]/12 hover:bg-[#C8941A]/18 border border-[#C8941A]/30 text-[12px] font-medium text-[#FAF7F2] transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-[7px] h-[7px] bg-[#C8941A] rounded-full flex-shrink-0" />
                <span className="truncate">{empresaAtual.nome}</span>
              </span>
              <ChevronDown size={12} className="opacity-70 flex-shrink-0" />
            </button>
            {open && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#FAF7F2] rounded-lg p-1.5 z-50 shadow-[0_12px_32px_rgba(0,0,0,0.45)] max-h-[280px] overflow-y-auto">
                {empresas.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => trocarEmpresa(e)}
                    className={`w-full text-left px-2.5 py-2 rounded-md text-[12.5px] font-medium text-[#3D2314] hover:bg-[#C8941A]/10 transition-colors flex items-center gap-2 ${
                      e.id === empresaAtual.id ? 'bg-[#C8941A]/10' : ''
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${e.id === empresaAtual.id ? 'bg-[#C8941A]' : 'border border-[#3D2314]/20'}`} />
                    <span className="truncate">{e.nome}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <AreaSwitcher />
      </div>
    </div>
  )
}
