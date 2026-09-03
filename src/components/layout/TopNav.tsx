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

interface Alerta {
  id: string
  tipo: string | null
  titulo: string | null
  mensagem: string | null
  severidade: string | null
  link_acao: string | null
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
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const temNotificacao = alertas.length > 0
  const [sinoAberto, setSinoAberto] = useState(false)
  const [menuAberto, setMenuAberto] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const sinoRef = useRef<HTMLDivElement>(null)

  // fecha o menu da conta ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!menuAberto) return
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAberto(false) }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAberto(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [menuAberto])

  // fecha o dropdown do sino ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!sinoAberto) return
    const onDoc = (e: MouseEvent) => { if (sinoRef.current && !sinoRef.current.contains(e.target as Node)) setSinoAberto(false) }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSinoAberto(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [sinoAberto])

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
      // sino real: alertas proativos ABERTOS (erp_alerta_proativo, RLS escopa por empresa).
      // Antes o sino acendia sempre (setTemNotificacao(true)) e não abria — botão morto com
      // urgência falsa. Agora o ponto vermelho só aparece se há alerta, e o clique mostra quais.
      // Corte de idade: o sino mostra alertas RECENTES (30 dias), mais novos primeiro. Alerta
      // aberto há meses não é notificação — é pendência esquecida, e vira ruído que o usuário
      // aprende a ignorar (o oposto do que queremos depois de consertar as falhas silenciosas).
      // O lugar de pendência antiga é a tela da área, não o sino.
      const corte = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data: al } = await supabase
        .from('erp_alerta_proativo')
        .select('id, tipo, titulo, mensagem, severidade, link_acao')
        .eq('resolvido', false).eq('dispensado', false)
        .gte('criado_em', corte)
        .order('criado_em', { ascending: false })
        .limit(12)
      if (!ignore) setAlertas((al as Alerta[]) ?? [])
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
        <div className="relative" ref={sinoRef}>
          <button
            type="button"
            aria-label="Notificações"
            aria-haspopup="menu"
            aria-expanded={sinoAberto}
            data-testid="bell-notifications"
            onClick={() => setSinoAberto((s) => !s)}
            className="relative w-9 h-9 rounded-lg hover:bg-[#3D2314]/8 flex items-center justify-center transition-colors text-[#3D2314]"
          >
            <Bell size={18} />
            {temNotificacao && (
              <span className="absolute top-[7px] right-[8px] w-[7px] h-[7px] bg-[#E24B4A] rounded-full ring-[1.5px] ring-[#FAF7F2]" />
            )}
          </button>
          {sinoAberto && (
            <div role="menu" className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-lg border border-[#3D2314]/10 py-1 z-30">
              <div className="px-4 py-2.5 border-b border-[#3D2314]/8 text-[10.5px] uppercase tracking-wide text-[#3D2314]/45">
                Notificações
              </div>
              {alertas.length === 0 ? (
                <div className="px-4 py-6 text-[12.5px] text-[#3D2314]/50 text-center">Nenhuma notificação no momento.</div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto">
                  {alertas.map((a) => {
                    const clicavel = !!a.link_acao
                    // Sem link → não parece clicável (sem hover, cursor default). Alerta que promete
                    // tela e não leva a lugar nenhum treina o usuário a não clicar — aqui é honesto:
                    // informativo, sem afordância de clique.
                    const corpo = (
                      <div className={`px-4 py-2.5 transition-colors border-b border-[#3D2314]/6 last:border-b-0 ${clicavel ? 'hover:bg-[#3D2314]/4 cursor-pointer' : 'cursor-default'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${a.severidade === 'alta' || a.severidade === 'critica' ? 'bg-[#E24B4A]' : 'bg-[#C8941A]'}`} />
                          <span className="text-[13px] font-medium text-[#3D2314] truncate">{a.titulo || 'Alerta'}</span>
                        </div>
                        {a.mensagem && <div className="text-[11.5px] text-[#3D2314]/55 mt-1 line-clamp-3">{a.mensagem}</div>}
                        {!clicavel && <div className="text-[10px] text-[#3D2314]/35 mt-1">— sem tela para abrir</div>}
                      </div>
                    )
                    return clicavel ? (
                      <Link key={a.id} href={a.link_acao!} onClick={() => setSinoAberto(false)}>{corpo}</Link>
                    ) : (
                      <div key={a.id}>{corpo}</div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

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
