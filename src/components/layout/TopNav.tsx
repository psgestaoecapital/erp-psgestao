'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, LogOut } from 'lucide-react'
import MobileDrawer from './MobileDrawer'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

interface UserResumo {
  email: string
  iniciais: string
}

// BRAND-1 · iniciais da empresa quando ela não tem logo (nunca espaço vazio nem imagem quebrada)
function iniciaisDe(nome: string): string {
  const partes = nome.split(/\s+/).filter(Boolean)
  const ini = partes.slice(0, 2).map((p) => p[0]).join('')
  return (ini || nome[0] || '').toUpperCase()
}

export default function TopNav() {
  const [user, setUser] = useState<UserResumo | null>(null)
  // BRAND-1 · logo da EMPRESA SELECIONADA no topo (troca junto com o seletor). Multi-empresa: cada
  // empresa mostra o seu; consolidado/grupo não mostra logo de empresa (não é de uma só).
  const { selInfo, sel, companies } = useCompanyIds()
  const empresaRow = selInfo.tipo === 'empresa' ? companies.find((c) => c.id === sel) : null
  const empresaNome = selInfo.tipo === 'empresa' ? selInfo.nome : ''
  const empresaLogo: string | null = (empresaRow?.logo_url as string | undefined) || null
  const [temNotificacao, setTemNotificacao] = useState(false)
  const [menuAberto, setMenuAberto] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // fecha o menu da conta ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!menuAberto) return
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAberto(false) }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAberto(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [menuAberto])

  // Logout: encerra a sessão Supabase e volta pro login (raiz `/` é a tela de login).
  // window.location garante estado limpo (zera caches/estados do app).
  const sair = async () => {
    try { await supabase.auth.signOut() } finally { window.location.href = '/' }
  }

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser?.email && !ignore) {
        const partes = authUser.email.split('@')[0].split('.')
        const iniciais = (partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')
        setUser({
          email: authUser.email,
          iniciais: iniciais.toUpperCase() || authUser.email[0].toUpperCase(),
        })
      }
      if (!ignore) setTemNotificacao(true)
    })()
    return () => { ignore = true }
  }, [])

  return (
    <header className="sticky top-0 z-20 bg-[#FAF7F2] border-b border-[#3D2314]/10 h-14 px-3 sm:px-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="md:hidden bg-[#3D2314] rounded-lg">
          <MobileDrawer />
        </div>
        <Link
          href="/dashboard/home"
          className="md:hidden flex items-center gap-2 text-[#3D2314]"
        >
          <span className="w-8 h-8 bg-[#C8941A] rounded-md flex items-center justify-center text-[#3D2314] font-medium text-[12px]">
            PS
          </span>
          <span className="text-[14px] font-medium">PS Gestão</span>
        </Link>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* BRAND-1 · logo/iniciais da empresa selecionada, à esquerda do sino */}
        {selInfo.tipo === 'empresa' && (
          <div className="flex items-center pr-1 sm:pr-2 sm:border-r sm:border-[#3D2314]/10" title={empresaNome} data-testid="topnav-empresa-logo">
            {empresaLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={empresaLogo} alt={empresaNome} className="h-6 sm:h-8 w-auto max-w-[92px] sm:max-w-[128px] object-contain" />
            ) : (
              <span className="w-8 h-8 rounded-full bg-[#C8941A] text-[#3D2314] font-medium text-[12px] flex items-center justify-center ring-[1.5px] ring-[#3D2314]/15">
                {iniciaisDe(empresaNome)}
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          aria-label="Notificações"
          data-testid="bell-notifications"
          className="relative w-9 h-9 rounded-lg hover:bg-[#3D2314]/8 flex items-center justify-center transition-colors text-[#3D2314]"
        >
          <Bell size={18} />
          {temNotificacao && (
            <span className="absolute top-[7px] right-[8px] w-[7px] h-[7px] bg-[#E24B4A] rounded-full ring-[1.5px] ring-[#FAF7F2]" />
          )}
        </button>

        {user && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label={`Conta de ${user.email}`}
              aria-haspopup="menu"
              aria-expanded={menuAberto}
              data-testid="user-avatar"
              onClick={() => setMenuAberto((v) => !v)}
              className="w-9 h-9 rounded-full bg-[#C8941A] text-[#3D2314] font-medium text-[13px] flex items-center justify-center hover:opacity-95 transition-opacity ring-[1.5px] ring-[#3D2314]/15"
            >
              {user.iniciais}
            </button>
            {menuAberto && (
              <div role="menu" className="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-lg border border-[#3D2314]/10 py-1 z-30">
                <div className="px-4 py-2.5 border-b border-[#3D2314]/8">
                  <div className="text-[10.5px] uppercase tracking-wide text-[#3D2314]/45">Conectado como</div>
                  <div className="text-[13px] font-medium text-[#3D2314] truncate">{user.email}</div>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="logout-button"
                  onClick={() => { setMenuAberto(false); void sair() }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-[#A32D2D] hover:bg-[#A32D2D]/8 transition-colors text-left"
                >
                  <LogOut size={15} /> Sair
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
