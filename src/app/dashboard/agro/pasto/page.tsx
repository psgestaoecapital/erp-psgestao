'use client'
// Manejo de Pasto · Estância Umuarama · RD-41
// Princípio RD-51: o que TEM dado brilha; o que falta CONVIDA a medir. Nunca mock.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/hooks/useEmpresaSelecionada'
import CapacidadeIdealModal from '@/components/agro/CapacidadeIdealModal'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.6)'
const SEM: Record<string, { cor: string; bg: string }> = {
  vazio:    { cor: '#6B7280', bg: '#F3F4F6' },
  verde:    { cor: '#16A34A', bg: '#DCFCE7' },
  amarelo:  { cor: '#B45309', bg: '#FEF3C7' },
  vermelho: { cor: '#DC2626', bg: '#FEE2E2' },
  cinza:    { cor: '#6B7280', bg: '#F3F4F6' },
}

// Forrageiras (referência de UA/ha por tipo de pastagem). Sugestões são só ponto de partida
// editável — as taxas variam MUITO por região/solo/manejo/época.
type Forrageira = { id: string; nome: string; ua_ha_sugerido: number | null; observacao: string | null }
const SUGESTOES_FORR: Array<[string, number]> = [
  ['Brachiaria brizantha (Marandu)', 1.5], ['Brachiaria decumbens', 1.2],
  ['Panicum Mombaça', 3.5], ['Panicum Tanzânia', 3.0], ['Tifton/Cynodon', 2.5], ['Andropogon', 1.2],
]

type Aval = { metodo: string; valor_txt: string | null; valor_num: number | null; data: string } | null
type Piquete = { id: string; nome: string; area_ha: number; capacidade_ua: number; cab: number; ua_atual: number; pct: number | null; semaforo: string; dias_ocupado: number | null; ultima_avaliacao: Aval; vazio: boolean }
type CatUA = { categoria: string; ua_valor: number; confirmado: boolean; origem: string }
type Alerta = { piquete: string; cab: number; pct: number; dias: number; pasto: string | null; motivo: string; sugestao_mover_para: string[] }
type ConfigAlerta = { lotacao_pct: number; dias_min: number; altura_cm_min: number; confirmado: boolean }
type Painel = {
  ua_confirmado: boolean
  categoria_ua: CatUA[]
  config_alerta: ConfigAlerta
  lotacao_geral: { cabecas: number; ua_total: number; capacidade_total: number; ua_por_ha: number | null; pct: number | null }
  piquetes: Piquete[]
  piquetes_vazios: string[]
  alertas: Alerta[]
  gmd: { disponivel: boolean; pesagens: number }
}

