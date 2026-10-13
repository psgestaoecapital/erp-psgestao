'use client'
// COBRANÇA / FEE (P&M · Financeiro). Mensalidades recorrentes (agency_contratos ativos) a cobrar no
// mês. O disparo real da cobrança na GE (erp_receber/Asaas) fica wired — post só após régua RD-53.
// Escopo por company_id (RD-45). Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Contrato = { id: string; cliente_id: string | null; fee_mensal: number | null; dia_vencimento: number | null; lancamento_id: string | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }

export default function CobrancaPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [contratos, setContratos] = useState<Contrato[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true); const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      supabase.from('agency_contratos').select('id, cliente_id, fee_mensal, dia_vencimento, lancamento_id').eq('company_id', empresa).eq('tipo', 'recorrente').eq('status', 'ativo'),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
    ]).then(([c, cl]) => { setContratos((c.data ?? []) as Contrato[]); setClientes((cl.data ?? []) as Cli[]); setLoading(false) })
  }, [empresa])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }

  const mrr = useMemo(() => contratos.reduce((s, c) => s + Number(c.fee_mensal ?? 0), 0), [contratos])
  const mesL = useMemo(() => new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), [])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>💰 P&amp;M · Financeiro</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Cobrança / Fee</h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0', textTransform: 'capitalize' }}>Mensalidades recorrentes a cobrar · {mesL}</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Contratos a cobrar" v={String(contratos.length)} />
          <Kpi l="Total do mês (MRR)" v={brl(mrr)} cor={DOURADO} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : contratos.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhuma mensalidade recorrente ativa.</div>
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {contratos.map((c) => (
                <div key={c.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700 }}>{nomeCli(c.cliente_id)}</div>
                    <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>vencimento dia {c.dia_vencimento ?? '—'}</div>
                  </div>
                  <div style={{ fontWeight: 700, minWidth: 100, textAlign: 'right' }}>{brl(Number(c.fee_mensal ?? 0))}</div>
                  <span title="Gera cobrança na GE (Asaas) — habilitado após a régua financeira (RD-53)"
                    style={{ fontSize: 11, color: c.lancamento_id ? GREEN : TEXTM, border: `1px dashed ${BORDA}`, borderRadius: 8, padding: '4px 8px' }}>
                    {c.lancamento_id ? '→ cobrança emitida ✓' : '→ emitir cobrança (após régua)'}
                  </span>
                </div>
              ))}
            </div>
          )}
        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>
          A emissão da cobrança na Gestão Empresarial (erp_receber / Asaas) é ligada após a régua de não-regressão financeira (RD-53).
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
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
