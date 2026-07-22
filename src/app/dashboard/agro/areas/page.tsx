'use client'

// "Áreas da Propriedade" (multi-atividade). Nada hardcoded: uso/linha/posse cadastráveis.
// Painel de rateio mostra o % CALCULADO (nunca digitado) com a memória visível.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada, usePropriedade } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#5C8D3F'; const RED = '#C44536'

const USOS = ['pastagem','lavoura','silvicultura','aquicultura','benfeitoria','reserva_legal','app','infraestrutura','outro'] as const
const IMPRODUTIVOS = ['reserva_legal','app','infraestrutura']
const POSSES = ['propria','arrendada_de','arrendada_para','parceria'] as const
const DRIVERS = ['area','ua','receita','headcount','manual'] as const

type Area = {
  id: string; nome: string; uso: string; area_ha: number; business_line_id: string | null
  entra_rateio: boolean; capacidade_ua: number | null; posse: string; contraparte: string | null
  contrato_ref: string | null; ativo: boolean
}
type BL = { id: string; name: string }
type BaseRow = { business_line_id: string; nome: string; base: number; percentual: number }

function fmtNum(n: number | null | undefined, d = 2): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function hoje(): string { return new Date().toISOString().slice(0, 10) }

export default function AreasPropriedadePage() {
  const { companyId } = useEmpresaSelecionada()
  const { propriedade } = usePropriedade(companyId)
  const empresaUnica = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [areas, setAreas] = useState<Area[]>([])
  const [bls, setBls] = useState<BL[]>([])
  const [driver, setDriver] = useState<string>('receita')
  const [incluirImprod, setIncluirImprod] = useState(false)
  const [cfgId, setCfgId] = useState<string | null>(null)
  const [base, setBase] = useState<BaseRow[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // form
  const vazio = { nome: '', uso: 'pastagem', area_ha: '', business_line_id: '', entra_rateio: true, capacidade_ua: '', posse: 'propria', contraparte: '', contrato_ref: '' }
  const [f, setF] = useState<typeof vazio>({ ...vazio })
  const [editId, setEditId] = useState<string | null>(null)

  const blNome = useCallback((id: string | null) => id ? (bls.find((b) => b.id === id)?.name ?? '—') : '— não alocada', [bls])

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    const [ar, bl, cf] = await Promise.all([
      supabase.from('erp_propriedade_area').select('id,nome,uso,area_ha,business_line_id,entra_rateio,capacidade_ua,posse,contraparte,contrato_ref,ativo').eq('company_id', empresaUnica).eq('ativo', true).order('uso').order('nome'),
      supabase.from('business_lines').select('id,name').eq('company_id', empresaUnica).order('ln_number'),
      supabase.from('rateio_config_empresa').select('id,driver,incluir_area_improdutiva').eq('company_id', empresaUnica).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    setAreas((ar.data ?? []) as Area[])
    setBls((bl.data ?? []) as BL[])
    if (cf.data) { setCfgId(cf.data.id); setDriver(cf.data.driver ?? 'receita'); setIncluirImprod(!!cf.data.incluir_area_improdutiva) }
  }, [empresaUnica])

  useEffect(() => { void carregar() }, [carregar])

  const calcularBase = useCallback(async () => {
    if (!empresaUnica) return
    const { data, error } = await supabase.rpc('fn_rateio_base', { p_company_id: empresaUnica, p_data_ref: hoje() })
    if (error) { setMsg('Erro no cálculo: ' + error.message); setBase([]) }
    else setBase((data ?? []) as BaseRow[])
  }, [empresaUnica])

  useEffect(() => { void calcularBase() }, [calcularBase, areas, driver, incluirImprod])

  async function salvarConfig(novoDriver: string, novoIncluir: boolean) {
    if (!empresaUnica) return
    setDriver(novoDriver); setIncluirImprod(novoIncluir)
    if (cfgId) {
      await supabase.from('rateio_config_empresa').update({ driver: novoDriver, incluir_area_improdutiva: novoIncluir, updated_at: new Date().toISOString() }).eq('id', cfgId)
    } else {
      const { data } = await supabase.from('rateio_config_empresa').insert({ company_id: empresaUnica, driver: novoDriver, incluir_area_improdutiva: novoIncluir }).select('id').maybeSingle()
      if (data) setCfgId(data.id)
    }
    await calcularBase()
  }

  async function salvarArea() {
    if (!empresaUnica || !propriedade?.id) { setMsg('Cadastre a propriedade antes.'); return }
    const ha = Number(String(f.area_ha).replace(',', '.'))
    if (!f.nome || !ha || ha <= 0) { setMsg('Nome e hectares (>0) são obrigatórios.'); return }
    setBusy(true); setMsg(null)
    const payload = {
      company_id: empresaUnica, propriedade_id: propriedade.id, nome: f.nome, uso: f.uso, area_ha: ha,
      business_line_id: f.business_line_id || null, entra_rateio: f.entra_rateio,
      capacidade_ua: f.uso === 'pastagem' && f.capacidade_ua ? Number(String(f.capacidade_ua).replace(',', '.')) : null,
      posse: f.posse, contraparte: f.contraparte || null, contrato_ref: f.contrato_ref || null,
    }
    const { error } = editId
      ? await supabase.from('erp_propriedade_area').update(payload).eq('id', editId)
      : await supabase.from('erp_propriedade_area').insert(payload)
    if (error) setMsg('Erro: ' + error.message)
    else { setMsg('Área salva.'); setF({ ...vazio }); setEditId(null); await carregar() }
    setBusy(false)
  }

  function editar(a: Area) {
    setEditId(a.id)
    setF({ nome: a.nome, uso: a.uso, area_ha: String(a.area_ha), business_line_id: a.business_line_id ?? '', entra_rateio: a.entra_rateio, capacidade_ua: a.capacidade_ua != null ? String(a.capacidade_ua) : '', posse: a.posse, contraparte: a.contraparte ?? '', contrato_ref: a.contrato_ref ?? '' })
  }

  async function toggleRateio(a: Area) {
    await supabase.from('erp_propriedade_area').update({ entra_rateio: !a.entra_rateio }).eq('id', a.id)
    await carregar()
  }

  const resumo = useMemo(() => {
    let prod = 0, improd = 0
    for (const a of areas) { if (IMPRODUTIVOS.includes(a.uso)) improd += Number(a.area_ha); else prod += Number(a.area_ha) }
    return { prod, improd, total: prod + improd }
  }, [areas])
  const totalBase = useMemo(() => base.reduce((s, b) => s + Number(b.base), 0), [base])

  if (!empresaUnica) return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica.</div>

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>🗺️ Áreas da Propriedade</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 16 }}>{propriedade?.nome ?? 'Propriedade'} — multi-atividade. O rateio calcula o % sozinho; você não digita percentual.</div>
      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: msg.startsWith('Erro') ? RED : GREEN }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        {/* coluna esquerda: cadastro + lista */}
        <div>
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{editId ? 'Editar área' : 'Nova área'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 10 }}>
              <label style={lbl}>Nome<input style={inp} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
              <label style={lbl}>Uso<select style={inp} value={f.uso} onChange={(e) => setF({ ...f, uso: e.target.value })}>{USOS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
              <label style={lbl}>Hectares<input style={inp} value={f.area_ha} onChange={(e) => setF({ ...f, area_ha: e.target.value })} placeholder="0,00" /></label>
              <label style={lbl}>Linha de negócio<select style={inp} value={f.business_line_id} onChange={(e) => setF({ ...f, business_line_id: e.target.value })}><option value="">— não alocada (comum) —</option>{bls.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label style={lbl}>Posse<select style={inp} value={f.posse} onChange={(e) => setF({ ...f, posse: e.target.value })}>{POSSES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
              {f.posse !== 'propria' && <label style={lbl}>Contraparte<input style={inp} value={f.contraparte} onChange={(e) => setF({ ...f, contraparte: e.target.value })} /></label>}
              {f.posse !== 'propria' && <label style={lbl}>Contrato ref<input style={inp} value={f.contrato_ref} onChange={(e) => setF({ ...f, contrato_ref: e.target.value })} /></label>}
              {f.uso === 'pastagem' && <label style={lbl}>Capacidade UA<input style={inp} value={f.capacidade_ua} onChange={(e) => setF({ ...f, capacidade_ua: e.target.value })} /></label>}
              <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}><input type="checkbox" checked={f.entra_rateio} onChange={(e) => setF({ ...f, entra_rateio: e.target.checked })} /> Entra no rateio</label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => void salvarArea()} disabled={busy} style={btnPri}>{editId ? 'Salvar' : 'Adicionar área'}</button>
              {editId && <button onClick={() => { setEditId(null); setF({ ...vazio }) }} style={btnSec}>Cancelar</button>}
            </div>
          </div>

          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Áreas ({areas.length}) · total {fmtNum(resumo.total)} ha</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: ESP60, textAlign: 'left' }}>
                  <th style={th}>Nome</th><th style={th}>Uso</th><th style={{ ...th, textAlign: 'right' }}>ha</th><th style={th}>Linha</th><th style={th}>Posse</th><th style={{ ...th, textAlign: 'center' }}>Rateio</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {areas.map((a) => (
                    <tr key={a.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={td}>{a.nome}</td>
                      <td style={td}>{a.uso}{IMPRODUTIVOS.includes(a.uso) && <span style={{ color: ESP60 }}> (improd.)</span>}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtNum(a.area_ha)}</td>
                      <td style={td}>{blNome(a.business_line_id)}</td>
                      <td style={td}>{a.posse}{a.contraparte ? ` · ${a.contraparte}` : ''}</td>
                      <td style={{ ...td, textAlign: 'center' }}><button onClick={() => void toggleRateio(a)} style={{ ...chip, background: a.entra_rateio ? '#E8F4DC' : '#eee', color: a.entra_rateio ? GREEN : ESP60 }}>{a.entra_rateio ? 'sim' : 'não'}</button></td>
                      <td style={td}><button onClick={() => editar(a)} style={linkBtn}>editar</button></td>
                    </tr>
                  ))}
                  {areas.length === 0 && <tr><td style={td} colSpan={7}>Nenhuma área cadastrada.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: ESP60 }}>
              Produtivo: <b>{fmtNum(resumo.prod)} ha</b> · Improdutivo: <b>{fmtNum(resumo.improd)} ha</b>
            </div>
          </div>
        </div>

        {/* coluna direita: config + painel de rateio calculado */}
        <div style={{ position: 'sticky', top: 16 }}>
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Driver do rateio</div>
            <select style={inp} value={driver} onChange={(e) => void salvarConfig(e.target.value, incluirImprod)}>
              {DRIVERS.map((d) => <option key={d} value={d}>{d === 'area' ? 'Área (ha)' : d === 'ua' ? 'UA (unidade animal)' : d === 'receita' ? 'Receita' : d === 'headcount' ? 'Headcount' : 'Manual'}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: ESP60 }}>
              <input type="checkbox" checked={incluirImprod} onChange={(e) => void salvarConfig(driver, e.target.checked)} disabled={driver !== 'area'} />
              Incluir área improdutiva (reserva/APP/infra)
            </label>
          </div>

          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Rateio calculado</div>
            <div style={{ fontSize: 11, color: ESP60, marginBottom: 10 }}>% é sempre calculado do driver. Read-only.</div>
            {base.length === 0 && (
              <div style={{ fontSize: 12, color: '#9A6A00', background: '#FBF3E0', padding: 8, borderRadius: 6 }}>
                Nenhuma base elegível para o driver "{driver}". Aloque áreas a linhas de negócio (ou cadastre receita/headcount) — nada é assumido (RD-51).
              </div>
            )}
            {base.map((b) => (
              <div key={b.business_line_id} style={{ padding: '6px 0', borderBottom: `1px dashed ${LINE}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <b>{b.nome}</b><b style={{ color: GOLD }}>{fmtNum(b.percentual, 2)}%</b>
                </div>
                <div style={{ fontSize: 11, color: ESP60 }}>{fmtNum(b.base)} {driver === 'area' ? 'ha' : driver === 'ua' ? 'UA' : driver === 'receita' ? 'R$' : ''} ÷ {fmtNum(totalBase)} = {fmtNum(b.percentual, 2)}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { display: 'block', width: '100%', padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13, marginTop: 3, background: '#fff', color: ESP }
const lbl: React.CSSProperties = { fontSize: 12, color: ESP60 }
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' }
const chip: React.CSSProperties = { border: 'none', borderRadius: 10, padding: '2px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const btnPri: React.CSSProperties = { padding: '8px 14px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
const btnSec: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
