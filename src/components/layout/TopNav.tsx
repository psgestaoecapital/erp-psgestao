'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, ChevronDown } from 'lucide-react'
import TopNavDropdown from './TopNavDropdown'
import MobileDrawer from './MobileDrawer'
import { DASHBOARD_MENU_GROUPS } from '@/lib/menu/dashboard-menu-config'
import { supabase } from '@/lib/supabase'

interface EmpresaResumo {
  id: string
  nome: string
}

interface UserResumo {
  email: string
  iniciais: string
}

interface CompanyRow {
  id: string
  nome_fantasia: string | null
  razao_social: string | null
}

export default function TopNav() {
  const [empresaAtual, setEmpresaAtual] = useState<EmpresaResumo | null>(null)
  const [empresas, setEmpresas] = useState<EmpresaResumo[]>([])
  const [empresaOpen, setEmpresaOpen] = useState(false)
  const [user, setUser] = useState<UserResumo | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser?.email) {
        const partes = authUser.email.split('@')[0].split('.')
        const iniciais = (partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')
        if (!ignore) setUser({ email: authUser.email, iniciais: iniciais.toUpperCase() || authUser.email[0].toUpperCase() })
      }

      const { data: roleData } = authUser
        ? await supabase.from('users').select('role').eq('id', authUser.id).maybeSingle()
        : { data: null }

      let rows: CompanyRow[] = []
      if (roleData?.role === 'adm' || roleData?.role === 'acesso_total') {
        const { data } = await supabase
          .from('companies')
          .select('id, nome_fantasia, razao_social')
          .order('nome_fantasia')
        rows = (data ?? []) as CompanyRow[]
      } else if (authUser) {
        const { data } = await supabase
          .from('user_companies')
          .select('companies(id, nome_fantasia, razao_social)')
          .eq('user_id', authUser.id)
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

  function trocarEmpresa(empresa: EmpresaResumo) {
    setEmpresaAtual(empresa)
    setEmpresaOpen(false)
    if (typeof window !== 'undefined') {
      localStorage.setItem('ps_empresa_sel', empresa.id)
      window.location.reload()
    }
  }

  return (
    <header className="sticky top-0 z-30 bg-[#3D2314] text-[#FAF7F2] border-b border-white/10">
      <div className="flex items-center h-14 px-3 gap-1">
        <MobileDrawer />

        <Link href="/dashboard" className="flex items-center gap-2.5 px-2 mr-2 border-r border-white/15 h-full pr-3">
          <div className="w-8 h-8 bg-[#C8941A] rounded-md flex items-center justify-center text-[#3D2314] font-bold text-sm">
            PS
          </div>
          <div className="text-sm font-medium leading-tight hidden sm:block">
            PS Gestão
            <div className="text-[10px] text-[#FAF7F2]/60 tracking-wider">CAPITAL &amp; ERP</div>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-0.5">
          {DASHBOARD_MENU_GROUPS.map((group) => (
            <TopNavDropdown key={group.id} group={group} />
          ))}
        </nav>

        <div className="flex-1" />

        {empresaAtual && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setEmpresaOpen((o) => !o)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-xs"
            >
              <span className="w-1.5 h-1.5 bg-[#C8941A] rounded-full" />
              <span className="hidden sm:inline truncate max-w-[140px]">{empresaAtual.nome}</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>
            {empresaOpen && (
              <div className="absolute top-full right-0 mt-1 min-w-[240px] bg-[#FAF7F2] border border-[#3D2314]/15 rounded-lg shadow-lg p-1.5 z-50">
                {empresas.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => trocarEmpresa(e)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm text-[#3D2314] hover:bg-[#C8941A]/10 ${
                      e.id === empresaAtual.id ? 'bg-[#C8941A]/10 font-medium' : ''
                    }`}
                  >
                    {e.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          aria-label="Notificações"
          className="w-10 h-10 rounded-md hover:bg-white/10 flex items-center justify-center"
        >
          <Bell size={18} />
        </button>

        {user && (
          <button
            type="button"
            aria-label={`Conta de ${user.email}`}
            className="w-9 h-9 rounded-full bg-[#C8941A] text-[#3D2314] font-bold text-xs flex items-center justify-center hover:opacity-90"
          >
            {user.iniciais}
          </button>
        )}
      </div>
    </header>
  )
}
