'use client'
// Comunicador Interno da Equipe · widget FLUTUANTE global (vive no layout do dashboard, não numa rota →
// nunca some ao trocar de tela). Tempo real via Supabase Realtime (mensagens + presença). RD-26: reusa
// tenant_user_roles (equipe) e as RPCs fn_chat_* (RLS por membership). Design #819, mobile (tela cheia).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { MessageSquare, X, ChevronLeft, Send, Users, Minus, Bot } from 'lucide-react'

const ESP = '#3D2314', MUT = 'rgba(61,35,20,0.6)', BG = '#FAF7F2', LINE = '#E7DECF', GOLD = '#C8941A', GREEN = '#16A34A'

type Canal = { canal_id: string; tipo: string; nome: string; outro_user_id: string | null; ultima_msg: string | null; ultima_em: string | null; nao_lidas: number }
type Msg = { id: string; user_id: string | null; autor: string; texto: string; created_at: string; editado_em: string | null; is_ia?: boolean }
type Membro = { user_id: string; nome: string; email: string | null; role: string }

function horaCurta(iso?: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

export default function ChatWidget() {
  const { sel, companyIds } = useCompanyIds()
  const activeCompany = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : (companyIds.length === 1 ? companyIds[0] : null)

  const [meId, setMeId] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const [wide, setWide] = useState(true)
  const [view, setView] = useState<'lista' | 'conversa'>('lista')
  const [canalAtivo, setCanalAtivo] = useState<{ id: string; nome: string } | null>(null)
  const [canais, setCanais] = useState<Canal[]>([])
  const [equipe, setEquipe] = useState<Membro[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [online, setOnline] = useState<Set<string>>(new Set())
  const [texto, setTexto] = useState('')
  const [claudeTyping, setClaudeTyping] = useState(false)
  const [geralId, setGeralId] = useState<string | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const canalAtivoRef = useRef<string | null>(null)
  useEffect(() => { canalAtivoRef.current = canalAtivo?.id ?? null }, [canalAtivo])

  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null)) }, [])
  useEffect(() => {
    const onResize = () => setWide(typeof window !== 'undefined' && window.innerWidth >= 640)
    onResize(); window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize)
  }, [])

  const carregarCanais = useCallback(async () => {
    if (!activeCompany) return
    const { data } = await supabase.rpc('fn_chat_canais', { p_company_id: activeCompany })
    setCanais((data as Canal[] | null) ?? [])
  }, [activeCompany])

  const carregarMsgs = useCallback(async (canalId: string) => {
    const { data } = await supabase.rpc('fn_chat_mensagens', { p_canal_id: canalId, p_limit: 60, p_before: null })
    setMsgs((data as Msg[] | null) ?? [])
  }, [])

  // bootstrap + carga inicial + realtime (mensagens + presença) — por empresa ativa
  useEffect(() => {
    if (!activeCompany || !meId) return
    let alive = true
    ;(async () => {
      const { data: boot } = await supabase.rpc('fn_chat_bootstrap', { p_company_id: activeCompany })
      const gid = (boot as { ok?: boolean; geral_id?: string } | null)?.geral_id ?? null
      if (!alive) return
      setGeralId(gid)
      await carregarCanais()
      const { data: eq } = await supabase.rpc('fn_chat_equipe', { p_company_id: activeCompany })
      if (alive) setEquipe((eq as Membro[] | null) ?? [])
    })()

    const msgCh = supabase.channel(`chat:msgs:${activeCompany}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'erp_chat_mensagem', filter: `company_id=eq.${activeCompany}` },
        (payload: { new: { canal_id?: string } }) => {
          void carregarCanais()
          const cid = canalAtivoRef.current
          if (cid && payload.new?.canal_id === cid) { void carregarMsgs(cid); void supabase.rpc('fn_chat_marcar_lido', { p_canal_id: cid }) }
        })
      .subscribe()

    const presCh = supabase.channel(`chat:presence:${activeCompany}`, { config: { presence: { key: meId } } })
    presCh.on('presence', { event: 'sync' }, () => { setOnline(new Set(Object.keys(presCh.presenceState()))) })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void presCh.track({ at: Date.now() }) })

    return () => { alive = false; void supabase.removeChannel(msgCh); void supabase.removeChannel(presCh) }
  }, [activeCompany, meId, carregarCanais, carregarMsgs])

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, claudeTyping])

  const abrirCanal = async (id: string, nome: string) => {
    setCanalAtivo({ id, nome }); setView('conversa'); setMsgs([])
    await carregarMsgs(id)
    await supabase.rpc('fn_chat_marcar_lido', { p_canal_id: id })
    void carregarCanais()
  }
  const abrirDireta = async (m: Membro) => {
    if (!activeCompany) return
    const { data } = await supabase.rpc('fn_chat_direta_abrir', { p_company_id: activeCompany, p_user_destino: m.user_id })
    const r = data as { ok?: boolean; canal_id?: string } | null
    if (r?.ok && r.canal_id) await abrirCanal(r.canal_id, m.nome)
  }
  // @Claude no chat: só o remetente dispara (anti-loop natural — a IA nunca responde a is_ia).
  const perguntarClaude = useCallback(async (canalId: string, pergunta: string) => {
    if (!activeCompany) return
    setClaudeTyping(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      await fetch('/api/chat/ia', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: activeCompany, canal_id: canalId, pergunta }),
      })
      await carregarMsgs(canalId); void carregarCanais()
    } catch { /* silencioso: não quebra o chat */ } finally { setClaudeTyping(false) }
  }, [activeCompany, carregarMsgs, carregarCanais])

  const enviar = async () => {
    const t = texto.trim()
    if (!t || !canalAtivo) return
    setTexto('')
    await supabase.rpc('fn_chat_enviar', { p_canal_id: canalAtivo.id, p_texto: t })
    await carregarMsgs(canalAtivo.id)
    void carregarCanais()
    if (/@claude\b/i.test(t)) void perguntarClaude(canalAtivo.id, t)
  }

  const totalNaoLidas = useMemo(() => canais.reduce((s, c) => s + (c.nao_lidas || 0), 0), [canais])
  const diretas = canais.filter((c) => c.tipo === 'direta')
  const canalGeral = canais.find((c) => c.tipo === 'geral') || (geralId ? { canal_id: geralId, tipo: 'geral', nome: 'Equipe', outro_user_id: null, ultima_msg: null, ultima_em: null, nao_lidas: 0 } as Canal : null)

  if (!activeCompany) return null

  const painelStyle: React.CSSProperties = wide
    ? { position: 'fixed', right: 18, bottom: 150, zIndex: 940, width: 340, height: 480, borderRadius: 16 }
    : { position: 'fixed', inset: 0, zIndex: 940, borderRadius: 0 }

  return (
    <>
      {/* botão flutuante (acima do "?" da Ajuda) */}
      {!aberto && (
        <button onClick={() => { setAberto(true); void carregarCanais() }} aria-label="Chat da equipe"
          style={{ position: 'fixed', right: 18, bottom: 82, zIndex: 900, width: 52, height: 52, borderRadius: '50%', border: 'none', background: ESP, color: '#fff', cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <MessageSquare size={22} />
          {totalNaoLidas > 0 && (
            <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999, background: '#DC2626', color: '#fff', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>{totalNaoLidas > 99 ? '99+' : totalNaoLidas}</span>
          )}
        </button>
      )}

      {aberto && (
        <div style={{ ...painelStyle, background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 12px 40px rgba(0,0,0,.22)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: ESP, color: '#fff', flexShrink: 0 }}>
            {view === 'conversa' ? (
              <button onClick={() => { setView('lista'); setCanalAtivo(null); void carregarCanais() }} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'inline-flex' }}><ChevronLeft size={20} /></button>
            ) : <MessageSquare size={18} />}
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }} className="truncate">{view === 'conversa' ? (canalAtivo?.nome ?? 'Conversa') : 'Equipe'}</div>
            <button onClick={() => setAberto(false)} aria-label="Minimizar" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'inline-flex' }}><Minus size={18} /></button>
            <button onClick={() => { setAberto(false); setView('lista'); setCanalAtivo(null) }} aria-label="Fechar" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'inline-flex' }}><X size={18} /></button>
          </div>

          {view === 'lista' ? (
            <div style={{ flex: 1, overflowY: 'auto', background: BG }}>
              {canalGeral && (
                <ItemCanal nome="Equipe" sub={canalGeral.ultima_msg || 'Canal de toda a equipe'} badge={canalGeral.nao_lidas} hora={horaCurta(canalGeral.ultima_em)} icon={<Users size={16} />} onClick={() => void abrirCanal(canalGeral.canal_id, 'Equipe')} />
              )}
              {diretas.length > 0 && <Secao t="Conversas" />}
              {diretas.map((c) => (
                <ItemCanal key={c.canal_id} nome={c.nome} sub={c.ultima_msg || 'Sem mensagens ainda'} badge={c.nao_lidas} hora={horaCurta(c.ultima_em)}
                  dot={c.outro_user_id ? online.has(c.outro_user_id) : false} onClick={() => void abrirCanal(c.canal_id, c.nome)} />
              ))}
              <Secao t="Iniciar conversa" />
              {equipe.length === 0 ? (
                <div style={{ padding: '10px 14px', fontSize: 12.5, color: MUT }}>Você é a única pessoa ativa nesta empresa por enquanto.</div>
              ) : equipe.map((m) => (
                <ItemCanal key={m.user_id} nome={m.nome} sub={m.role} dot={online.has(m.user_id)} onClick={() => void abrirDireta(m)} />
              ))}
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: BG, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {msgs.length === 0 ? (
                  <div style={{ margin: 'auto', fontSize: 12.5, color: MUT, textAlign: 'center' }}>Nenhuma mensagem ainda. Diga um oi 👋</div>
                ) : msgs.map((m) => {
                  const meu = !m.is_ia && m.user_id === meId
                  if (m.is_ia) return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{ maxWidth: '88%', padding: '8px 11px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        background: 'linear-gradient(180deg,#FFFDF8,#fff)', color: ESP, border: `1px solid ${GOLD}` }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: GOLD, marginBottom: 3 }}>
                          <Bot size={12} /> Claude <span style={{ fontWeight: 600, color: MUT, fontSize: 9.5 }}>· gerado por IA</span>
                        </div>
                        {m.texto}
                        <div style={{ fontSize: 9.5, opacity: 0.65, marginTop: 2, textAlign: 'right' }}>{horaCurta(m.created_at)}</div>
                      </div>
                    </div>
                  )
                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: meu ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '82%', padding: '7px 11px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        background: meu ? GOLD : '#fff', color: meu ? '#fff' : ESP, border: meu ? 'none' : `0.5px solid ${LINE}` }}>
                        {!meu && <div style={{ fontSize: 10.5, fontWeight: 700, color: GOLD, marginBottom: 2 }}>{m.autor}</div>}
                        {m.texto}
                        <div style={{ fontSize: 9.5, opacity: 0.65, marginTop: 2, textAlign: 'right' }}>{horaCurta(m.created_at)}</div>
                      </div>
                    </div>
                  )
                })}
                {claudeTyping && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: GOLD, fontWeight: 600, background: 'linear-gradient(180deg,#FFFDF8,#fff)', border: `1px solid ${GOLD}`, borderRadius: 12, padding: '6px 11px' }}>
                      <Bot size={13} /> Claude está digitando…
                    </div>
                  </div>
                )}
                <div ref={fimRef} />
              </div>
              <div style={{ fontSize: 10.5, color: MUT, padding: '4px 12px 0', background: '#fff', flexShrink: 0 }}>Dica: comece com <strong style={{ color: GOLD }}>@Claude</strong> para perguntar à IA (ela responde no canal, pra todos).</div>
              <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: `1px solid ${LINE}`, background: '#fff', flexShrink: 0 }}>
                <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar() } }}
                  placeholder="Mensagem…  (ou @Claude …)" style={{ flex: 1, border: `1px solid ${LINE}`, borderRadius: 999, padding: '9px 14px', fontSize: 14, color: ESP, outline: 'none' }} />
                <button onClick={() => void enviar()} disabled={!texto.trim()} aria-label="Enviar"
                  style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: texto.trim() ? GOLD : LINE, color: '#fff', cursor: texto.trim() ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Send size={17} /></button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function Secao({ t }: { t: string }) {
  return <div style={{ padding: '10px 14px 4px', fontSize: 10.5, fontWeight: 800, color: MUT, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t}</div>
}

function ItemCanal({ nome, sub, badge, hora, dot, icon, onClick }: { nome: string; sub?: string; badge?: number; hora?: string; dot?: boolean; icon?: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ position: 'relative', width: 34, height: 34, borderRadius: '50%', background: '#F3E6C9', color: GOLD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 800, fontSize: 14 }}>
        {icon || (nome[0]?.toUpperCase() ?? '?')}
        {dot !== undefined && <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 999, background: dot ? GREEN : '#B8B0A4', border: '2px solid #fff' }} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: ESP }} className="truncate">{nome}</span>
        {sub && <span style={{ display: 'block', fontSize: 11.5, color: MUT }} className="truncate">{sub}</span>}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        {hora && <span style={{ fontSize: 10, color: MUT }}>{hora}</span>}
        {!!badge && badge > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: '#DC2626', color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{badge > 99 ? '99+' : badge}</span>}
      </span>
    </button>
  )
}
