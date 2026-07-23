'use client'

// "Centros de Custo" (GE — conceito de Gestão Empresarial, compartilhado com o Agro).
// Fonte da verdade: cost_center_map (source_type='centro_custo'). Mapeia cada centro →
// tipo de apropriação + linha de negócio (+ lote quando direto). NÃO adivinha: não mapeado
// entra como extra+revisar no importador. Permite CADASTRO MANUAL PRÉVIO (antes de haver
// lançamento) — resolve o ovo-e-galinha.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#5C8D3F'; const RED = '#C44536'
const TIPOS = ['direto', 'comum', 'extra'] as const

type Row = { valor_origem: string; ocorrencias: number; mapeado: boolean; ativo: boolean; tipo_apropriacao: string | null; business_line_id: string | null; lote_id: string | null }
type BL = { id: string; name: string }
type Lote = { id: string; codigo: string; fase: string | null }
type Draft = { tipo: string; bl: string; lote: string }

export default function CentrosCustoPage() {
  const { companyId } = useEmpresaSelecionada()
  const empresaUnica = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [rows, setRows] = useState<Row[]>([])
  const [bls, setBls] = useState<BL[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  // cadastro manual prévio
  const [novo, setNovo] = useState<{ key: string; tipo: string; bl: string; lote: string }>({ key: '', tipo: 'comum', bl: '', lote: '' })

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    const [cc, bl, lo] = await Promise.all([
      supabase.rpc('fn_centro_custo_valores', { p_company: empresaUnica }),
      supabase.from('business_lines').select('id,name').eq('company_id', empresaUnica).order('ln_number'),
      supabase.from('erp_pec_lote').select('id,codigo,fase').eq('company_id', empresaUnica).eq('ativo', true).order('codigo'),
    ])
    const data = (cc.data ?? []) as Row[]
    setRows(data)
    setBls((bl.data ?? []) as BL[])
    setLotes((lo.data ?? []) as Lote[])
    const d: Record<string, Draft> = {}
    for (const r of data) d[r.valor_origem] = { tipo: r.tipo_apropriacao ?? 'comum', bl: r.business_line_id ?? '', lote: r.lote_id ?? '' }
    setDraft(d)
  }, [empresaUnica])

  useEffect(() => { void carregar() }, [carregar])

  // grava 1 mapeamento por centro em cost_center_map (delete+insert; RLS garante a empresa)
  async function gravar(sourceKey: string, d: Draft): Promise<string | null> {
    if (!empresaUnica) return 'sem empresa'
    await supabase.from('cost_center_map').delete()
      .eq('company_id', empresaUnica).eq('source_type', 'centro_custo').eq('source_key', sourceKey)
    const { error } = await supabase.from('cost_center_map').insert({
      company_id: empresaUnica, source_type: 'centro_custo', source_key: sourceKey,
      business_line_id: d.bl || null, tipo_apropriacao: d.tipo,
      lote_id: d.tipo === 'direto' ? (d.lote || null) : null,
      allocation_pct: 100, cost_scope: 'todos', priority: 0, ativo: true,
    })
    return error ? error.message : null
  }

  async function salvar(valor: string) {
    setMsg(null)
    const err = await gravar(valor, draft[valor] ?? { tipo: 'comum', bl: '', lote: '' })
    if (err) setMsg('Erro: ' + err)
    else { setMsg(`"${valor}" mapeado.`); await carregar() }
  }

  async function excluir(r: Row) {
    if (!empresaUnica) return
    const emUso = r.ocorrencias > 0
    const ok = window.confirm(emUso
      ? `"${r.valor_origem}" tem ${r.ocorrencias} lançamento(s) usando este centro. Para não quebrar o rateio já processado, ele NÃO será excluído — será INATIVADO (para de ser aplicado, mas fica no histórico). Continuar?`
      : `Excluir o mapeamento "${r.valor_origem}"? Lançamentos que usarem esse centro voltarão a ficar não mapeados.`)
    if (!ok) return
    setMsg(null)
    const { error } = emUso
      ? await supabase.from('cost_center_map').update({ ativo: false }).eq('company_id', empresaUnica).eq('source_type', 'centro_custo').eq('source_key', r.valor_origem)
      : await supabase.from('cost_center_map').delete().eq('company_id', empresaUnica).eq('source_type', 'centro_custo').eq('source_key', r.valor_origem)
    if (error) setMsg('Erro: ' + error.message)
    else { setMsg(emUso ? `"${r.valor_origem}" inativado (estava em uso).` : `"${r.valor_origem}" excluído.`); await carregar() }
  }

  async function reativar(r: Row) {
    if (!empresaUnica) return
    setMsg(null)
    const { error } = await supabase.from('cost_center_map').update({ ativo: true })
      .eq('company_id', empresaUnica).eq('source_type', 'centro_custo').eq('source_key', r.valor_origem)
    if (error) setMsg('Erro: ' + error.message)
    else { setMsg(`"${r.valor_origem}" reativado.`); await carregar() }
  }

  async function adicionarManual() {
    const key = novo.key.trim()
    if (!key) { setMsg('Digite o nome do centro de custo (ex.: DIR_GADO).'); return }
    setMsg(null)
    const err = await gravar(key, { tipo: novo.tipo, bl: novo.bl, lote: novo.lote })
    if (err) setMsg('Erro: ' + err)
    else { setMsg(`"${key}" cadastrado.`); setNovo({ key: '', tipo: 'comum', bl: '', lote: '' }); await carregar() }
  }

  const naoMapeados = rows.filter((r) => !r.mapeado).length

  if (!empresaUnica) return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica.</div>

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>🎯 Centros de Custo</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 16 }}>
        Mapeie cada centro de custo → tipo + linha. O importador NÃO adivinha: não mapeado entra como <b>extra + revisar</b>.
      </div>

      {/* cadastro manual prévio — resolve o ovo-e-galinha (criar antes de ter lançamento) */}
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Cadastrar centro de custo manualmente</div>
        <div style={{ fontSize: 12, color: ESP60, marginBottom: 8 }}>Crie o mapeamento antes de existir lançamento (ex.: DIR_GADO, DIR_SOJA, COMUM, EXTRA).</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={novo.key} onChange={(e) => setNovo({ ...novo, key: e.target.value })} placeholder="Nome do centro (ex.: DIR_GADO)" style={{ ...inp, minWidth: 200 }} />
          <select style={inp} value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}>{TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select style={inp} value={novo.bl} onChange={(e) => setNovo({ ...novo, bl: e.target.value })}><option value="">— linha —</option>{bls.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select style={inp} value={novo.lote} disabled={novo.tipo !== 'direto'} onChange={(e) => setNovo({ ...novo, lote: e.target.value })}><option value="">— lote (se direto) —</option>{lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo} ({l.fase})</option>)}</select>
          <button onClick={() => void adicionarManual()} style={btnPri}>+ Cadastrar</button>
        </div>
      </div>

      {naoMapeados > 0 && (
        <div style={{ marginBottom: 12, fontSize: 13, color: RED, background: '#FCE8E8', padding: 8, borderRadius: 6 }}>
          ⚠️ {naoMapeados} centro(s) de custo não mapeado(s) — configure antes de ratear.
        </div>
      )}
      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: msg.startsWith('Erro') ? RED : GREEN }}>{msg}</div>}

      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ color: ESP60, textAlign: 'left' }}>
            <th style={th}>Centro de custo</th><th style={{ ...th, textAlign: 'right' }}>Ocorr.</th><th style={th}>Status</th><th style={th}>Tipo</th><th style={th}>Linha</th><th style={th}>Lote (se direto)</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = draft[r.valor_origem] ?? { tipo: 'comum', bl: '', lote: '' }
              return (
                <tr key={r.valor_origem} style={{ borderTop: `1px solid ${LINE}`, background: !r.mapeado ? '#FCF2F2' : (!r.ativo ? '#F1EEE8' : 'transparent'), opacity: r.mapeado && !r.ativo ? 0.65 : 1 }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.valor_origem}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.ocorrencias}</td>
                  <td style={td}>
                    {!r.mapeado ? <span style={{ color: RED, fontWeight: 700 }}>não mapeado</span>
                      : r.ativo ? <span style={{ color: GREEN }}>✓ mapeado</span>
                      : <span style={{ color: ESP60, fontWeight: 700 }}>⏸ inativo</span>}
                  </td>
                  <td style={td}>
                    <select style={inp} value={d.tipo} onChange={(e) => setDraft({ ...draft, [r.valor_origem]: { ...d, tipo: e.target.value } })}>
                      {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <select style={inp} value={d.bl} onChange={(e) => setDraft({ ...draft, [r.valor_origem]: { ...d, bl: e.target.value } })}>
                      <option value="">—</option>{bls.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <select style={inp} value={d.lote} disabled={d.tipo !== 'direto'} onChange={(e) => setDraft({ ...draft, [r.valor_origem]: { ...d, lote: e.target.value } })}>
                      <option value="">—</option>{lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo} ({l.fase})</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => void salvar(r.valor_origem)} style={btnPri}>Salvar</button>
                      {r.mapeado && r.ativo && <button onClick={() => void excluir(r)} style={btnDel} title={r.ocorrencias > 0 ? 'Em uso — será inativado' : 'Excluir mapeamento'}>{r.ocorrencias > 0 ? 'Inativar' : 'Excluir'}</button>}
                      {r.mapeado && !r.ativo && <button onClick={() => void reativar(r)} style={btnSec}>Reativar</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td style={td} colSpan={7}>Nenhum centro de custo ainda. Use o cadastro manual acima (ex.: DIR_GADO).</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { padding: '5px 7px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 12, background: '#fff', color: ESP, minWidth: 120 }
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' }
const btnPri: React.CSSProperties = { padding: '6px 12px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12 }
const btnDel: React.CSSProperties = { padding: '6px 12px', background: 'transparent', color: RED, border: `1px solid ${RED}55`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12 }
const btnSec: React.CSSProperties = { padding: '6px 12px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12 }
