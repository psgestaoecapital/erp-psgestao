'use client'

// O4.1 · Obras — board de andamento. A obra NASCE do orçamento aprovado/convertido (trigger no banco).
// Tudo vem de fn_obras_kpis / fn_obras_listar por company_id (RD-38: nada fixo). 3 estados: erro / vazio
// (ensina) / dados. Linguagem da casa (CONCLUIU obra) · identidade Espresso · mobile-first.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', AMBAR = '#B45309', VERM = '#B91C1C'

type Obra = {
  id: string; numero: string; nome: string; cliente_nome: string | null; status: string
  valor_previsto: number; pct_conclusao: number; cidade: string | null; uf: string | null
  responsavel_nome: string | null; data_inicio: string | null; data_prevista_fim: string | null; data_conclusao: string | null
}
type Kpis = { em_andamento: number; concluidas: number; valor_em_andamento: number; valor_concluido: number }

const ST: Record<string, { label: string; cor: string }> = {
  em_andamento: { label: 'Em andamento', cor: GOLD },
  pausada: { label: 'Pausada', cor: AMBAR },
  concluida: { label: 'Concluída', cor: VERDE },
  cancelada: { label: 'Cancelada', cor: VERM },
}
const PROXIMOS: Record<string, { s: string; l: string }[]> = {
  em_andamento: [{ s: 'concluida', l: 'Concluir' }, { s: 'pausada', l: 'Pausar' }, { s: 'cancelada', l: 'Cancelar' }],
  pausada: [{ s: 'em_andamento', l: 'Retomar' }, { s: 'cancelada', l: 'Cancelar' }],
  concluida: [{ s: 'em_andamento', l: 'Reabrir' }],
  cancelada: [{ s: 'em_andamento', l: 'Reabrir' }],
}

