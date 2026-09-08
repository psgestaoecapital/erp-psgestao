'use client'

// Revenda de Veículos · Onda 9 + enriquecimento — Kanban de preparação.
// Cabeçalho com números reais (fn_veic_preparacao_pendentes), 3 colunas SEMPRE visíveis,
// empty state em 2 níveis (sem vistoria / com vistoria → abrir OS direto), badge de prazo vencido.
// Read-only exceto "abrir OS" (fn_veic_preparacao_abrir); concluir é na ficha.

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC', blue: '#2F5AA8',
}
const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brDate = (d: string | null) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const hoje = () => new Date().toISOString().slice(0, 10)

type PrepOS = { os_id: string; numero: string; status: string; prioridade: string; veiculo_id: string; placa: string | null; marca: string | null; modelo: string | null; descricao_servico: string | null; tecnico_nome: string | null; data_abertura: string | null; data_prevista: string | null; data_conclusao: string | null; dias_corridos: number | null; total: number; coluna: string; concluida: boolean; custo_id: string | null }
type Pend = { veiculo_id: string; placa: string | null; marca: string | null; modelo: string | null; previsto: number }
type Pendentes = { ok: boolean; em_andamento: { os: number; valor: number }; concluidas_mes: { os: number; valor: number }; aguardando_os: { veiculos: number; lista: Pend[] }; total_veiculos: number; sem_vistoria: number }

const COLUNAS: { key: string; titulo: string; cor: string; bg: string }[] = [
  { key: 'a_fazer', titulo: 'A Fazer', cor: C.espM, bg: C.cream },
  { key: 'fazendo', titulo: 'Fazendo', cor: C.blue, bg: '#EEF3FB' },
  { key: 'finalizado', titulo: 'Finalizado', cor: C.green, bg: C.greenBg },
]

