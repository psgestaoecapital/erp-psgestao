'use client'

// F1 · Recebíveis de Cartão — cadastro de adquirentes (Cielo/Rede/Stone…) + tabela de taxas
// (bandeira × modalidade × faixa de parcelas) + simulador que chama o motor fn_cartao_calcular.
// A taxa vem SEMPRE do cadastro (RD-52) — F2/F3/F4 consomem o mesmo motor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)', GREEN = '#16A34A', RED = '#B91C1C'
const BANDEIRAS = ['Visa', 'Master', 'Elo', 'Amex', 'Hiper', 'Hipercard', 'Cabal']
const MODALIDADES = ['debito', 'credito'] as const

type Conta = { id: string; nome: string; banco: string | null }
type Adquirente = { id: string; nome: string; conta_bancaria_id: string | null; documento: string | null; observacao: string | null }
type Taxa = { id: string; adquirente_id: string; bandeira: string; modalidade: string; parcelas_de: number; parcelas_ate: number; taxa_percentual: number; prazo_repasse_dias: number }
type CalcRes = { ok: boolean; erro?: string; taxa_percentual?: number; valor_taxa?: number; valor_liquido?: number; prazo_repasse_dias?: number; data_repasse?: string }

const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CartoesPage() {
  const { companyIds } = useCompanyIds()
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null

  const [contas, setContas] = useState<Conta[]>([])
  const [adquirentes, setAdquirentes] = useState<Adquirente[]>([])
  const [taxas, setTaxas] = useState<Taxa[]>([])
  const [sel, setSel] = useState<string>('')   // adquirente selecionado p/ ver taxas
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  // forms
  const [fAdq, setFAdq] = useState<{ id?: string; nome: string; conta_bancaria_id: string; documento: string; observacao: string } | null>(null)
  const vazioTaxa = { id: undefined as string | undefined, bandeira: 'Visa', modalidade: 'credito', parcelas_de: '1', parcelas_ate: '1', taxa_percentual: '', prazo_repasse_dias: '30' }
  const [fTaxa, setFTaxa] = useState<typeof vazioTaxa | null>(null)

  // simulador
  const [sim, setSim] = useState({ bandeira: 'Visa', modalidade: 'debito', parcelas: '1', valor: '' })
  const [simRes, setSimRes] = useState<CalcRes | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    const [ct, aq] = await Promise.all([
      supabase.from('erp_banco_contas').select('id,nome,banco').eq('company_id', empresaUnica).eq('ativo', true).order('nome'),
      supabase.rpc('fn_cartao_adquirente_listar', { p_company_id: empresaUnica }),
    ])
    setContas((ct.data ?? []) as Conta[])
    const adqs = ((aq.data as { adquirentes?: Adquirente[] } | null)?.adquirentes) ?? []
    setAdquirentes(adqs)
    setSel((s) => s || adqs[0]?.id || '')
  }, [empresaUnica])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const carregarTaxas = useCallback(async () => {
    if (!empresaUnica || !sel) { setTaxas([]); return }
    const { data } = await supabase.rpc('fn_cartao_taxa_listar', { p_company_id: empresaUnica, p_adquirente_id: sel })
    setTaxas((((data as { taxas?: Taxa[] } | null)?.taxas) ?? []))
  }, [empresaUnica, sel])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregarTaxas() }, [carregarTaxas])

  const contaNome = useCallback((id: string | null) => id ? (contas.find((c) => c.id === id)?.nome ?? '—') : '— não definida', [contas])
  const adqNome = useMemo(() => adquirentes.find((a) => a.id === sel)?.nome ?? '', [adquirentes, sel])

  async function salvarAdq() {
    if (!empresaUnica || !fAdq?.nome.trim()) { setMsg({ t: 'Informe o nome da adquirente.', ok: false }); return }
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_cartao_adquirente_salvar', { p_company_id: empresaUnica, p_dados: {
      id: fAdq.id, nome: fAdq.nome.trim(), conta_bancaria_id: fAdq.conta_bancaria_id, documento: fAdq.documento, observacao: fAdq.observacao,
    } })
    setBusy(false)
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg({ t: 'Erro: ' + (error?.message || (data as { erro?: string }).erro), ok: false }); return }
    setMsg({ t: fAdq.id ? 'Adquirente ALTERADA.' : 'Adquirente criada.', ok: true }); setFAdq(null); await carregar()
  }

  async function salvarTaxa() {
    if (!empresaUnica || !sel) { setMsg({ t: 'Selecione uma adquirente.', ok: false }); return }
    if (!fTaxa || !String(fTaxa.taxa_percentual).trim()) { setMsg({ t: 'Informe a taxa %.', ok: false }); return }
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_cartao_taxa_salvar', { p_company_id: empresaUnica, p_dados: {
      id: fTaxa.id, adquirente_id: sel, bandeira: fTaxa.bandeira, modalidade: fTaxa.modalidade,
      parcelas_de: Number(fTaxa.parcelas_de) || 1, parcelas_ate: Number(fTaxa.parcelas_ate) || 1,
      taxa_percentual: String(fTaxa.taxa_percentual).replace(',', '.'), prazo_repasse_dias: Number(fTaxa.prazo_repasse_dias) || 1,
    } })
    setBusy(false)
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg({ t: 'Erro: ' + (error?.message || (data as { erro?: string }).erro), ok: false }); return }
    setMsg({ t: fTaxa.id ? 'Taxa ALTERADA.' : 'Taxa criada.', ok: true }); setFTaxa(null); await carregarTaxas()
  }

  async function simular() {
    if (!empresaUnica || !sel) { setMsg({ t: 'Selecione uma adquirente.', ok: false }); return }
    const v = parseFloat(String(sim.valor).replace(',', '.'))
    if (!v || v <= 0) { setMsg({ t: 'Informe um valor de venda.', ok: false }); return }
    setBusy(true); setSimRes(null)
    const { data, error } = await supabase.rpc('fn_cartao_calcular', {
      p_company_id: empresaUnica, p_adquirente_id: sel, p_bandeira: sim.bandeira, p_modalidade: sim.modalidade,
      p_parcelas: Number(sim.parcelas) || 1, p_valor: v,
    })
    setBusy(false)
    if (error) { setSimRes({ ok: false, erro: error.message }); return }
    setSimRes(data as CalcRes)
  }

  if (!empresaUnica) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione UMA empresa específica para gerir cartões/adquirentes.</div>

  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13, background: '#fff', color: ESP }
  const lbl: React.CSSProperties = { fontSize: 11, color: ESP60, display: 'block', marginBottom: 3 }
  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }
  const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' }
  const btnPri: React.CSSProperties = { padding: '8px 14px', background: GOLD, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }
  const btnSec: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
  const link: React.CSSProperties = { background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 12, fontWeight: 600 }

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ fontSize: 9, color: GOLD, letterSpacing: 2, textTransform: 'uppercase' }}>Financeiro</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>💳 Cartões / Adquirentes</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 16 }}>Cadastre adquirentes e as taxas por bandeira × modalidade × parcelas. A taxa vem do cadastro (RD-52) — o motor pré-calcula o líquido e a data de repasse.</div>
      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: msg.ok ? GREEN : RED }}>{msg.t}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
        {/* ADQUIRENTES */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>Adquirentes ({adquirentes.length})</div>
            <span style={{ flex: 1 }} />
            <button onClick={() => setFAdq({ nome: '', conta_bancaria_id: '', documento: '', observacao: '' })} style={btnPri}>+ Nova</button>
          </div>
          {fAdq && (
            <div style={{ display: 'grid', gap: 8, background: BG, borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div><span style={lbl}>Nome *</span><input style={inp} value={fAdq.nome} onChange={(e) => setFAdq({ ...fAdq, nome: e.target.value })} placeholder="Cielo, Rede, Stone…" /></div>
              <div><span style={lbl}>Conta de repasse</span>
                <select style={inp} value={fAdq.conta_bancaria_id} onChange={(e) => setFAdq({ ...fAdq, conta_bancaria_id: e.target.value })}>
                  <option value="">— não definida —</option>
                  {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>)}
                </select>
              </div>
              <div><span style={lbl}>CNPJ (opcional)</span><input style={inp} value={fAdq.documento} onChange={(e) => setFAdq({ ...fAdq, documento: e.target.value })} /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void salvarAdq()} disabled={busy} style={btnPri}>{fAdq.id ? 'Salvar' : 'Adicionar'}</button>
                <button onClick={() => setFAdq(null)} style={btnSec}>Cancelar</button>
              </div>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ color: ESP60 }}><th style={th}>Nome</th><th style={th}>Conta de repasse</th><th style={th}></th></tr></thead>
              <tbody>
                {adquirentes.map((a) => (
                  <tr key={a.id} style={{ borderTop: `1px solid ${LINE}`, background: a.id === sel ? '#FBF3E0' : 'transparent' }}>
                    <td style={{ ...td, fontWeight: 600 }}><button onClick={() => setSel(a.id)} style={{ ...link, color: ESP }}>{a.nome}</button></td>
                    <td style={td}>{contaNome(a.conta_bancaria_id)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => setFAdq({ id: a.id, nome: a.nome, conta_bancaria_id: a.conta_bancaria_id ?? '', documento: a.documento ?? '', observacao: a.observacao ?? '' })} style={link}>editar</button>
                    </td>
                  </tr>
                ))}
                {adquirentes.length === 0 && <tr><td style={td} colSpan={3}>Nenhuma adquirente. Cadastre a primeira (ex.: Cielo).</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* TAXAS do adquirente selecionado */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>Taxas {adqNome ? `· ${adqNome}` : ''}</div>
            <span style={{ flex: 1 }} />
            <button onClick={() => setFTaxa({ ...vazioTaxa })} disabled={!sel} style={{ ...btnPri, opacity: sel ? 1 : 0.5 }}>+ Nova taxa</button>
          </div>
          {!sel && <div style={{ fontSize: 12, color: ESP60 }}>Selecione uma adquirente (clique no nome à esquerda).</div>}
          {fTaxa && sel && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: BG, borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div><span style={lbl}>Bandeira</span><input style={inp} list="bandeiras" value={fTaxa.bandeira} onChange={(e) => setFTaxa({ ...fTaxa, bandeira: e.target.value })} /></div>
              <div><span style={lbl}>Modalidade</span><select style={inp} value={fTaxa.modalidade} onChange={(e) => setFTaxa({ ...fTaxa, modalidade: e.target.value })}>{MODALIDADES.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
              <div><span style={lbl}>Parcelas de</span><input style={inp} type="number" value={fTaxa.parcelas_de} onChange={(e) => setFTaxa({ ...fTaxa, parcelas_de: e.target.value })} /></div>
              <div><span style={lbl}>Parcelas até</span><input style={inp} type="number" value={fTaxa.parcelas_ate} onChange={(e) => setFTaxa({ ...fTaxa, parcelas_ate: e.target.value })} /></div>
              <div><span style={lbl}>Taxa %</span><input style={inp} type="number" step="0.01" value={fTaxa.taxa_percentual} onChange={(e) => setFTaxa({ ...fTaxa, taxa_percentual: e.target.value })} placeholder="ex.: 1,01" /></div>
              <div><span style={lbl}>Repasse (dias)</span><input style={inp} type="number" value={fTaxa.prazo_repasse_dias} onChange={(e) => setFTaxa({ ...fTaxa, prazo_repasse_dias: e.target.value })} placeholder="D+" /></div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                <button onClick={() => void salvarTaxa()} disabled={busy} style={btnPri}>{fTaxa.id ? 'Salvar' : 'Adicionar'}</button>
                <button onClick={() => setFTaxa(null)} style={btnSec}>Cancelar</button>
              </div>
            </div>
          )}
          {sel && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ color: ESP60 }}>
                  <th style={th}>Bandeira</th><th style={th}>Modal.</th><th style={{ ...th, textAlign: 'center' }}>Parcelas</th>
                  <th style={{ ...th, textAlign: 'right' }}>Taxa %</th><th style={{ ...th, textAlign: 'right' }}>Repasse</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {taxas.map((t) => (
                    <tr key={t.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={{ ...td, fontWeight: 600 }}>{t.bandeira}</td>
                      <td style={td}>{t.modalidade}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{t.parcelas_de === t.parcelas_ate ? `${t.parcelas_de}x` : `${t.parcelas_de}–${t.parcelas_ate}x`}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{brl(t.taxa_percentual)}%</td>
                      <td style={{ ...td, textAlign: 'right' }}>D+{t.prazo_repasse_dias}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button onClick={() => setFTaxa({ id: t.id, bandeira: t.bandeira, modalidade: t.modalidade, parcelas_de: String(t.parcelas_de), parcelas_ate: String(t.parcelas_ate), taxa_percentual: String(t.taxa_percentual), prazo_repasse_dias: String(t.prazo_repasse_dias) })} style={link}>editar</button>
                      </td>
                    </tr>
                  ))}
                  {taxas.length === 0 && <tr><td style={td} colSpan={6}>Nenhuma taxa cadastrada para esta adquirente.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* SIMULADOR */}
        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Simulador</div>
          <div style={{ fontSize: 11.5, color: ESP60, marginBottom: 10 }}>Valida o cadastro: valor da venda → taxa, líquido e data de repasse (motor <code>fn_cartao_calcular</code>).</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><span style={lbl}>Bandeira</span><input style={inp} list="bandeiras" value={sim.bandeira} onChange={(e) => setSim({ ...sim, bandeira: e.target.value })} /></div>
            <div><span style={lbl}>Modalidade</span><select style={inp} value={sim.modalidade} onChange={(e) => setSim({ ...sim, modalidade: e.target.value })}>{MODALIDADES.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
            <div><span style={lbl}>Parcelas</span><input style={inp} type="number" value={sim.parcelas} onChange={(e) => setSim({ ...sim, parcelas: e.target.value })} /></div>
            <div><span style={lbl}>Valor da venda (R$)</span><input style={inp} value={sim.valor} onChange={(e) => setSim({ ...sim, valor: e.target.value })} placeholder="2110,00" /></div>
          </div>
          <button onClick={() => void simular()} disabled={busy || !sel} style={{ ...btnPri, marginTop: 10, opacity: sel ? 1 : 0.5 }}>Calcular</button>
          {simRes && (
            simRes.ok
              ? <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#EAF5EE', border: `0.5px solid ${GREEN}55` }}>
                  <div style={{ fontSize: 12, color: ESP60 }}>Taxa {brl(simRes.taxa_percentual ?? 0)}% · repasse D+{simRes.prazo_repasse_dias}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>Líquido R$ {brl(simRes.valor_liquido ?? 0)}</div>
                  <div style={{ fontSize: 12, color: ESP60 }}>Taxa retida R$ {brl(simRes.valor_taxa ?? 0)} · cai em {simRes.data_repasse ? new Date(simRes.data_repasse + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</div>
                </div>
              : <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#FEECEC', color: RED, fontSize: 12.5 }}>
                  {simRes.erro === 'taxa_nao_cadastrada' ? 'Taxa não cadastrada para essa bandeira/modalidade/parcelas. Cadastre acima.' : `Erro: ${simRes.erro}`}
                </div>
          )}
        </div>
      </div>

      <datalist id="bandeiras">{BANDEIRAS.map((b) => <option key={b} value={b} />)}</datalist>

      <div style={{ fontSize: 11, color: ESP60, marginTop: 16, lineHeight: 1.5 }}>
        🧭 <b>F1 (base).</b> Próximas fases: F2 gera o recebível líquido da adquirente na venda; F3 concilia o repasse (extrato); F4 leva venda (competência) × repasse (caixa) + taxa (despesa financeira) pro DRE.
      </div>
    </div>
  )
}
