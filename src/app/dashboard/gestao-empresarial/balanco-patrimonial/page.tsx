'use client'

// "Balanço Patrimonial" (GE genérico). Linhas CALCULADAS (🔒 read-only, vêm da fonte) +
// linhas MANUAIS LIVRES por período: adicionar / editar (nome+valor) / excluir / ordenar.
// Ausente => valor null + motivo (RD-51). Diferença de fechamento destacada, nunca forçada.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#5C8D3F'; const RED = '#C44536'

const GRUPOS: { lado: string; grupo: string }[] = [
  { lado: 'ativo', grupo: 'ATIVO CIRCULANTE' },
  { lado: 'ativo', grupo: 'ATIVO NÃO CIRCULANTE' },
  { lado: 'passivo', grupo: 'PASSIVO CIRCULANTE' },
  { lado: 'passivo', grupo: 'PASSIVO NÃO CIRCULANTE' },
  { lado: 'pl', grupo: 'PATRIMÔNIO LÍQUIDO' },
]

type Linha = { id?: string; lado: string; grupo: string; nome: string; valor: number | null; ordem?: number; origem: string; editavel: boolean; fonte?: string | null; motivo?: string | null }
type Balanco = { ok: boolean; periodo: string; ativo_total: number; passivo_total: number; pl_total: number; passivo_mais_pl: number; diferenca: number; fecha: boolean; linhas: Linha[] }

