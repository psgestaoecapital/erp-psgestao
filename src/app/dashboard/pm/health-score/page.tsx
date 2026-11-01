'use client'
// HEALTH SCORE DO CLIENTE (P&M). Nota de saúde (0-100) de cada cliente, montada a partir de 4 componentes
// com PESOS EDITÁVEIS por empresa (agency_score_pesos · fn_agency_score_pesos_get/_salvar). Esta tela entrega a
// CONFIGURAÇÃO dos pesos (soma = 100%, padrão preenchido, rastreável). O ranking de clientes por score
// (fn_agency_score_calcular) vem na PR seguinte. Escopo por company_id (RD-45). Tema Espresso. RD-95/96/99.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/health-score'
const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const VERMELHO = '#B3261E'

type Pesos = { prazo: number; margem: number; pagamento: number; atividade: number }
const PADRAO: Pesos = { prazo: 30, margem: 30, pagamento: 20, atividade: 20 }

const COMPONENTES: { k: keyof Pesos; rot: string; chave: string; desc: string }[] = [
  { k: 'prazo', rot: 'Entregas no prazo', chave: 'pm.health_score.peso_prazo', desc: 'Jobs entregues dentro do prazo combinado.' },
  { k: 'margem', rot: 'Margem real do cliente', chave: 'pm.health_score.peso_margem', desc: 'Receita do contrato menos o custo das horas (timesheet × custo/hora).' },
  { k: 'pagamento', rot: 'Pagamento em dia', chave: 'pm.health_score.peso_pagamento', desc: 'Contas a receber do cliente pagas no vencimento (Gestão Empresarial).' },
  { k: 'atividade', rot: 'Atividade recente', chave: 'pm.health_score.peso_atividade', desc: 'Movimento do cliente (jobs) no período.' },
]

export default function HealthScorePage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [pesos, setPesos] = useState<Pesos>(PADRAO)
  const [ehPadrao, setEhPadrao] = useState(true)
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [toast, setToast] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('fn_agency_score_pesos_get', { p_company_id: empresa })
    const r = (data ?? {}) as { ok?: boolean; padrao?: boolean; peso_prazo?: number; peso_margem?: number; peso_pagamento?: number; peso_atividade?: number }
    if (r.ok) {
      setPesos({ prazo: r.peso_prazo ?? 30, margem: r.peso_margem ?? 30, pagamento: r.peso_pagamento ?? 20, atividade: r.peso_atividade ?? 20 })
      setEhPadrao(!!r.padrao)
    }
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const soma = useMemo(() => pesos.prazo + pesos.margem + pesos.pagamento + pesos.atividade, [pesos])
  const ok100 = soma === 100
  const set = (k: keyof Pesos, v: string) => { const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0))); setPesos((p) => ({ ...p, [k]: n })) }

  const salvar = async () => {
    if (!empresa || !ok100) return
    setSaving(true)
    const { data, error } = await supabase.rpc('fn_agency_score_pesos_salvar', { p_company_id: empresa, p_prazo: pesos.prazo, p_margem: pesos.margem, p_pagamento: pesos.pagamento, p_atividade: pesos.atividade })
    setSaving(false)
    const r = (data ?? {}) as { ok?: boolean; erro?: string; soma?: number }
    if (error || !r.ok) { setToast(r.erro === 'soma_diferente_100' ? `A soma precisa ser 100 (está ${r.soma}).` : `Não foi possível salvar: ${r.erro ?? error?.message ?? 'erro'}`); return }
    setToast('Pesos salvos.'); setEhPadrao(false); await carregar()
  }
  const restaurarPadrao = () => setPesos(PADRAO)

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>❤️ P&amp;M · Relacionamento</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Health Score do cliente<AjudaCampo chave="pm.health_score.tela" rota={ROTA} /></h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '6px 0 0', maxWidth: 620 }}>
            A nota de saúde de cada cliente (0 a 100) é a média ponderada de quatro componentes. Defina aqui o peso de
            cada um — a soma precisa fechar em <b>100%</b>. O ranking dos clientes por score entra na próxima entrega.
          </p>
        </header>

        <section style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: '18px 18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Pesos dos componentes</h2>
            {!loading && <span style={{ fontSize: 11, color: TEXTM, border: `1px dashed ${BORDA}`, borderRadius: 8, padding: '3px 8px' }}>{ehPadrao ? 'usando padrão' : 'personalizado'}</span>}
          </div>

          {loading ? <div style={{ padding: 30, textAlign: 'center', color: TEXTM }}>Carregando…</div> : (
            <>
              <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                {COMPONENTES.map((c) => (
                  <div key={c.k} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: `1px solid ${OFFWHITE}` }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center' }}>{c.rot}<AjudaCampo chave={c.chave} rota={ROTA} /></div>
                      <div style={{ fontSize: 12, color: TEXTM, marginTop: 1 }}>{c.desc}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input aria-label={`Peso de ${c.rot}`} type="number" min={0} max={100} value={pesos[c.k]} onChange={(e) => set(c.k, e.target.value)}
                        style={{ width: 72, padding: '8px 10px', border: `1px solid ${BORDA}`, borderRadius: 8, fontSize: 14, fontWeight: 700, textAlign: 'right', color: ESPRESSO }} />
                      <span style={{ fontSize: 13, color: TEXTM, fontWeight: 700 }}>%</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 14, fontWeight: 700 }}>
                  <span>Soma dos pesos</span><AjudaCampo chave="pm.health_score.soma" rota={ROTA} />
                  <span style={{ marginLeft: 8, color: ok100 ? GREEN : VERMELHO }}>{soma}% {ok100 ? '✓' : `(precisa ser 100%)`}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={restaurarPadrao} style={btnGhost(TEXTM)}>Restaurar padrão</button>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <button onClick={() => void salvar()} disabled={!ok100 || saving} style={{ ...btn(ok100 ? DOURADO : '#C9BDB0'), cursor: ok100 && !saving ? 'pointer' : 'not-allowed' }}>{saving ? 'Salvando…' : 'Salvar pesos'}</button>
                    <AjudaCampo chave="pm.health_score.salvar" rota={ROTA} />
                  </span>
                </div>
              </div>
            </>
          )}
        </section>

        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>
          Cada peso define o quanto o componente influencia a nota final. A régua vale para todos os clientes desta empresa
          e a alteração fica registrada para auditoria.
        </p>
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}
function btn(cor: string): CSSProperties { return { background: cor, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' } }
function btnGhost(cor: string): CSSProperties { return { background: '#fff', color: cor, border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' } }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