export default function PreparacaoKanbanPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const [oss, setOss] = useState<PrepOS[]>([])
  const [pend, setPend] = useState<Pendentes | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) { setOss([]); setPend(null); setLoading(false); return }
    const [l, p] = await Promise.all([
      supabase.rpc('fn_veic_preparacao_listar', { p_company_id: companyId, p_veiculo_id: null }),
      supabase.rpc('fn_veic_preparacao_pendentes', { p_company_id: companyId }),
    ])
    if (l.error) { setErro(l.error.message); setLoading(false); return }
    const r = l.data as { ok?: boolean; os?: PrepOS[] } | null
    setOss(r?.ok ? (r.os ?? []) : [])
    const pr = p.data as Pendentes | null
    setPend(pr?.ok ? pr : null)
    setLoading(false)
  }, [companyId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const porColuna = useMemo(() => {
    const m: Record<string, PrepOS[]> = { a_fazer: [], fazendo: [], finalizado: [] }
    oss.forEach((o) => { (m[o.coluna] ?? m.a_fazer).push(o) })
    return m
  }, [oss])

  async function abrirOS(veiculoId: string) {
    setAbrindo(veiculoId)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_veic_preparacao_abrir', { p_veiculo_id: veiculoId, p_dados: {}, p_user: user?.id ?? null })
    setAbrindo(null)
    const r = data as { ok?: boolean; erro?: string; numero?: string } | null
    if (error || !r?.ok) { setErro(error?.message || r?.erro || 'Falha ao abrir a OS.'); return }
    void carregar()
  }

  if (!companyId) return <div style={{ padding: 28, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa específica no topo.</div>

  const semOS = !loading && oss.length === 0

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1180, margin: '0 auto', color: C.esp }}>
      <a href="/dashboard/revenda/patio" style={{ fontSize: 12, color: C.blue, textDecoration: 'none' }}>← voltar ao pátio</a>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>🔧 Comércio · Revenda</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Preparação</h1>
        <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 14px' }}>Ordens de serviço de preparação (reusa a OS da Oficina). Concluir uma OS é na ficha do veículo — vira custo no chassi.</p>
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }} onClick={() => setErro(null)}>{erro}</div>}

      {/* cabeçalho com números reais */}
      {pend && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Stat titulo="Em andamento" a={`${pend.em_andamento.os} OS`} b={brl(pend.em_andamento.valor)} cor={C.blue} />
          <Stat titulo="Concluídas no mês" a={`${pend.concluidas_mes.os} OS`} b={brl(pend.concluidas_mes.valor)} cor={C.green} />
          <Stat titulo="Aguardando OS" a={`${pend.aguardando_os.veiculos} veículo(s)`} b="com reparo previsto, sem OS" cor={C.amber} />
        </div>
      )}

      {loading ? (
        <div style={{ color: C.espM, fontSize: 13 }}>Carregando…</div>
      ) : (
        <>
          {/* as 3 colunas SEMPRE visíveis — a estrutura ensina o fluxo */}
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
            {COLUNAS.map((col) => {
              const lista = porColuna[col.key] ?? []
              return (
                <div key={col.key} style={{ flex: '1 0 300px', minWidth: 300, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', background: col.bg, color: col.cor, fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{col.titulo}</span><span>{lista.length}</span>
                  </div>
                  <div style={{ padding: 10, display: 'grid', gap: 10 }}>
                    {lista.length === 0 && <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic', padding: '8px 2px' }}>—</div>}
                    {lista.map((o) => {
                      const atrasada = !o.concluida && !!o.data_prevista && o.data_prevista < hoje()
                      return (
                        <div key={o.os_id} onClick={() => router.push(`/dashboard/revenda/veiculo/${o.veiculo_id}`)}
                          style={{ border: `1px solid ${atrasada ? C.amber : C.border}`, borderRadius: 10, padding: 10, cursor: 'pointer', background: C.white }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                            <b style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{o.numero}</b>
                            <span style={{ fontWeight: 700, fontSize: 13, color: C.esp }}>{brl(o.total)}</span>
                          </div>
                          <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>{o.marca || ''} {o.modelo || 'Veículo'}</div>
                          <div style={{ fontSize: 11.5, color: C.espM, fontFamily: 'monospace' }}>{o.placa || 'sem placa'}</div>
                          {o.descricao_servico && <div style={{ fontSize: 11, color: C.espM, marginTop: 4, lineHeight: 1.35, maxHeight: 46, overflow: 'hidden' }}>{o.descricao_servico}</div>}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: col.bg, color: col.cor, fontWeight: 700 }}>{o.status.replace('_', ' ')}</span>
                            {o.dias_corridos != null && <span style={{ fontSize: 10.5, color: C.espL }}>{o.dias_corridos} dia(s)</span>}
                            {o.tecnico_nome && <span style={{ fontSize: 10.5, color: C.espL }}>· {o.tecnico_nome}</span>}
                            {o.data_prevista && <span style={{ fontSize: 10.5, color: atrasada ? C.amber : C.espL, fontWeight: atrasada ? 700 : 400 }}>· prazo {brDate(o.data_prevista)}{atrasada ? ' (vencido)' : ''}</span>}
                            {o.custo_id && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: '#E8EEF9', color: C.blue, fontWeight: 700 }}>custo lançado</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* empty state em 2 níveis: só quando não há NENHUMA OS */}
          {semOS && pend && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginTop: 14 }}>
              {pend.aguardando_os.veiculos > 0 ? (
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{pend.aguardando_os.veiculos} veículo(s) têm reparo previsto e nenhuma OS aberta.</div>
                  {pend.aguardando_os.lista.map((p) => (
                    <div key={p.veiculo_id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${C.cream}`, padding: '9px 0', fontSize: 13 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.placa || 'sem placa'}</span>
                      <span>{p.marca || ''} {p.modelo || 'Veículo'}</span>
                      <span style={{ color: C.gold, fontWeight: 700 }}>{brl(p.previsto)} previstos</span>
                      <button disabled={abrindo === p.veiculo_id} onClick={() => void abrirOS(p.veiculo_id)} style={{ marginLeft: 'auto', border: 'none', background: C.gold, color: '#fff', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: abrindo === p.veiculo_id ? 'wait' : 'pointer' }}>{abrindo === p.veiculo_id ? 'abrindo…' : 'abrir OS'}</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Nenhuma OS de preparação ainda.</div>
                  <div style={{ fontSize: 12.5, color: C.espM, lineHeight: 1.55, margin: '8px auto 0', maxWidth: 520 }}>
                    A preparação nasce da vistoria: os itens marcados como reparo ou troca viram a previsão de gastos, e daí sai a OS.
                    {pend.sem_vistoria > 0 && <> <b>{pend.sem_vistoria} veículo(s)</b> ainda não foram vistoriados.</>}
                  </div>
                  <a href="/dashboard/revenda/patio" style={{ display: 'inline-block', marginTop: 12, background: C.gold, color: '#fff', padding: '9px 16px', borderRadius: 8, textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>Ver veículos sem vistoria →</a>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ titulo, a, b, cor }: { titulo: string; a: string; b: string; cor: string }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: C.espM }}>{titulo}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: cor, marginTop: 2 }}>{a}</div>
      <div style={{ fontSize: 11.5, color: C.espM, marginTop: 1 }}>{b}</div>
    </div>
  )
}
