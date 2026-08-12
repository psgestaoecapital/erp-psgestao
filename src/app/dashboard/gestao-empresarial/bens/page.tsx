'use client'

// "Bens & Imobilizado" (GE genérico). Cadastro de bens + depreciação gerencial + baixa/venda.
// Vida útil SUGERIDA pela natureza (editável). Sem vida útil => alerta "falta parâmetro" (RD-51).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#5C8D3F'; const RED = '#C44536'

const NATUREZAS = ['terreno','edificacao','benfeitoria','maquina','equipamento','veiculo','movel_utensilio','computador','software','instalacao','semovente','cultura_permanente','participacao','outro'] as const
const STATUS = ['ativo','em_construcao','baixado','vendido','sinistrado'] as const

type Bem = {
  id: string; codigo: string | null; descricao: string; natureza: string; data_aquisicao: string
  valor_aquisicao: number; deprecia: boolean; vida_util_meses: number | null; metodo_depreciacao: string
  business_line_id: string | null; business_line_nome: string | null; centro_custo: string | null
  status: string; dep_acumulada: number; valor_contabil: number; falta_parametro: boolean
}
type BL = { id: string; name: string }
type NatPadrao = { natureza: string; vida_util_meses: number | null; deprecia: boolean }

type IndNat = { natureza: string; qtd: number; valor_aquisicao: number; deprec_acumulada: number; valor_contabil: number; pct_depreciado: number; taxa_aa_media: number | null; deprecia: boolean }
type IndLinha = { linha: string; valor_aquisicao: number; valor_contabil: number }
type IndConsol = { qtd: number; valor_aquisicao: number; deprec_acumulada: number; valor_contabil: number; pct_depreciado: number }
type Indicadores = {
  ok: boolean
  consolidado: IndConsol
  por_natureza: IndNat[] | null
  por_linha: IndLinha[] | null
  terras: { valor: number; qtd: number; nao_deprecia_ok: boolean }
  deprec_exercicio: number
  deprec_acelerada_potencial: number
  conformidade: { bem: string; alerta: string }[] | null
}

// cores por natureza p/ a barra de composição (fallback cinza p/ naturezas fora da lista)
const NAT_COR: Record<string, string> = {
  terreno: '#8C6A3F', benfeitoria: '#C8941A', edificacao: '#B07A12', maquina: '#5C8D3F', equipamento: '#7BA85B',
  veiculo: '#2E6E8E', instalacao: '#9A6A00', movel_utensilio: '#A88', computador: '#667', software: '#957DAd',
  semovente: '#C44536', cultura_permanente: '#4F7942',
}
const corNat = (n: string) => NAT_COR[n] ?? '#B7A78F'