export default function ObrasPage() {
  const { companyIds } = useCompanyIds()
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<'principais' | 'outras'>('principais')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    const [{ data: k, error: ek }, { data: l, error: el }] = await Promise.all([
      supabase.rpc('fn_obras_kpis', { p_company_ids: companyIds }),
      supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null }),
    ])
    setLoading(false)
    if (ek || el) { setErro((ek ?? el)!.message); return }
    setKpis(k as Kpis); setObras((l as Obra[]) ?? [])
  }, [companyIds])

  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function mudarStatus(o: Obra, novo: string) {
    setBusy(o.id); setMsg('')
    const { error } = await supabase.rpc('fn_obra_mudar_status', { p_obra_id: o.id, p_novo_status: novo })
    setBusy('')
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg(novo === 'concluida' ? `CONCLUIU a obra ${o.numero}.` : `Obra ${o.numero} → ${ST[novo]?.label ?? novo}.`)
    void carregar()
  }

  const grupos = useMemo(() => ({
    em_andamento: obras.filter((o) => o.status === 'em_andamento'),
    concluida: obras.filter((o) => o.status === 'concluida'),
    pausada: obras.filter((o) => o.status === 'pausada'),
    cancelada: obras.filter((o) => o.status === 'cancelada'),
  }), [obras])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Hub · Construção</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 14px' }}>Obras</h1>

        {msg && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 12, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 16 }}>
          <PSGCMetric label="Em andamento" valor={kpis?.em_andamento ?? 0} icon="🏗️" cor={GOLD} corBg="#FFF" />
          <PSGCMetric label="Concluídas" valor={kpis?.concluidas ?? 0} icon="✅" cor={VERDE} corBg="#FFF" />
          <PSGCMetric label="Valor em andamento" valor={fmtR(kpis?.valor_em_andamento ?? 0)} icon="💰" cor={ESP} corBg="#FFF" />
          <PSGCMetric label="Valor concluído" valor={fmtR(kpis?.valor_concluido ?? 0)} icon="🏁" cor={VERDE} corBg="#FFF" />
        </div>

        {/* ESTADO: erro */}
        {erro ? (
          <Aviso cor={VERM} titulo="Não deu para carregar as obras" texto={erro} />
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
        ) : obras.length === 0 ? (
          /* ESTADO: vazio (ensina) */
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>🏗️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 6 }}>Nenhuma obra ainda</div>
            <div style={{ fontSize: 13, color: MUT, maxWidth: 440, margin: '8px auto 0', lineHeight: 1.5 }}>
              Uma obra nasce automaticamente quando um orçamento é <b>aprovado</b>. Aprove um orçamento em Propostas para ver a obra aqui.
            </div>
            <Link href="/dashboard/projetos/propostas" style={{ display: 'inline-block', marginTop: 14, padding: '9px 16px', borderRadius: 8, background: ESP, color: '#FFF', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Ir para Propostas</Link>
          </div>
        ) : (
          /* ESTADO: dados */
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <Tab ativo={aba === 'principais'} onClick={() => setAba('principais')}>Em andamento · Concluídas</Tab>
              {(grupos.pausada.length + grupos.cancelada.length > 0) && (
                <Tab ativo={aba === 'outras'} onClick={() => setAba('outras')}>Pausadas · Canceladas ({grupos.pausada.length + grupos.cancelada.length})</Tab>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14, alignItems: 'start' }}>
              {aba === 'principais' ? (
                <>
                  <Coluna titulo="Em andamento" cor={GOLD} obras={grupos.em_andamento} onStatus={mudarStatus} busy={busy} />
                  <Coluna titulo="Concluídas" cor={VERDE} obras={grupos.concluida} onStatus={mudarStatus} busy={busy} />
                </>
              ) : (
                <>
                  <Coluna titulo="Pausadas" cor={AMBAR} obras={grupos.pausada} onStatus={mudarStatus} busy={busy} />
                  <Coluna titulo="Canceladas" cor={VERM} obras={grupos.cancelada} onStatus={mudarStatus} busy={busy} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Coluna({ titulo, cor, obras, onStatus, busy }: { titulo: string; cor: string; obras: Obra[]; onStatus: (o: Obra, s: string) => void; busy: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: cor, fontWeight: 700, marginBottom: 8 }}>{titulo} · {obras.length}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {obras.length === 0 ? <div style={{ fontSize: 12, color: MUT, fontStyle: 'italic' }}>—</div> :
          obras.map((o) => <ObraCard key={o.id} o={o} onStatus={onStatus} busy={busy === o.id} />)}
      </div>
    </div>
  )
}

function ObraCard({ o, onStatus, busy }: { o: Obra; onStatus: (o: Obra, s: string) => void; busy: boolean }) {
  const st = ST[o.status] ?? { label: o.status, cor: MUT }
  const local = [o.cidade, o.uf].filter(Boolean).join('/')
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `4px solid ${st.cor}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: st.cor, fontFamily: 'monospace' }}>{o.numero}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>{fmtR(o.valor_previsto)}</span>
      </div>
      <div style={{ fontSize: 13.5, color: ESP, fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.nome}</div>
      <div style={{ fontSize: 11.5, color: MUT, marginTop: 1 }}>{o.cliente_nome || 'Cliente não informado'}{local ? ` · ${local}` : ''}</div>

      <div style={{ marginTop: 8 }}>
        <div style={{ background: BG, borderRadius: 6, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${o.pct_conclusao}%`, height: '100%', background: st.cor, opacity: 0.85 }} />
        </div>
        <div style={{ fontSize: 10.5, color: MUT, marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
          <span>{o.pct_conclusao}% concluído</span>
          <span>{o.responsavel_nome || 'sem responsável'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {(PROXIMOS[o.status] ?? []).map((p) => (
          <button key={p.s} onClick={() => onStatus(o, p.s)} disabled={busy}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, cursor: busy ? 'default' : 'pointer', border: `1px solid ${LINE}`, background: p.s === 'concluida' ? '#EAF5EE' : '#FFF', color: p.s === 'cancelada' ? VERM : ESP, opacity: busy ? 0.5 : 1 }}>
            {p.l}
          </button>
        ))}
      </div>
    </div>
  )
}

function Tab({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${ativo ? GOLD : LINE}`, background: ativo ? '#FBF4E4' : '#FFF', color: ativo ? '#A57A15' : MUT }}>{children}</button>
}
function Aviso({ cor, titulo, texto }: { cor: string; titulo: string; texto: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `4px solid ${cor}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{titulo}</div>
      <div style={{ fontSize: 12.5, color: MUT, marginTop: 4 }}>{texto}</div>
    </div>
  )
}
