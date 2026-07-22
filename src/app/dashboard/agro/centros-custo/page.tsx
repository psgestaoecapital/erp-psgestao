'use client'

// "Centros de Custo" — lista os valores distintos de centro_custo em erp_pagar/erp_receber
// e permite mapear cada um → tipo + linha de negócio (+ lote quando direto).
// Não mapeados destacados em vermelho: o importador NÃO adivinha (entram como extra+revisar).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#5C8D3F'; const RED = '#C44536'
const TIPOS = ['direto', 'comum', 'extra'] as const

type Row = { valor_origem: string; ocorrencias: number; mapeado: boolean; tipo_apropriacao: string | null; business_line_id: string | null; lote_id: string | null }
type BL = { id: string; name: string }
type Lote = { id: string; codigo: string; fase: string | null }

export default function CentrosCustoPage() {
  const { companyId } = useEmpresaSelecionada()
  const empresaUnica = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [rows, setRows] = useState<Row[]>([])
  const [bls, setBls] = useState<BL[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  // edição inline por valor_origem
  const [draft, setDraft] = useState<Record<string, { tipo: string; bl: string; lote: string }>>({})

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
    const d: Record<string, { tipo: string; bl: string; lote: string }> = {}
    for (const r of data) d[r.valor_origem] = { tipo: r.tipo_apropriacao ?? 'comum', bl: r.business_line_id ?? '', lote: r.lote_id ?? '' }
    setDraft(d)
  }, [empresaUnica])

  useEffect(() => { void carregar() }, [carregar])

  async function salvar(valor: string) {
    if (!empresaUnica) return
    const d = draft[valor]
    setMsg(null)
    const { error } = await supabase.from('erp_centro_custo_mapa').upsert({
      company_id: empresaUnica, valor_origem: valor,
      tipo_apropriacao: d.tipo, business_line_id: d.bl || null,
      lote_id: d.tipo === 'direto' ? (d.lote || null) : null, ativo: true,
    }, { onConflict: 'company_id,valor_origem' })
    if (error) setMsg('Erro: ' + error.message)
    else { setMsg(`"${valor}" mapeado.`); await carregar() }
  }

  const naoMapeados = rows.filter((r) => !r.mapeado).length

  if (!empresaUnica) return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica.</div>

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>🎯 Centros de Custo</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 16 }}>
        Mapeie cada centro de custo → tipo + linha. O importador NÃO adivinha: não mapeado entra como <b>extra + revisar</b>.
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
                <tr key={r.valor_origem} style={{ borderTop: `1px solid ${LINE}`, background: r.mapeado ? 'transparent' : '#FCF2F2' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.valor_origem}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.ocorrencias}</td>
                  <td style={td}>{r.mapeado ? <span style={{ color: GREEN }}>✓ mapeado</span> : <span style={{ color: RED, fontWeight: 700 }}>não mapeado</span>}</td>
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
                  <td style={td}><button onClick={() => void salvar(r.valor_origem)} style={btnPri}>Salvar</button></td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td style={td} colSpan={7}>Nenhum centro de custo encontrado em Contas a Pagar/Receber.</td></tr>}
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
