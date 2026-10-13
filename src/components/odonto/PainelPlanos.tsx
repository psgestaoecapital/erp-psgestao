'use client'
// SPEC · Painel de Planos & Orçamentos — o funil comercial da clínica (todos os pacientes). KPIs + lista
// filtrável + ações. Read-only via fn_odonto_planos_clinica. A criação/edição do plano continua na Ficha
// (fonte única, OD-2); aqui é gestão. Enviar por WhatsApp reusa IA-1.5 (fn_odonto_proposta_criar). #819.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Search, Plus, TrendingUp, MessageCircle, ArrowRight, CalendarClock } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)', GREEN = '#166534', RED = '#A32D2D', AMBER = '#B45309'
const money = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dbr = (s: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('pt-BR') } catch { return '—' } }

type Plano = { id: string; paciente_id: string; paciente_nome: string; titulo: string; valor_total: number; status: string; created_at: string | null; aprovado_em: string | null; profissional_nome: string; itens_total: number; itens_feitos: number; tem_agendamento: boolean; envio_status: string | null }
type Kpis = { em_aberto: number; aprovados_mes_qtd: number; aprovados_mes_valor: number; taxa_aprovacao: number; aprovados_sem_agendar: number; ticket_medio: number }

const ST: Record<string, { l: string; cor: string; bg: string }> = {
  rascunho: { l: 'Rascunho', cor: ESP60, bg: '#F1F1F0' },
  orcamento: { l: 'Orçamento', cor: '#8A6A1E', bg: '#FBF3DE' },
  aprovado: { l: 'Aprovado', cor: GREEN, bg: '#E7F3EA' },
  em_andamento: { l: 'Em andamento', cor: '#1D4ED8', bg: '#EAF0FE' },
  concluido: { l: 'Concluído', cor: ESP60, bg: '#F1F1F0' },
  recusado: { l: 'Recusado', cor: RED, bg: '#FBEBEB' },
  cancelado: { l: 'Cancelado', cor: '#9CA3AF', bg: '#F4F3F1' },
}
const ENVIO: Record<string, { l: string; cor: string }> = {
  enviada: { l: 'Enviada', cor: '#1D4ED8' }, vista: { l: 'Vista', cor: AMBER }, aceita: { l: 'Aceita ✓', cor: GREEN }, recusada: { l: 'Recusada', cor: RED }, expirada: { l: 'Expirada', cor: '#9CA3AF' },
}
const FILTROS = [{ v: '', l: 'Todos' }, { v: 'orcamento', l: 'Orçamentos' }, { v: 'aprovado', l: 'Aprovados' }, { v: 'em_andamento', l: 'Em andamento' }, { v: 'concluido', l: 'Concluídos' }, { v: 'recusado', l: 'Recusados' }]

function Kpi({ valor, label, cor, destaque }: { valor: string; label: string; cor?: string; destaque?: boolean }) {
  return (
    <div style={{ background: destaque ? '#FBEBEB' : '#fff', border: `1px solid ${destaque ? RED : LINE}`, borderRadius: 14, padding: '11px 14px', minWidth: 130, flex: 1 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: cor || ESP, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 11.5, color: ESP60, marginTop: 2 }}>{label}</div>
    </div>
  )
}

