'use client'

// "Balanço Patrimonial" (GE genérico). Cada linha declara a origem (🔢 calculado /
// ✍️ manual / ⚠️ ausente). Manuais editáveis inline. Diferença de fechamento destacada
// quando ≠ 0 (nunca força o balanço — RD-51).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#5C8D3F'; const RED = '#C44536'

type Linha = { lado: string; grupo: string; nome: string; valor: number | null; origem: string; fonte: string | null; motivo: string | null }
type Balanco = { ok: boolean; periodo: string; ativo_total: number; passivo_total: number; pl_total: number; passivo_mais_pl: number; diferenca: number; fecha: boolean; linhas: Linha[] }

function fmt(n: number | null | undefined): string { return n == null ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function hoje(): string { return new Date().toISOString().slice(0, 10) }
function keyOf(l: { lado: string; grupo: string; nome: string }): string { return `${l.lado}|${l.grupo}|${l.nome}` }
function iconeOrigem(o: string): string { return o === 'calculado' ? '🔢' : o === 'manual' ? '✍️' : '⚠️' }

export default function BalancoPage() {
  const { companyId } = useEmpresaSelecionada()
  const empresaUnica = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [dataRef, setDataRef] = useState(hoje())
  const [bal, setBal] = useState<Balanco | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState<Record<string, string>>({})   // key -> valor digitado

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_balanco_patrimonial', { p_company_id: empresaUnica, p_data_ref: dataRef })
    if (error) { setMsg('Erro: ' + error.message); setBal(null) }
    else {
      const b = data as Balanco
      setBal(b)
      const m: Record<string, string> = {}
      for (const l of b.linhas) if (l.origem === 'manual' || l.origem === 'ausente') m[keyOf(l)] = l.valor != null ? String(l.valor) : ''
      setManual(m)
    }
    setBusy(false)
  }, [empresaUnica, dataRef])

  useEffect(() => { void carregar() }, [carregar])

  async function salvarManuais() {
    if (!empresaUnica || !bal) return
    setBusy(true); setMsg(null)
    const linhas = bal.linhas
      .filter((l) => l.origem === 'manual' || l.origem === 'ausente')
      .map((l) => {
        const v = manual[keyOf(l)]
        return { lado: l.lado, grupo: l.grupo, nome: l.nome, valor: v === '' || v == null ? null : Number(String(v).replace(',', '.')) }
      })
      .filter((l) => l.valor != null)
    const { error } = await supabase.rpc('fn_balanco_salvar_manual', { p_company_id: empresaUnica, p_periodo: bal.periodo, p_linhas: linhas })
    if (error) setMsg('Erro: ' + error.message)
    else { setMsg('Linhas manuais salvas.'); await carregar() }
    setBusy(false)
  }

  const ativo = useMemo(() => (bal?.linhas ?? []).filter((l) => l.lado === 'ativo'), [bal])
  const passivoPl = useMemo(() => (bal?.linhas ?? []).filter((l) => l.lado !== 'ativo'), [bal])

  function renderColuna(linhas: Linha[]) {
    const grupos = Array.from(new Set(linhas.map((l) => l.grupo)))
    return grupos.map((g) => (
      <div key={g} style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: ESP, borderBottom: `1px solid ${LINE}`, paddingBottom: 4, marginBottom: 4 }}>{g}</div>
        {linhas.filter((l) => l.grupo === g).map((l) => {
          const editavel = l.origem === 'manual' || l.origem === 'ausente'
          return (
            <div key={keyOf(l)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13 }}>
              <span title={l.origem} style={{ width: 18 }}>{iconeOrigem(l.origem)}</span>
              <span style={{ flex: 1, color: l.origem === 'ausente' ? '#9A6A00' : ESP }}>{l.nome}{l.origem === 'ausente' && l.motivo && <span style={{ fontSize: 10.5, color: ESP60 }}> · {l.motivo}</span>}</span>
              {editavel ? (
                <input value={manual[keyOf(l)] ?? ''} onChange={(e) => setManual({ ...manual, [keyOf(l)]: e.target.value })}
                  placeholder="0,00" style={{ width: 110, textAlign: 'right', padding: '3px 6px', border: `1px solid ${LINE}`, borderRadius: 5, fontSize: 12.5 }} />
              ) : (
                <span style={{ width: 110, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(l.valor)}</span>
              )}
            </div>
          )
        })}
      </div>
    ))
  }

  if (!empresaUnica) return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica.</div>

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>📊 Balanço Patrimonial</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 12 }}>🔢 calculado · ✍️ manual (editável) · ⚠️ ausente (não cadastrado — nunca zero). A diferença de fechamento é mostrada, não forçada.</div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: ESP60 }}>Data-base <input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} style={{ padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6 }} /></label>
        <button onClick={() => void salvarManuais()} disabled={busy} style={btnPri}>Salvar linhas manuais</button>
        {msg && <span style={{ fontSize: 13, color: msg.startsWith('Erro') ? RED : GREEN }}>{msg}</span>}
      </div>

      {bal && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <div style={card}><div style={{ fontWeight: 800, marginBottom: 10 }}>ATIVO</div>{renderColuna(ativo)}
              <div style={{ borderTop: `2px solid ${LINE}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span>Total do Ativo</span><span>{fmt(bal.ativo_total)}</span></div>
            </div>
            <div style={card}><div style={{ fontWeight: 800, marginBottom: 10 }}>PASSIVO + PATRIMÔNIO LÍQUIDO</div>{renderColuna(passivoPl)}
              <div style={{ borderTop: `2px solid ${LINE}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span>Passivo + PL</span><span>{fmt(bal.passivo_mais_pl)}</span></div>
            </div>
          </div>
          <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: bal.fecha ? '#E8F4DC' : '#FCE8E8', border: `1px solid ${bal.fecha ? GREEN : RED}55`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, color: bal.fecha ? GREEN : RED }}>{bal.fecha ? '✓ Balanço fecha' : '⚠️ Balanço NÃO fecha'}</span>
            <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: bal.fecha ? GREEN : RED }}>Diferença: R$ {fmt(bal.diferenca)}</span>
          </div>
        </>
      )}
    </div>
  )
}

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }
const btnPri: React.CSSProperties = { padding: '8px 14px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 13 }
