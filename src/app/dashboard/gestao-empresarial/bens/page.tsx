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

function fmt(n: number | null | undefined): string { return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function mesAtual(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

export default function BensPage() {
  const { companyId } = useEmpresaSelecionada()
  const empresaUnica = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [bens, setBens] = useState<Bem[]>([])
  const [bls, setBls] = useState<BL[]>([])
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
    const [bn, bl, np] = await Promise.all([
      supabase.rpc('fn_bem_listar', { p_company_id: empresaUnica }),
      supabase.from('business_lines').select('id,name').eq('company_id', empresaUnica).order('ln_number'),
      supabase.from('erp_bem_natureza_padrao').select('natureza,vida_util_meses,deprecia').is('company_id', null),
    ])
    setBens((bn.data ?? []) as Bem[])
    setBls((bl.data ?? []) as BL[])
    const p: Record<string, NatPadrao> = {}
    for (const r of (np.data ?? []) as NatPadrao[]) p[r.natureza] = r
    setPadroes(p)
  }, [empresaUnica])

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

const inp: React.CSSProperties = { display: 'inline-block', padding: '5px 7px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 12.5, marginTop: 3, background: '#fff', color: ESP }
const lbl: React.CSSProperties = { fontSize: 12, color: ESP60, display: 'block' }
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' }
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: GOLD, cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const btnPri: React.CSSProperties = { padding: '8px 14px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
const btnSec: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
