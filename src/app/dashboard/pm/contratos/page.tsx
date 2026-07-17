'use client'
// CONTRATOS (P&M · Financeiro). Sobre agency_contratos. Recorrente (fee) ou projeto. Escopo por
// company_id (RD-45). Integração GE (erp_receber) fica como AÇÃO wired — post automático só após
// régua RD-53 + autorização (não sujar o financeiro real na demo). Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: '#F0E9DE' }, ativo: { l: 'Ativo', cor: '#DCEFD7' },
  suspenso: { l: 'Suspenso', cor: '#FFF3D6' }, encerrado: { l: 'Encerrado', cor: '#F4D6D6' },
}
const stCfg = (v: string) => STATUS[v] ?? { l: v, cor: OFFWHITE }

type Contrato = {
  id: string; cliente_id: string | null; tipo: string; fee_mensal: number | null; valor_projeto: number | null
  dia_vencimento: number | null; data_inicio: string | null; status: string; documentacao_ok: boolean; lancamento_id: string | null
}
type Cli = { id: string; nome: string; nome_fantasia: string | null }

export default function ContratosPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [contratos, setContratos] = useState<Contrato[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true); const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [c, cl] = await Promise.all([
      supabase.from('agency_contratos').select('*').eq('company_id', empresa).order('criado_em', { ascending: false }),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
    ])
    setContratos((c.data ?? []) as Contrato[]); setClientes((cl.data ?? []) as Cli[]); setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }

  const kpis = useMemo(() => ({
    ativos: contratos.filter((c) => c.status === 'ativo').length,
    mrr: contratos.filter((c) => c.status === 'ativo' && c.tipo === 'recorrente').reduce((s, c) => s + Number(c.fee_mensal ?? 0), 0),
  }), [contratos])

  async function mudarStatus(c: Contrato, status: string) {
    await supabase.from('agency_contratos').update({ status, atualizado_em: new Date().toISOString() }).eq('id', c.id)
    setToast(`Contrato ALTERADO para ${stCfg(status).l}.`); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1050, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>💰 P&amp;M · Financeiro</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Contratos</h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Recorrente (fee) ou projeto. Aprovar uma proposta gera o contrato.</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Contratos ativos" v={String(kpis.ativos)} />
          <Kpi l="MRR (fee recorrente)" v={brl(kpis.mrr)} cor={DOURADO} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : contratos.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhum contrato. Aprovar uma proposta gera o contrato.</div>
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {contratos.map((c) => {
                const cfg = stCfg(c.status)
                return (
                  <div key={c.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 700 }}>{nomeCli(c.cliente_id)} <span style={{ color: TEXTM, fontWeight: 400 }}>· {c.tipo === 'recorrente' ? 'recorrente' : 'projeto'}</span></div>
                      <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>
                        {c.tipo === 'recorrente' ? `${brl(Number(c.fee_mensal ?? 0))}/mês · venc. dia ${c.dia_vencimento ?? '—'}` : brl(Number(c.valor_projeto ?? 0))}
                        {c.data_inicio ? ` · desde ${c.data_inicio}` : ''}{c.documentacao_ok ? ' · doc ✓' : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ESPRESSO, background: cfg.cor, padding: '3px 10px', borderRadius: 999 }}>{cfg.l}</span>
                    {c.status === 'ativo'
                      ? <button onClick={() => mudarStatus(c, 'suspenso')} style={btnSec}>Suspender</button>
                      : c.status === 'suspenso' ? <button onClick={() => mudarStatus(c, 'ativo')} style={btnOk}>Reativar</button>
                      : c.status === 'rascunho' ? <button onClick={() => mudarStatus(c, 'ativo')} style={btnOk}>Ativar</button> : null}
                    <span title="Gera receita na GE — habilitado após a régua financeira (RD-53)"
                      style={{ fontSize: 11, color: c.lancamento_id ? GREEN : TEXTM, border: `1px dashed ${BORDA}`, borderRadius: 8, padding: '4px 8px' }}>
                      {c.lancamento_id ? '→ receita na GE ✓' : '→ receita na GE (após régua)'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>
          A geração de receita recorrente na Gestão Empresarial (erp_receber) é ligada após a régua de não-regressão financeira (RD-53).
        </p>
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Kpi({ l, v, cor }: { l: string; v: string; cor?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const btnOk: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
