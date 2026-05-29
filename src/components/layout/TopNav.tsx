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
  const [temNotificacao, setTemNotificacao] = useState(false)

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
      setTemNotificacao(true)
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
    <header className="sticky top-0 z-30 bg-[#3D2314] text-[#FAF7F2] shadow-[0_1px_0_rgba(200,148,26,0.18)]">
      <div className="flex items-center h-[60px] px-4 gap-1">
        <MobileDrawer />

        <Link
          href="/dashboard"
          className="flex items-center gap-3 pr-4 mr-3 h-full border-r border-[#C8941A]/25 hover:opacity-90 transition-opacity"
        >
          <div className="w-9 h-9 bg-[#C8941A] rounded-[7px] flex items-center justify-center text-[#3D2314] font-medium text-[13px] shadow-[0_0_0_1.5px_rgba(200,148,26,0.25)]">
            PS
          </div>
          <div className="hidden sm:block leading-[1.15]">
            <div className="text-[13px] font-medium tracking-[0.2px]">PS Gestão</div>
            <div className="text-[9.5px] text-[#FAF7F2]/70 tracking-[1px] font-medium">CAPITAL · ERP</div>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-0.5">
          {DASHBOARD_MENU_GROUPS.map((group) => (
            <TopNavDropdown key={group.id} group={group} />
          ))}
        </nav>

        <div className="flex-1" />

        {empresaAtual && (
          <div className="relative mr-2">
            <button
              type="button"
              onClick={() => setEmpresaOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={empresaOpen}
              className="flex items-center gap-2.5 pl-3 pr-3 py-[7px] rounded-full bg-[#C8941A]/12 hover:bg-[#C8941A]/18 border border-[#C8941A]/30 text-[12px] font-medium transition-colors"
            >
              <span className="w-[7px] h-[7px] bg-[#C8941A] rounded-full shadow-[0_0_0_2px_rgba(200,148,26,0.25)]" />
              <span className="hidden sm:inline truncate max-w-[160px]">{empresaAtual.nome}</span>
              <ChevronDown size={12} className="opacity-70" />
            </button>
            {empresaOpen && (
              <div className="absolute top-full right-0 mt-2 min-w-[260px] bg-[#FAF7F2] rounded-2xl p-2 z-50 shadow-[0_1px_2px_rgba(61,35,20,0.05),0_16px_40px_rgba(61,35,20,0.18),0_0_0_0.5px_rgba(61,35,20,0.08)]">
                <div className="px-3 py-2 text-[10px] text-[#3D2314]/55 tracking-[0.8px] font-medium">
                  TROCAR DE EMPRESA
                </div>
                {empresas.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => trocarEmpresa(e)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-medium text-[#3D2314] hover:bg-[#C8941A]/10 transition-colors flex items-center gap-2.5 ${
                      e.id === empresaAtual.id ? 'bg-[#C8941A]/10' : ''
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${e.id === empresaAtual.id ? 'bg-[#C8941A]' : 'bg-transparent border border-[#3D2314]/20'}`} />
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
          className="relative w-9 h-9 rounded-lg hover:bg-[#C8941A]/12 flex items-center justify-center transition-colors mr-1"
        >
          <Bell size={18} />
          {temNotificacao && (
            <span className="absolute top-[7px] right-[8px] w-[7px] h-[7px] bg-[#E24B4A] rounded-full ring-[1.5px] ring-[#3D2314]" />
          )}
        </button>

        {user && (
          <button
            type="button"
            aria-label={`Conta de ${user.email}`}
            className="w-9 h-9 rounded-full bg-[#C8941A] text-[#3D2314] font-medium text-[13px] flex items-center justify-center hover:opacity-95 transition-opacity ring-[1.5px] ring-[#FAF7F2]/95 shadow-[0_0_0_3px_rgba(200,148,26,0.35)]"
          >
            {user.iniciais}
          </button>
        )}
      </div>
    </header>
  )
}