export function PainelPlanos({ companyId, pacs, busca, setBusca, onEscolher }: {
  companyId: string
  pacs: { id: string; nome: string }[]
  busca: string
  setBusca: (s: string) => void
  onEscolher: (p: { id: string; nome: string }) => void
}) {
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [planos, setPlanos] = useState<Plano[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [q, setQ] = useState('')
  const [waBusy, setWaBusy] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)

  const carregar = useCallback(async (status: string) => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_odonto_planos_clinica', { p_company_id: companyId, p_status: status || null, p_de: null, p_ate: null })
    const r = data as { ok?: boolean; kpis?: Kpis; planos?: Plano[] } | null
    if (r?.ok) { setKpis(r.kpis ?? null); setPlanos(r.planos ?? []) }
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar(filtro) }, [carregar, filtro])

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? planos.filter((p) => p.paciente_nome.toLowerCase().includes(t) || p.titulo.toLowerCase().includes(t)) : planos
  }, [planos, q])

  const enviarWhatsApp = async (p: Plano) => {
    setWaBusy(p.id)
    try {
      const { data } = await supabase.rpc('fn_odonto_proposta_criar', { p_company_id: companyId, p_plano_id: p.id, p_parcelas: 1, p_entrada: 0, p_forma: 'boleto' })
      const r = data as { ok?: boolean; token?: string; erro?: string } | null
      if (!r?.ok || !r.token) { alert(r?.erro || 'Falha ao gerar o link.'); return }
      const link = `${window.location.origin}/p/orcamento/${r.token}`
      const { data: pd } = await supabase.from('erp_odonto_paciente').select('celular, telefone').eq('id', p.paciente_id).maybeSingle()
      const pf = pd as { celular?: string | null; telefone?: string | null } | null
      const fone = String(pf?.celular || pf?.telefone || '').replace(/\D/g, '')
      const msg = `Olá! Segue o seu orçamento de tratamento odontológico: ${link}\n\nÉ rápido de ver pelo celular e você pode aceitar por aí. Qualquer dúvida, estou à disposição! 🦷`
      const base = fone ? `https://wa.me/${fone.length <= 11 ? '55' + fone : fone}?text=` : 'https://wa.me/?text='
      window.open(base + encodeURIComponent(msg), '_blank')
      void carregar(filtro)
    } finally { setWaBusy(null) }
  }

  return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>Plano de tratamento</div>
          <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Planos & Orçamentos</h1>
        </div>
        <button onClick={() => setNovo((v) => !v)} className="px-3 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-1" style={{ background: GOLD, color: '#fff' }}>
          <Plus size={15} /> Novo orçamento
        </button>
      </div>

      {/* Novo: busca de paciente → abre o construtor na Ficha (fonte única) */}
      {novo && (
        <div className="rounded-xl p-3 mb-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <div className="text-xs mb-2" style={{ color: ESP60 }}>Escolha o paciente para montar o orçamento (a criação é na Ficha):</div>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ border: `1px solid ${LINE}` }}>
            <Search size={15} style={{ color: ESP60 }} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar paciente por nome…" className="flex-1 outline-none text-sm" style={{ color: ESP }} />
          </div>
          {pacs.length > 0 && (
            <div className="mt-2">
              {pacs.map((p) => (
                <button key={p.id} onClick={() => onEscolher(p)} className="w-full text-left px-3 py-2 rounded-lg mb-1 text-sm" style={{ background: BG, border: `1px solid ${LINE}` }}>{p.nome}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="flex gap-2 flex-wrap mb-3">
        <Kpi valor={money(kpis?.em_aberto ?? 0)} label="Em aberto (orçamentos)" cor={GOLD} />
        <Kpi valor={`${kpis?.aprovados_mes_qtd ?? 0} · ${money(kpis?.aprovados_mes_valor ?? 0)}`} label="Aprovados no mês" cor={GREEN} />
        <Kpi valor={`${kpis?.taxa_aprovacao ?? 0}%`} label="Taxa de aprovação" />
        <Kpi valor={String(kpis?.aprovados_sem_agendar ?? 0)} label="Aprovados sem agendar" cor={RED} destaque={(kpis?.aprovados_sem_agendar ?? 0) > 0} />
        <Kpi valor={money(kpis?.ticket_medio ?? 0)} label="Ticket médio" />
      </div>

      {/* filtros */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 flex-1" style={{ background: '#fff', border: `1px solid ${LINE}`, minWidth: 200 }}>
          <Search size={15} style={{ color: ESP60 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por paciente ou título…" className="flex-1 outline-none text-sm" style={{ color: ESP }} />
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTROS.map((f) => (
            <button key={f.v} onClick={() => setFiltro(f.v)} className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: filtro === f.v ? GOLD : '#fff', color: filtro === f.v ? '#fff' : ESP, border: `1px solid ${filtro === f.v ? GOLD : LINE}` }}>{f.l}</button>
          ))}
        </div>
      </div>

      {/* lista */}
      {loading ? (
        <div style={{ color: ESP60, fontSize: 13 }} className="py-8 text-center">Carregando o funil…</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl px-6 py-12 text-center" style={{ border: `1px dashed ${LINE}` }}>
          <TrendingUp size={26} style={{ color: ESP60, margin: '0 auto 8px' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: ESP }}>Nenhum orçamento ainda</div>
          <div style={{ fontSize: 13, color: ESP60, marginTop: 4 }}>Crie o primeiro na Ficha do paciente (botão “Novo orçamento” acima).</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {lista.map((p) => {
            const s = ST[p.status] ?? ST.orcamento
            const pct = p.itens_total > 0 ? Math.round((p.itens_feitos / p.itens_total) * 100) : 0
            const env = p.envio_status ? ENVIO[p.envio_status] : null
            const aprovadoSemAgendar = p.status === 'aprovado' && !p.tem_agendamento
            return (
              <div key={p.id} className="rounded-2xl p-3 sm:p-4" style={{ background: '#fff', border: `1px solid ${aprovadoSemAgendar ? RED : LINE}` }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: ESP }} className="truncate">{p.paciente_nome}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.cor }}>{s.l}</span>
                      {env && <span style={{ fontSize: 10.5, fontWeight: 700, color: env.cor }}>· envio: {env.l}</span>}
                      {aprovadoSemAgendar && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: RED }}><CalendarClock size={11} /> sem agendamento</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: ESP60, marginTop: 2 }} className="truncate">
                      {p.titulo}{p.profissional_nome ? ` · ${p.profissional_nome}` : ''} · {dbr(p.created_at)}
                      {p.itens_total > 0 ? ` · ${pct}% executado (${p.itens_feitos}/${p.itens_total})` : ''}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div style={{ fontSize: 16, fontWeight: 700, color: GOLD, fontVariantNumeric: 'tabular-nums' }}>{money(Number(p.valor_total))}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Link href={`/dashboard/odonto/pacientes/${p.paciente_id}?aba=orcamentos`} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP, textDecoration: 'none' }}>
                    Abrir na Ficha <ArrowRight size={13} />
                  </Link>
                  <button onClick={() => void enviarWhatsApp(p)} disabled={waBusy === p.id} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-50" style={{ background: '#25D366', color: '#fff', border: 'none' }}>
                    <MessageCircle size={13} /> {waBusy === p.id ? 'Gerando…' : 'Enviar WhatsApp'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