export default function ManejoPastoPage() {
  const { companyId } = useEmpresaSelecionada()
  const [p, setP] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [editUA, setEditUA] = useState(false)
  const [uaDraft, setUaDraft] = useState<Record<string, string>>({})
  const [avalPiquete, setAvalPiquete] = useState<string>('')
  const [avalMetodo, setAvalMetodo] = useState<'visual' | 'altura_cm' | 'oferta_ms'>('visual')
  const [avalVisual, setAvalVisual] = useState<'bom' | 'regular' | 'ruim'>('bom')
  const [avalNum, setAvalNum] = useState('')
  const [editCfg, setEditCfg] = useState(false)
  const [cfgDraft, setCfgDraft] = useState<{ lotacao_pct: string; dias_min: string; altura_cm_min: string }>({ lotacao_pct: '', dias_min: '', altura_cm_min: '' })
  const [busy, setBusy] = useState(false)
  // Capacidade ideal do piquete (fonte única · erp_pec_area) — modal compartilhado.
  const [capEdit, setCapEdit] = useState<Piquete | null>(null)
  // Forrageiras: lista + mapa areaId→forrageira_id + cadastro
  const [forrageiras, setForrageiras] = useState<Forrageira[]>([])
  const [forrDeArea, setForrDeArea] = useState<Record<string, string | null>>({})
  const [forrEdit, setForrEdit] = useState<{ id?: string; nome: string; ua_ha_sugerido: string; observacao: string } | null>(null)
  const [showForr, setShowForr] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const [{ data }, fr, areasF] = await Promise.all([
      supabase.rpc('fn_pec_manejo_pasto_painel', { p_company_id: companyId }),
      supabase.rpc('fn_pec_forrageira_listar', { p_company_id: companyId }),
      supabase.from('erp_pec_area').select('id,forrageira_id').eq('company_id', companyId).eq('tipo', 'piquete'),
    ])
    setP((data ?? null) as Painel | null)
    setForrageiras(((fr.data as { forrageiras?: Forrageira[] } | null)?.forrageiras) ?? [])
    const map: Record<string, string | null> = {}
    for (const a of (areasF.data ?? []) as Array<{ id: string; forrageira_id: string | null }>) map[a.id] = a.forrageira_id
    setForrDeArea(map)
    setLoading(false)
  }, [companyId])
  useEffect(() => { carregar() }, [carregar])

  const salvarUA = async () => {
    if (!companyId || !p) return
    setBusy(true); setMsg(null)
    try {
      for (const c of p.categoria_ua) {
        const v = parseFloat(uaDraft[c.categoria] ?? String(c.ua_valor))
        // confirmar (mesmo sem mudar valor) marca confirmado=true; RD-49
        if (!isNaN(v)) {
          await supabase.rpc('fn_pec_categoria_ua_salvar', { p_company_id: companyId, p_categoria: c.categoria, p_ua_valor: v })
        }
      }
      setMsg('UA confirmada com o número da fazenda.'); setEditUA(false)
      await carregar()
    } catch (e) { setMsg('❌ ' + (e as Error).message) } finally { setBusy(false) }
  }

  const salvarCfg = async () => {
    if (!companyId) return
    setBusy(true); setMsg(null)
    try {
      await supabase.rpc('fn_pec_config_alerta_salvar', {
        p_company_id: companyId,
        p_lotacao_pct: parseFloat(cfgDraft.lotacao_pct),
        p_dias_min: parseInt(cfgDraft.dias_min, 10),
        p_altura_cm_min: parseFloat(cfgDraft.altura_cm_min),
      })
      setMsg('Limiares de alerta ajustados para a fazenda.'); setEditCfg(false)
      await carregar()
    } catch (e) { setMsg('❌ ' + (e as Error).message) } finally { setBusy(false) }
  }

  const registrarAval = async () => {
    if (!companyId || !avalPiquete) { setMsg('Escolha o piquete.'); return }
    setBusy(true); setMsg(null)
    try {
      const args: Record<string, unknown> = { p_company_id: companyId, p_area_id: avalPiquete, p_metodo: avalMetodo }
      if (avalMetodo === 'visual') args.p_valor_txt = avalVisual
      else args.p_valor_num = parseFloat(avalNum)
      const { data } = await supabase.rpc('fn_pec_avaliacao_pasto_registrar', args)
      if ((data as { ok?: boolean })?.ok === false) throw new Error((data as { erro?: string }).erro || 'falha')
      setMsg('Avaliação registrada.'); setAvalNum('')
      await carregar()
    } catch (e) { setMsg('❌ ' + (e as Error).message) } finally { setBusy(false) }
  }

  const piquetesOrd = useMemo(() => p?.piquetes ?? [], [p])

  // — Capacidade ideal: modal compartilhado (CapacidadeIdealModal). r2 usado no card. —
  const r2 = (n: number) => Math.round(n * 100) / 100
  // — Cadastro de forrageiras (referência UA/ha) —
  const salvarForr = async () => {
    if (!companyId || !forrEdit?.nome?.trim()) { setMsg('Informe o nome da forrageira.'); return }
    setBusy(true); setMsg(null)
    try {
      const dados = { id: forrEdit.id, nome: forrEdit.nome.trim(), ua_ha_sugerido: forrEdit.ua_ha_sugerido.replace(',', '.'), observacao: forrEdit.observacao }
      const { data } = await supabase.rpc('fn_pec_forrageira_salvar', { p_company_id: companyId, p_dados: dados })
      if ((data as { ok?: boolean })?.ok === false) throw new Error((data as { erro?: string }).erro || 'falha')
      setMsg('Forrageira salva.'); setForrEdit(null); await carregar()
    } catch (e) { setMsg('❌ ' + (e as Error).message) } finally { setBusy(false) }
  }
  const addForrSugerida = async (nome: string, ua: number) => {
    if (!companyId) return
    setBusy(true); setMsg(null)
    try {
      await supabase.rpc('fn_pec_forrageira_salvar', { p_company_id: companyId, p_dados: { nome, ua_ha_sugerido: String(ua) } })
      await carregar()
    } catch (e) { setMsg('❌ ' + (e as Error).message) } finally { setBusy(false) }
  }

  if (!companyId) return <div style={{ minHeight: '100vh', background: BG, padding: 24, color: ESP60, fontSize: 13 }}>Selecione uma empresa específica no topo para abrir o Manejo de Pasto.</div>

  const lg = p?.lotacao_geral
  const semGeral = !lg?.pct ? 'cinza' : lg.pct > 100 ? 'vermelho' : lg.pct > 85 ? 'amarelo' : 'verde'

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '16px 14px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: 12 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 24 }}>🌾</span>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: ESP, margin: 0 }}>Manejo de Pasto</h1>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: ESP60 }}>dados ao vivo</span>
        </header>

        {msg && <div style={{ background: '#EEF6EE', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: ESP }}>{msg}</div>}

        {loading ? <div style={{ color: ESP60, fontSize: 13, padding: 24 }}>Carregando pasto…</div> : !p ? null : (
          <>
            {/* ── TAXA DE LOTAÇÃO GERAL ── */}
            <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Taxa de lotação geral</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: SEM[semGeral].cor }}>{lg?.ua_por_ha ?? '—'} <span style={{ fontSize: 14, color: ESP60 }}>UA/ha</span></span>
                <span style={{ fontSize: 16, fontWeight: 700, color: ESP }}>{lg?.pct ?? '—'}% da capacidade</span>
              </div>
              <div style={{ fontSize: 12, color: ESP60, marginTop: 4 }}>
                {lg?.cabecas} cabeças = {lg?.ua_total} UA / capacidade {lg?.capacidade_total} UA
              </div>
              {!p.ua_confirmado && (
                <div style={{ marginTop: 10, background: '#FBEED2', border: `1px solid ${GOLD}55`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#7A5A0F', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  ⚠️ UA padrão — confirme os valores com seu técnico (a taxa de lotação real depende disso).
                  <button onClick={() => { setEditUA(true); setUaDraft(Object.fromEntries(p.categoria_ua.map(c => [c.categoria, String(c.ua_valor)]))) }}
                    style={{ marginLeft: 'auto', background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Ajustar UA</button>
                </div>
              )}
              {editUA && (
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {p.categoria_ua.map(c => (
                    <div key={c.categoria} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, color: ESP, width: 90, textTransform: 'capitalize' }}>{c.categoria}</span>
                      <input type="number" step="0.05" value={uaDraft[c.categoria] ?? String(c.ua_valor)}
                        onChange={e => setUaDraft(d => ({ ...d, [c.categoria]: e.target.value }))}
                        style={{ width: 90, padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13 }} />
                      <span style={{ fontSize: 11, color: ESP60 }}>UA {c.confirmado ? '· confirmado' : '· padrão'}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={salvarUA} disabled={busy} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Confirmar valores da fazenda</button>
                    <button onClick={() => setEditUA(false)} style={{ background: 'transparent', color: ESP60, border: `1px solid ${LINE}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                  </div>
                </div>
              )}
            </section>

            {/* ── O CORAÇÃO: ALERTAS DE ROTAÇÃO ── */}
            {p.alertas.length > 0 && (
              <section style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>⚠️ Hora de mover ({p.alertas.length})</div>
                {p.alertas.map((a, i) => (
                  <div key={i} style={{ background: '#FEE2E2', border: '1px solid #DC262633', borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#B91C1C' }}>🔴 {a.piquete} — {a.motivo}</div>
                    <div style={{ fontSize: 12, color: ESP, marginTop: 4 }}>{a.cab} cabeças. Mover para piquete vazio:</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {a.sugestao_mover_para.slice(0, 6).map(n => (
                        <span key={n} style={{ fontSize: 11, background: '#DCFCE7', color: '#166534', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>{n}</span>
                      ))}
                      {a.sugestao_mover_para.length > 6 && <span style={{ fontSize: 11, color: ESP60 }}>+{a.sugestao_mover_para.length - 6}</span>}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* ── CONFIG DOS LIMIARES DO ALERTA (varia por tipo de pasto) ── */}
            <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px' }}>
              {!editCfg ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: ESP60 }}>
                  ⚙️ Alerta dispara: lotação &gt; <b style={{ color: ESP }}>{p.config_alerta.lotacao_pct}%</b> · ≥ <b style={{ color: ESP }}>{p.config_alerta.dias_min}</b> dias · capim &lt; <b style={{ color: ESP }}>{p.config_alerta.altura_cm_min}cm</b>
                  {!p.config_alerta.confirmado && <span style={{ color: '#7A5A0F' }}>· padrão, ajuste por tipo de pasto</span>}
                  <button onClick={() => { setEditCfg(true); setCfgDraft({ lotacao_pct: String(p.config_alerta.lotacao_pct), dias_min: String(p.config_alerta.dias_min), altura_cm_min: String(p.config_alerta.altura_cm_min) }) }}
                    style={{ marginLeft: 'auto', background: 'transparent', color: GOLD, border: `1px solid ${LINE}`, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Ajustar</button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 12, color: ESP60 }}>Limiares do alerta (braquiária/mombaça/tifton pedem valores diferentes):</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {([['lotacao_pct', 'Lotação % >'], ['dias_min', 'Dias ≥'], ['altura_cm_min', 'Capim cm <']] as const).map(([k, lbl]) => (
                      <label key={k} style={{ fontSize: 12, color: ESP60 }}>{lbl}<br />
                        <input type="number" value={cfgDraft[k]} onChange={e => setCfgDraft(d => ({ ...d, [k]: e.target.value }))}
                          style={{ width: 80, padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13 }} /></label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={salvarCfg} disabled={busy} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Salvar limiares da fazenda</button>
                    <button onClick={() => setEditCfg(false)} style={{ background: 'transparent', color: ESP60, border: `1px solid ${LINE}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                  </div>
                </div>
              )}
            </section>

            {/* ── MAPA DOS PIQUETES ── */}
            <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Mapa dos {piquetesOrd.length} piquetes</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {piquetesOrd.map(pq => {
                  const s = SEM[pq.semaforo] ?? SEM.cinza
                  const av = pq.ultima_avaliacao
                  const uaha = Number(pq.area_ha) > 0 && Number(pq.capacidade_ua) ? r2(Number(pq.capacidade_ua) / Number(pq.area_ha)) : null
                  const forrNome = forrageiras.find((x) => x.id === forrDeArea[pq.id])?.nome ?? null
                  return (
                    <div key={pq.id} style={{ border: `1px solid ${LINE}`, borderLeft: `4px solid ${s.cor}`, borderRadius: 10, padding: 10, background: pq.vazio ? BG : '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{pq.nome}
                          {uaha != null && <span style={{ fontSize: 10, fontWeight: 600, color: ESP60 }}> · {uaha} UA/ha</span>}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: s.cor, background: s.bg, padding: '1px 6px', borderRadius: 5 }}>{pq.vazio ? 'vazio' : `${pq.pct}%`}</span>
                      </div>
                      {forrNome && <div style={{ fontSize: 10, color: GOLD, marginTop: 2 }}>🌱 {forrNome}</div>}
                      <div style={{ fontSize: 11, color: ESP60, marginTop: 3 }}>
                        {pq.cab} cab · {pq.ua_atual}/{pq.capacidade_ua} UA · {pq.area_ha}ha
                      </div>
                      <div style={{ fontSize: 10, color: ESP60, marginTop: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span>
                          {pq.vazio ? 'sem gado' : `há ${pq.dias_ocupado} dias`}
                          {' · '}
                          {av ? (av.metodo === 'visual' ? `pasto ${av.valor_txt}` : `${av.valor_num}${av.metodo === 'altura_cm' ? 'cm' : ' kg/ha'}`) : 'sem avaliação'}
                        </span>
                        <button onClick={() => setCapEdit(pq)} title="Editar capacidade ideal (UA/ha)" style={{ background: 'transparent', border: 'none', color: GOLD, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', padding: 0 }}>✎ capacidade</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* ── MODAL: Capacidade ideal do piquete (componente compartilhado) ── */}
            {capEdit && (
              <CapacidadeIdealModal
                companyId={companyId}
                area={{ id: capEdit.id, nome: capEdit.nome, area_ha: capEdit.area_ha, capacidade_ua: capEdit.capacidade_ua, forrageira_id: forrDeArea[capEdit.id] ?? null }}
                forrageiras={forrageiras}
                onClose={() => setCapEdit(null)}
                onSaved={(m) => { setMsg(m); setCapEdit(null); void carregar() }}
              />
            )}

            {/* ── FORRAGEIRAS (referência UA/ha, editável) ── */}
            <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setShowForr((s) => !s)}>
                <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>🌱 Forrageiras — referência UA/ha ({forrageiras.length})</div>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: GOLD }}>{showForr ? 'ocultar ▲' : 'gerenciar ▼'}</span>
              </div>
              {showForr && (
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 11, color: ESP60 }}>UA/ha de referência — ponto de partida por forrageira. Ajuste conforme solo, manejo e época.</div>

                  {/* lista */}
                  {forrageiras.map((f) => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderBottom: `1px dashed ${LINE}`, paddingBottom: 6 }}>
                      <span style={{ fontSize: 13, color: ESP, fontWeight: 600, flex: 1, minWidth: 140 }}>{f.nome}</span>
                      <span style={{ fontSize: 12, color: ESP60 }}>{f.ua_ha_sugerido != null ? `${f.ua_ha_sugerido} UA/ha` : 'sem referência'}</span>
                      <button onClick={() => setForrEdit({ id: f.id, nome: f.nome, ua_ha_sugerido: f.ua_ha_sugerido != null ? String(f.ua_ha_sugerido) : '', observacao: f.observacao ?? '' })}
                        style={{ background: 'transparent', color: GOLD, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>editar</button>
                    </div>
                  ))}

                  {/* sugestões rápidas (só as que ainda não existem) */}
                  {SUGESTOES_FORR.filter(([n]) => !forrageiras.some((f) => f.nome.toLowerCase() === n.toLowerCase())).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: ESP60 }}>Referências comuns:</span>
                      {SUGESTOES_FORR.filter(([n]) => !forrageiras.some((f) => f.nome.toLowerCase() === n.toLowerCase())).map(([n, ua]) => (
                        <button key={n} onClick={() => void addForrSugerida(n, ua)} disabled={busy}
                          style={{ fontSize: 11, background: BG, color: ESP, border: `1px solid ${LINE}`, borderRadius: 999, padding: '3px 10px', cursor: 'pointer' }}>+ {n} ({ua})</button>
                      ))}
                    </div>
                  )}

                  {/* form add/editar */}
                  {forrEdit ? (
                    <div style={{ display: 'grid', gap: 6, background: BG, borderRadius: 10, padding: 10 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input value={forrEdit.nome} onChange={(e) => setForrEdit({ ...forrEdit, nome: e.target.value })} placeholder="Nome (ex.: Panicum Mombaça)"
                          style={{ flex: 2, minWidth: 160, padding: '7px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }} />
                        <input type="number" step="0.1" value={forrEdit.ua_ha_sugerido} onChange={(e) => setForrEdit({ ...forrEdit, ua_ha_sugerido: e.target.value })} placeholder="UA/ha"
                          style={{ width: 90, padding: '7px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }} />
                      </div>
                      <input value={forrEdit.observacao} onChange={(e) => setForrEdit({ ...forrEdit, observacao: e.target.value })} placeholder="Observação (opcional)"
                        style={{ padding: '7px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={salvarForr} disabled={busy} style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{forrEdit.id ? 'Salvar' : 'Adicionar'}</button>
                        <button onClick={() => setForrEdit(null)} style={{ background: 'transparent', color: ESP60, border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setForrEdit({ nome: '', ua_ha_sugerido: '', observacao: '' })}
                      style={{ width: 'fit-content', background: 'transparent', color: GOLD, border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Nova forrageira</button>
                  )}
                </div>
              )}
            </section>

            {/* ── AVALIAÇÃO DE PASTO ── */}
            <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Avaliar pasto</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <select value={avalPiquete} onChange={e => setAvalPiquete(e.target.value)} style={{ padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }}>
                  <option value="">Selecione o piquete…</option>
                  {piquetesOrd.map(pq => <option key={pq.id} value={pq.id}>{pq.nome}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {([['visual', '👁️ Visual'], ['altura_cm', '📏 Altura cm'], ['oferta_ms', '⚖️ Oferta kg/ha']] as const).map(([m, lbl]) => (
                    <button key={m} onClick={() => setAvalMetodo(m)} style={{ background: avalMetodo === m ? ESP : 'transparent', color: avalMetodo === m ? '#fff' : ESP, border: `1px solid ${LINE}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{lbl}</button>
                  ))}
                </div>
                {avalMetodo === 'visual' ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {([['bom', '🟢 Bom'], ['regular', '🟡 Regular'], ['ruim', '🔴 Ruim']] as const).map(([v, lbl]) => (
                      <button key={v} onClick={() => setAvalVisual(v)} style={{ background: avalVisual === v ? '#EEF6EE' : 'transparent', color: ESP, border: `1px solid ${avalVisual === v ? GOLD : LINE}`, borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>{lbl}</button>
                    ))}
                  </div>
                ) : (
                  <input type="number" step="0.1" value={avalNum} onChange={e => setAvalNum(e.target.value)} placeholder={avalMetodo === 'altura_cm' ? 'altura em cm' : 'kg MS/ha'} style={{ width: 180, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13 }} />
                )}
                <button onClick={registrarAval} disabled={busy} style={{ width: 'fit-content', background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>Registrar avaliação</button>
              </div>
            </section>

            {/* ── DESCANSO (empty state honesto) ── */}
            <section style={{ background: BG, border: `1px dashed ${LINE}`, borderRadius: 12, padding: 14, fontSize: 12, color: ESP60 }}>
              🌱 <b style={{ color: ESP }}>Descanso dos piquetes</b> — começa a ser medido a partir da 1ª movimentação registrada aqui (com origem→destino). O histórico antigo não tinha de-onde-saiu, então não inventamos o passado.
            </section>

            {/* ── GMD empty state ── */}
            {!p.gmd.disponivel && (
              <section style={{ background: BG, border: `1px dashed ${LINE}`, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>🌱 Ganho de peso (GMD)</div>
                <div style={{ fontSize: 12, color: ESP60, margin: '4px 0 8px' }}>Registre pesagens e desbloqueie o ganho diário do rebanho por piquete/lote. ({p.gmd.pesagens} pesagens hoje)</div>
                <Link href="/dashboard/agro/manejo" style={{ fontSize: 13, color: GOLD, fontWeight: 600 }}>Fazer a 1ª pesagem →</Link>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