function fmt(n: number | null | undefined): string { return n == null ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function hoje(): string { return new Date().toISOString().slice(0, 10) }
function periodoDe(dataRef: string): string { return dataRef.slice(0, 7) }
function periodoAnterior(dataRef: string): string { const [y, m] = dataRef.slice(0, 7).split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function iconeOrigem(o: string): string { return o === 'calculado' ? '🔒' : o === 'manual' ? '✍️' : '⚠️' }

export default function BalancoPage() {
  const { companyId } = useEmpresaSelecionada()
  const empresaUnica = companyId && !companyId.startsWith('group_') && companyId !== 'consolidado' ? companyId : null

  const [dataRef, setDataRef] = useState(hoje())
  const [bal, setBal] = useState<Balanco | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // edição local das linhas manuais (chave = id ou "novo:lado|grupo|nome")
  const [ed, setEd] = useState<Record<string, { nome: string; valor: string; ordem: string }>>({})

  const periodo = periodoDe(dataRef)

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_balanco_patrimonial', { p_company_id: empresaUnica, p_data_ref: dataRef })
    if (error) { setMsg('Erro: ' + error.message); setBal(null) }
    else {
      const b = data as Balanco
      setBal(b)
      const e: Record<string, { nome: string; valor: string; ordem: string }> = {}
      for (const l of b.linhas) if (l.editavel) {
        const k = l.id ?? `t:${l.lado}|${l.grupo}|${l.nome}`
        e[k] = { nome: l.nome, valor: l.valor != null ? String(l.valor) : '', ordem: String(l.ordem ?? 0) }
      }
      setEd(e)
    }
    setBusy(false)
  }, [empresaUnica, dataRef])

  useEffect(() => { void carregar() }, [carregar])

  function keyOf(l: Linha): string { return l.id ?? `t:${l.lado}|${l.grupo}|${l.nome}` }

  async function salvarLinha(l: Linha) {
    if (!empresaUnica) return
    const k = keyOf(l); const cur = ed[k] ?? { nome: l.nome, valor: '', ordem: '0' }
    if (!cur.nome.trim()) { setMsg('Informe o nome da linha.'); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('fn_balanco_linha_salvar', {
      p_company_id: empresaUnica, p_id: l.id ?? null, p_lado: l.lado, p_grupo: l.grupo,
      p_nome: cur.nome.trim(), p_valor: cur.valor === '' ? null : Number(String(cur.valor).replace(',', '.')),
      p_subgrupo: null, p_ordem: Number(cur.ordem) || 0, p_periodo: periodo,
    })
    if (error) setMsg('Erro: ' + error.message); else { setMsg('Linha salva.'); await carregar() }
    setBusy(false)
  }

  async function excluirLinha(l: Linha) {
    if (!empresaUnica || !l.id) return
    const aviso = (l.valor ?? 0) > 0 ? `\n\n⚠️ Esta linha tem valor R$ ${fmt(l.valor)} — o balanço vai mudar.` : ''
    if (!window.confirm(`Excluir a linha "${l.nome}"?${aviso}`)) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('fn_balanco_linha_excluir', { p_company_id: empresaUnica, p_id: l.id })
    if (error) setMsg('Erro: ' + error.message); else { setMsg('Linha excluída.'); await carregar() }
    setBusy(false)
  }

  async function adicionarLinha(lado: string, grupo: string) {
    if (!empresaUnica) return
    const nome = window.prompt(`Nome da nova linha em ${grupo}:`, '')
    if (!nome || !nome.trim()) return
    const valorStr = window.prompt('Valor (R$):', '0') ?? '0'
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('fn_balanco_linha_salvar', {
      p_company_id: empresaUnica, p_id: null, p_lado: lado, p_grupo: grupo, p_nome: nome.trim(),
      p_valor: valorStr === '' ? null : Number(String(valorStr).replace(',', '.')), p_subgrupo: null, p_ordem: 99, p_periodo: periodo,
    })
    if (error) setMsg('Erro: ' + error.message); else { setMsg('Linha adicionada.'); await carregar() }
    setBusy(false)
  }

  async function copiarPeriodoAnterior() {
    if (!empresaUnica) return
    const de = periodoAnterior(dataRef)
    if (!window.confirm(`Copiar as linhas manuais de ${de} para ${periodo}? (não duplica as que já existem)`)) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_balanco_copiar_periodo', { p_company_id: empresaUnica, p_de: de, p_para: periodo })
    if (error) setMsg('Erro: ' + error.message)
    else { const r = data as { copiadas?: number }; setMsg(`${r?.copiadas ?? 0} linha(s) copiada(s) de ${de}.`); await carregar() }
    setBusy(false)
  }

  const porGrupo = useCallback((lado: string, grupo: string) => (bal?.linhas ?? []).filter((l) => l.lado === lado && l.grupo === grupo), [bal])

  function renderLinha(l: Linha) {
    const k = keyOf(l)
    if (!l.editavel) {
      // CALCULADA — read-only, com cadeado + tooltip da fonte
      return (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13 }}>
          <span title={`Calculado de: ${l.fonte ?? '—'}`} style={{ width: 18, cursor: 'help' }}>🔒</span>
          <span style={{ flex: 1, color: l.origem === 'ausente' ? '#9A6A00' : ESP }} title={l.fonte ?? undefined}>
            {l.nome}{l.origem === 'ausente' && l.motivo && <span style={{ fontSize: 10.5, color: ESP60 }}> · {l.motivo}</span>}
          </span>
          <span style={{ width: 120, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(l.valor)}</span>
        </div>
      )
    }
    // MANUAL / AUSENTE — editável
    const cur = ed[k] ?? { nome: l.nome, valor: '', ordem: '0' }
    return (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 13 }}>
        <span title="manual" style={{ width: 18 }}>{iconeOrigem(l.origem)}</span>
        <input value={cur.ordem} onChange={(e) => setEd({ ...ed, [k]: { ...cur, ordem: e.target.value } })} title="ordem" style={{ ...ip, width: 34, textAlign: 'center' }} />
        <input value={cur.nome} onChange={(e) => setEd({ ...ed, [k]: { ...cur, nome: e.target.value } })} placeholder={l.origem === 'ausente' ? `${l.nome} (sugestão)` : 'nome'} style={{ ...ip, flex: 1 }} />
        <input value={cur.valor} onChange={(e) => setEd({ ...ed, [k]: { ...cur, valor: e.target.value } })} placeholder="0,00" style={{ ...ip, width: 100, textAlign: 'right' }} />
        <button onClick={() => void salvarLinha(l)} disabled={busy} style={miniPri} title="Salvar">✓</button>
        {l.id && <button onClick={() => void excluirLinha(l)} disabled={busy} style={miniDel} title="Excluir">✕</button>}
      </div>
    )
  }

  function renderGrupo(g: { lado: string; grupo: string }) {
    const linhas = porGrupo(g.lado, g.grupo)
    return (
      <div key={g.grupo} style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: ESP, borderBottom: `1px solid ${LINE}`, paddingBottom: 4, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
          <span>{g.grupo}</span>
          <button onClick={() => void adicionarLinha(g.lado, g.grupo)} style={miniAdd} title="Adicionar linha manual">+ linha</button>
        </div>
        {linhas.map(renderLinha)}
      </div>
    )
  }

  if (!empresaUnica) return <div style={{ padding: 24, color: ESP60 }}>Selecione UMA empresa específica.</div>

  return (
    <div style={{ padding: 24, background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>📊 Balanço Patrimonial</div>
      <div style={{ fontSize: 13, color: ESP60, marginBottom: 12 }}>🔒 calculado (da fonte, read-only) · ✍️ manual (editável) · ⚠️ ausente. Linhas manuais são por período. A diferença é mostrada, nunca forçada.</div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: ESP60 }}>Data-base <input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} style={{ padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6 }} /></label>
        <span style={{ fontSize: 12, color: ESP60 }}>competência {periodo}</span>
        <button onClick={() => void copiarPeriodoAnterior()} disabled={busy} style={btnSec}>⧉ Copiar linhas de {periodoAnterior(dataRef)}</button>
        {msg && <span style={{ fontSize: 13, color: msg.startsWith('Erro') ? RED : GREEN }}>{msg}</span>}
      </div>

      {bal && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <div style={card}><div style={{ fontWeight: 800, marginBottom: 10 }}>ATIVO</div>
              {GRUPOS.filter((g) => g.lado === 'ativo').map(renderGrupo)}
              <div style={{ borderTop: `2px solid ${LINE}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span>Total do Ativo</span><span>{fmt(bal.ativo_total)}</span></div>
            </div>
            <div style={card}><div style={{ fontWeight: 800, marginBottom: 10 }}>PASSIVO + PATRIMÔNIO LÍQUIDO</div>
              {GRUPOS.filter((g) => g.lado !== 'ativo').map(renderGrupo)}
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
const ip: React.CSSProperties = { padding: '3px 6px', border: `1px solid ${LINE}`, borderRadius: 5, fontSize: 12.5, background: '#fff', color: ESP }
const btnSec: React.CSSProperties = { padding: '6px 12px', background: 'transparent', color: ESP, border: `1px solid ${LINE}`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12.5 }
const miniPri: React.CSSProperties = { padding: '3px 8px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 5, fontWeight: 700, cursor: 'pointer', fontSize: 12 }
const miniDel: React.CSSProperties = { padding: '3px 8px', background: 'transparent', color: RED, border: `1px solid ${RED}55`, borderRadius: 5, fontWeight: 700, cursor: 'pointer', fontSize: 12 }
const miniAdd: React.CSSProperties = { padding: '2px 8px', background: 'transparent', color: GOLD, border: `1px solid ${GOLD}55`, borderRadius: 5, fontWeight: 600, cursor: 'pointer', fontSize: 11 }
