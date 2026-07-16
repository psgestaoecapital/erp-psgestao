'use client'
// APROVAÇÃO CLIENTE (P&M). Jobs em 'em_aprovacao' → aprovar (→publicado) ou reprovar (→em_producao).
// Escopo por company_id (RD-45). Tema Espresso.
import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const RED = '#7A1F1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Job = { id: string; titulo: string; numero: string | null; valor_job: number | null; cliente_id: string | null; data_prazo: string | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }

export default function AprovacaoPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [jobs, setJobs] = useState<Job[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [j, c] = await Promise.all([
      supabase.from('agency_jobs').select('id, titulo, numero, valor_job, cliente_id, data_prazo').eq('company_id', empresa).eq('status', 'em_aprovacao').order('data_prazo'),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
    ])
    setJobs((j.data ?? []) as Job[]); setClientes((c.data ?? []) as Cli[]); setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])
  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }

  async function decidir(j: Job, aprovar: boolean) {
    setBusy(true)
    await supabase.rpc('fn_pm_job_mover_status', { p_job_id: j.id, p_status: aprovar ? 'publicado' : 'em_producao' })
    setBusy(false); setToast(aprovar ? 'Job APROVADO · publicado.' : 'Job devolvido pra produção.'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🏭 P&amp;M · Produção</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Aprovação do cliente</h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Jobs em conferência aguardando o OK. Aprovar publica; reprovar volta pra produção.</p>
        </header>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : jobs.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nada aguardando aprovação.</div>
          : (
            <div style={{ display: 'grid', gap: 8 }}>
              {jobs.map((j) => (
                <div key={j.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 700 }}>{j.titulo}</div>
                    <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{nomeCli(j.cliente_id)} · {brl(Number(j.valor_job ?? 0))}{j.data_prazo ? ` · prazo ${j.data_prazo}` : ''}</div>
                  </div>
                  <button disabled={busy} onClick={() => decidir(j, true)} style={btnOk}>✓ Aprovar</button>
                  <button disabled={busy} onClick={() => decidir(j, false)} style={btnNo}>↩ Reprovar</button>
                </div>
              ))}
            </div>
          )}
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}
const btnOk: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnNo: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', minHeight: 42 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