function fmt(n: number | null | undefined): string { return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtc(n: number | null | undefined): string { return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }
function mesAtual(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

export default function BensPage() {
  const { companyId } = useEmpresaSelecionada()
  const empresaUnica = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [bens, setBens] = useState<Bem[]>([])
  const [bls, setBls] = useState<BL[]>([])
  const [ind, setInd] = useState<Indicadores | null>(null)
  const [padroes, setPadroes] = useState<Record<string, NatPadrao>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fNat, setFNat] = useState('')      // filtro natureza
  const [fStatus, setFStatus] = useState('ativo')
  const [compDep, setCompDep] = useState(mesAtual())

  const vazio = { codigo: '', descricao: '', natureza: 'maquina', data_aquisicao: new Date().toISOString().slice(0, 10), valor_aquisicao: '', deprecia: true, vida_util_meses: '', valor_residual: '', business_line_id: '', centro_custo: '' }
  const [f, setF] = useState<typeof vazio>({ ...vazio })
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    const [bn, bl, np, ic] = await Promise.all([
      supabase.rpc('fn_bem_listar', { p_company_id: empresaUnica }),
      supabase.from('business_lines').select('id,name').eq('company_id', empresaUnica).order('ln_number'),
      supabase.from('erp_bem_natureza_padrao').select('natureza,vida_util_meses,deprecia').is('company_id', null),
      supabase.rpc('fn_bem_indicadores', { p_company_id: empresaUnica }),
    ])
    setBens((bn.data ?? []) as Bem[])
    setBls((bl.data ?? []) as BL[])
    const ind0 = ic.data as Indicadores | null
    setInd(ind0 && ind0.ok ? ind0 : null)
    const p: Record<string, NatPadrao> = {}
    for (const r of (np.data ?? []) as NatPadrao[]) p[r.natureza] = r
    setPadroes(p)
  }, [empresaUnica])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  // ao trocar a natureza no form, sugere vida útil + deprecia (editável)
  function setNatureza(nat: string) {
    const pad = padroes[nat]
    setF((prev) => ({ ...prev, natureza: nat,
      vida_util_meses: pad?.vida_util_meses != null ? String(pad.vida_util_meses) : '',
      deprecia: pad ? pad.deprecia : true }))
  }

  async function salvar() {
    if (!empresaUnica) return
    const valor = Number(String(f.valor_aquisicao).replace(',', '.'))
    if (!f.descricao || !valor || valor < 0) { setMsg('Descrição e valor (≥0) são obrigatórios.'); return }
    setBusy(true); setMsg(null)
    const payload = {
      company_id: empresaUnica, codigo: f.codigo || null, descricao: f.descricao, natureza: f.natureza,
      data_aquisicao: f.data_aquisicao, valor_aquisicao: valor, deprecia: f.deprecia,
      vida_util_meses: f.deprecia && f.vida_util_meses ? Number(f.vida_util_meses) : null,
      valor_residual: f.valor_residual ? Number(String(f.valor_residual).replace(',', '.')) : 0,
      business_line_id: f.business_line_id || null, centro_custo: f.centro_custo || null,
      data_inicio_depreciacao: f.data_aquisicao,
    }
    const { error } = editId
      ? await supabase.from('erp_bem').update(payload).eq('id', editId)
      : await supabase.from('erp_bem').insert(payload)
    if (error) setMsg('Erro: ' + error.message)
    else { setMsg('Bem salvo.'); setF({ ...vazio }); setEditId(null); setShowForm(false); await carregar() }
    setBusy(false)
  }

  function editar(b: Bem) {
    setEditId(b.id); setShowForm(true)
    setF({ codigo: b.codigo ?? '', descricao: b.descricao, natureza: b.natureza, data_aquisicao: b.data_aquisicao,
      valor_aquisicao: String(b.valor_aquisicao), deprecia: b.deprecia, vida_util_meses: b.vida_util_meses != null ? String(b.vida_util_meses) : '',
      valor_residual: '', business_line_id: b.business_line_id ?? '', centro_custo: b.centro_custo ?? '' })
  }

  async function excluir(b: Bem) {
    if (!empresaUnica) return
    if (b.dep_acumulada > 0) { window.alert(`"${b.descricao}" já tem depreciação lançada. Não pode ser excluído — use "Baixar/Vender".`); return }
    if (!window.confirm(`Excluir o bem "${b.descricao}"? Esta ação não pode ser desfeita.`)) return
    const { error } = await supabase.from('erp_bem').delete().eq('id', b.id).eq('company_id', empresaUnica)
    if (error) setMsg('Erro: ' + error.message); else { setMsg('Bem excluído.'); await carregar() }
  }

  async function baixar(b: Bem) {
    if (!empresaUnica) return
    const tipo = window.prompt('Tipo (venda / baixa / sinistro):', 'venda')
    if (!tipo || !['venda', 'baixa', 'sinistro'].includes(tipo)) return
    const valorStr = tipo === 'venda' ? window.prompt(`Valor de ${tipo} (R$):`, '0') : '0'
    if (valorStr === null) return
    const just = window.prompt('Justificativa:', '') ?? ''
    const { data, error } = await supabase.rpc('fn_bem_baixar', {
      p_company_id: empresaUnica, p_bem_id: b.id, p_tipo: tipo, p_data: new Date().toISOString().slice(0, 10),
      p_valor: Number(String(valorStr).replace(',', '.')) || 0, p_justificativa: just,
    })
    if (error) { setMsg('Erro: ' + error.message); return }
    const r = data as { valor_contabil?: number; resultado?: number }
    setMsg(`${tipo} registrada · contábil R$ ${fmt(r?.valor_contabil)} · resultado R$ ${fmt(r?.resultado)}.`)
    await carregar()
  }

  async function gerarDepreciacao() {
    if (!empresaUnica) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_bem_calcular_depreciacao', { p_company_id: empresaUnica, p_competencia: compDep })
    if (error) setMsg('Erro: ' + error.message)
    else {
      const r = data as { bens_depreciados?: number; depreciacao_total?: number; faltando_parametro?: unknown[] }
      const falt = Array.isArray(r?.faltando_parametro) ? r.faltando_parametro.length : 0
      setMsg(`Depreciação do mês: ${r?.bens_depreciados ?? 0} bem(ns), R$ ${fmt(r?.depreciacao_total)}${falt ? ` · ⚠️ ${falt} sem parâmetro (não depreciados)` : ''}.`)
      await carregar()
    }
    setBusy(false)
  }

  const lista = useMemo(() => bens.filter((b) => (!fNat || b.natureza === fNat) && (!fStatus || b.status === fStatus)), [bens, fNat, fStatus])
  const faltando = useMemo(() => bens.filter((b) => b.falta_parametro && b.status === 'ativo'), [bens])

  // Filtro de natureza recalcula os cards de topo a partir do próprio por_natureza do indicador
  // (fonte única). Sem filtro → consolidado geral. O painel sempre reflete o imobilizado ATIVO.
  const natRows = useMemo<IndNat[]>(() => {
    const arr = ind?.por_natureza ?? []
    return fNat ? arr.filter((x) => x.natureza === fNat) : arr
  }, [ind, fNat])
  const consol = useMemo<IndConsol | null>(() => {
    if (!ind?.ok) return null
    if (!fNat) return ind.consolidado
    const n = (ind.por_natureza ?? []).find((x) => x.natureza === fNat)
    return n ? { qtd: n.qtd, valor_aquisicao: n.valor_aquisicao, deprec_acumulada: n.deprec_acumulada, valor_contabil: n.valor_contabil, pct_depreciado: n.pct_depreciado }
             : { qtd: 0, valor_aquisicao: 0, deprec_acumulada: 0, valor_contabil: 0, pct_depreciado: 0 }
  }, [ind, fNat])
  const totalComposicao = ind?.consolidado?.valor_aquisicao || 0

  if (!empresaUnica) return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica.</div>

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>🏢 Bens & Imobilizado</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 16 }}>Cadastro, depreciação gerencial e baixa/venda. Vida útil sugerida pela natureza (editável).</div>
      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: msg.startsWith('Erro') ? RED : GREEN }}>{msg}</div>}
      {faltando.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 13, color: '#9A6A00', background: '#FBF3E0', padding: 8, borderRadius: 6 }}>
          ⚠️ {faltando.length} bem(ns) sem vida útil — não serão depreciados até informar o parâmetro: {faltando.map((b) => b.descricao).join(', ')}
        </div>
      )}

      {/* ── INDICADORES (imobilizado ativo) ─────────────────────────────────────────── */}
      {consol && ind && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Indicadores</div>
            <div style={{ fontSize: 11.5, color: ESP60 }}>imobilizado ativo{fNat ? ` · filtrado: ${fNat}` : ''}</div>
          </div>

          {/* 1) Cards consolidados */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10 }}>
            <Tile titulo="Valor de aquisição" valor={`R$ ${fmt(consol.valor_aquisicao)}`} sub={`${consol.qtd} bem(ns)`} />
            <Tile titulo="Depreciação acumulada" valor={`R$ ${fmt(consol.deprec_acumulada)}`} />
            <Tile titulo="Valor contábil líquido" valor={`R$ ${fmt(consol.valor_contabil)}`} destaque />
            <Tile titulo="% depreciado" valor={`${fmt(consol.pct_depreciado)}%`} />
            <Tile titulo="Depreciação do exercício" valor={`R$ ${fmt(ind.deprec_exercicio)}`} sub={`${new Date().getFullYear()}`} />
          </div>

          {/* 2) Barra de composição por natureza (terras dominam — item 3) */}
          {totalComposicao > 0 && (ind.por_natureza?.length ?? 0) > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', border: `1px solid ${LINE}` }}>
                {(ind.por_natureza ?? []).map((n) => {
                  const pct = totalComposicao > 0 ? (n.valor_aquisicao / totalComposicao) * 100 : 0
                  return <div key={n.natureza} title={`${n.natureza}: ${pct.toFixed(1)}% (R$ ${fmtc(n.valor_aquisicao)})`}
                    style={{ width: `${pct}%`, background: corNat(n.natureza), opacity: fNat && fNat !== n.natureza ? 0.3 : 1 }} />
                })}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                {(ind.por_natureza ?? []).map((n) => (
                  <span key={n.natureza} style={{ fontSize: 10.5, color: ESP60, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: corNat(n.natureza), display: 'inline-block' }} />
                    {n.natureza} {totalComposicao > 0 ? ((n.valor_aquisicao / totalComposicao) * 100).toFixed(1) : '0'}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 3) Terras em destaque */}
          {ind.terras && ind.terras.qtd > 0 && (
            <div style={{ ...card, marginTop: 12, padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderLeft: `4px solid ${corNat('terreno')}` }}>
              <span style={{ fontSize: 22 }}>🌱</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: ESP60 }}>Terras (terreno) · {ind.terras.qtd} imóvel(is)</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>R$ {fmt(ind.terras.valor)}</div>
                <div style={{ fontSize: 11, color: ESP60 }}>
                  {totalComposicao > 0 ? ((ind.terras.valor / totalComposicao) * 100).toFixed(1) : '0'}% do imobilizado — não deprecia, por isso o “% depreciado” do total é baixo.
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                background: (ind.terras.nao_deprecia_ok ? GREEN : RED) + '18', color: ind.terras.nao_deprecia_ok ? GREEN : RED }}>
                {ind.terras.nao_deprecia_ok ? '✓ não deprecia' : '⚠ terra marcada como depreciável'}
              </span>
            </div>
          )}

          {/* 4) Por natureza (tabela) */}
          {natRows.length > 0 && (
            <div style={{ ...card, marginTop: 12, overflowX: 'auto', padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ color: ESP60, textAlign: 'left' }}>
                  <th style={th}>Natureza</th><th style={{ ...th, textAlign: 'right' }}>Qtd</th>
                  <th style={{ ...th, textAlign: 'right' }}>Aquisição</th><th style={{ ...th, textAlign: 'right' }}>Deprec. acum.</th>
                  <th style={{ ...th, textAlign: 'right' }}>Líquido</th><th style={{ ...th, textAlign: 'right' }}>% deprec.</th>
                  <th style={{ ...th, textAlign: 'right' }}>Taxa a.a. média</th>
                </tr></thead>
                <tbody>
                  {natRows.map((n) => (
                    <tr key={n.natureza} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: corNat(n.natureza), display: 'inline-block', marginRight: 6 }} />
                        {n.natureza}{!n.deprecia && <span style={{ color: ESP60, fontWeight: 400 }}> · não deprecia</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{n.qtd}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmt(n.valor_aquisicao)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmt(n.deprec_acumulada)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(n.valor_contabil)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmt(n.pct_depreciado)}%</td>
                      <td style={{ ...td, textAlign: 'right' }}>{n.taxa_aa_media != null ? `${fmt(n.taxa_aa_media)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 5) Por linha de negócio + Conformidade (agro) lado a lado */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))', gap: 12, marginTop: 12 }}>
            {(ind.por_linha?.length ?? 0) > 0 && (
              <div style={{ ...card, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Por linha de negócio</div>
                {(ind.por_linha ?? []).map((l) => (
                  <div key={l.linha} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
                    <span>{l.linha}</span>
                    <span style={{ color: ESP60 }}>aquis. R$ {fmtc(l.valor_aquisicao)} · líq. <b style={{ color: ESP }}>R$ {fmtc(l.valor_contabil)}</b></span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ ...card, padding: 12, borderLeft: `4px solid ${(ind.conformidade?.length ?? 0) > 0 ? RED : GREEN}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Conformidade (agro)</div>
              {(ind.conformidade?.length ?? 0) === 0
                ? <div style={{ fontSize: 12.5, color: GREEN, fontWeight: 600 }}>✓ Nenhum alerta — taxas, vida útil e terras coerentes.</div>
                : <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {(ind.conformidade ?? []).map((c, i) => (
                      <li key={i} style={{ fontSize: 12, color: '#9A6A00', marginBottom: 4 }}><b style={{ color: ESP }}>{c.bem}</b>: {c.alerta}</li>
                    ))}
                  </ul>}
              {ind.deprec_acelerada_potencial > 0 && (
                <div style={{ fontSize: 11, color: ESP60, marginTop: 8, borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
                  Potencial de dedução acelerada rural no exercício: <b style={{ color: ESP }}>R$ {fmt(ind.deprec_acelerada_potencial)}</b> (benefício fiscal/LALUR — não altera a escrituração contábil).
                </div>
              )}
            </div>
          </div>

          {/* 6) Nota fixa — ativo biológico */}
          <div style={{ fontSize: 11, color: ESP60, marginTop: 10, lineHeight: 1.5 }}>
            🐂 O rebanho é <b>ativo biológico</b> (CPC 29 / NBC TG 29), mensurado a valor justo no módulo Pecuária — <b>não</b> integra este imobilizado.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); setF({ ...vazio }) }} style={btnPri}>{showForm ? 'Fechar' : '+ Novo bem'}</button>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: ESP60 }}>Depreciar mês <input type="date" value={compDep} onChange={(e) => setCompDep(e.target.value)} style={inp} /></label>
        <button onClick={() => void gerarDepreciacao()} disabled={busy} style={btnSec}>⚙️ Gerar depreciação do mês</button>
      </div>

      {showForm && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{editId ? 'Editar bem' : 'Novo bem'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: 10 }}>
            <label style={lbl}>Código/plaqueta<input style={inp} value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></label>
            <label style={lbl}>Descrição<input style={inp} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
            <label style={lbl}>Natureza<select style={inp} value={f.natureza} onChange={(e) => setNatureza(e.target.value)}>{NATUREZAS.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label style={lbl}>Aquisição<input type="date" style={inp} value={f.data_aquisicao} onChange={(e) => setF({ ...f, data_aquisicao: e.target.value })} /></label>
            <label style={lbl}>Valor (R$)<input style={inp} value={f.valor_aquisicao} onChange={(e) => setF({ ...f, valor_aquisicao: e.target.value })} placeholder="0,00" /></label>
            <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}><input type="checkbox" checked={f.deprecia} onChange={(e) => setF({ ...f, deprecia: e.target.checked })} /> Deprecia</label>
            {f.deprecia && <label style={lbl}>Vida útil (meses){!f.vida_util_meses && <span style={{ color: RED }}> *falta</span>}<input style={inp} value={f.vida_util_meses} onChange={(e) => setF({ ...f, vida_util_meses: e.target.value })} /></label>}
            {f.deprecia && <label style={lbl}>Valor residual<input style={inp} value={f.valor_residual} onChange={(e) => setF({ ...f, valor_residual: e.target.value })} placeholder="0,00" /></label>}
            <label style={lbl}>Linha de negócio<select style={inp} value={f.business_line_id} onChange={(e) => setF({ ...f, business_line_id: e.target.value })}><option value="">—</option>{bls.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label style={lbl}>Centro de custo<input style={inp} value={f.centro_custo} onChange={(e) => setF({ ...f, centro_custo: e.target.value })} placeholder="ex.: COMUM" /></label>
          </div>
          <div style={{ marginTop: 12 }}><button onClick={() => void salvar()} disabled={busy} style={btnPri}>{editId ? 'Salvar' : 'Adicionar bem'}</button></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: ESP60 }}>Natureza <select value={fNat} onChange={(e) => setFNat(e.target.value)} style={inp}><option value="">todas</option>{NATUREZAS.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label style={{ fontSize: 12, color: ESP60 }}>Status <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inp}><option value="">todos</option>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ color: ESP60, textAlign: 'left' }}>
            <th style={th}>Código</th><th style={th}>Descrição</th><th style={th}>Natureza</th><th style={th}>Aquisição</th>
            <th style={{ ...th, textAlign: 'right' }}>Valor</th><th style={{ ...th, textAlign: 'right' }}>Deprec. acum.</th><th style={{ ...th, textAlign: 'right' }}>Valor contábil</th>
            <th style={th}>Linha</th><th style={th}>Status</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {lista.map((b) => (
              <tr key={b.id} style={{ borderTop: `1px solid ${LINE}`, opacity: b.status === 'ativo' || b.status === 'em_construcao' ? 1 : 0.6 }}>
                <td style={td}>{b.codigo ?? '—'}</td>
                <td style={{ ...td, fontWeight: 600 }}>{b.descricao}{b.falta_parametro && <span style={{ color: RED }} title="sem vida útil"> ⚠️</span>}</td>
                <td style={td}>{b.natureza}</td>
                <td style={td}>{b.data_aquisicao}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(b.valor_aquisicao)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt(b.dep_acumulada)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt(b.valor_contabil)}</td>
                <td style={td}>{b.business_line_nome ?? '—'}</td>
                <td style={td}>{b.status}</td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => editar(b)} style={linkBtn}>editar</button>
                    {(b.status === 'ativo' || b.status === 'em_construcao') && <button onClick={() => void baixar(b)} style={linkBtn}>baixar</button>}
                    {(b.status === 'ativo' || b.status === 'em_construcao') && <button onClick={() => void excluir(b)} style={{ ...linkBtn, color: RED }}>excluir</button>}
                  </div>
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td style={td} colSpan={10}>Nenhum bem neste filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Tile({ titulo, valor, sub, destaque }: { titulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div style={{ background: destaque ? '#FBF3E0' : '#fff', border: `1px solid ${destaque ? GOLD : LINE}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: ESP60 }}>{titulo}</div>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2, color: ESP }}>{valor}</div>
      {sub && <div style={{ fontSize: 10.5, color: ESP60, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

const inp: React.CSSProperties = { display: 'inline-block', padding: '5px 7px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 12.5, marginTop: 3, background: '#fff', color: ESP }
const lbl: React.CSSProperties = { fontSize: 12, color: ESP60, display: 'block' }
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' }
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const btnPri: React.CSSProperties = { padding: '8px 14px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
const btnSec: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
