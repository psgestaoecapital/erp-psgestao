'use client'

// Regras de rateio por CONTA e por TEXTO (CEO 06/11/2026). Gravam em cost_center_map (source_type 'conta' | 'texto') e são
// lidas pela fn_ge_resultado_por_negocio (tela Resultado por negócio). Não mexem em nenhum lançamento.
// Ordem de força: linha de negócio escrita na receita > centro de custo do lançamento > texto > conta (a mais específica).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314'; const GOLD = '#C8941A'; const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'; const GREEN = '#5C8D3F'; const RED = '#C44536'
const ROTA = '/dashboard/gestao-empresarial/centros-custo'
const COMUM = '__comum__'

type Regra = { id: string; source_type: string; source_key: string; business_line_id: string | null; allocation_pct: number; tipo_apropriacao: string | null }
type BL = { id: string; name: string }
type Conta = { codigo: string; descricao: string }

export default function RegrasRateio({ companyId, bls }: { companyId: string; bls: BL[] }) {
  const [regras, setRegras] = useState<Regra[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [novo, setNovo] = useState({ tipo: 'conta', chave: '', bl: '', pct: '100' })

  const carregar = useCallback(async () => {
    const [r, c] = await Promise.all([
      supabase.from('cost_center_map').select('id,source_type,source_key,business_line_id,allocation_pct,tipo_apropriacao')
        .eq('company_id', companyId).in('source_type', ['conta', 'texto']).eq('ativo', true).order('source_type').order('source_key'),
      supabase.from('erp_plano_contas').select('codigo,descricao').eq('company_id', companyId).order('codigo'),
    ])
    setRegras((r.data ?? []) as Regra[])
    setContas((c.data ?? []) as Conta[])
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const nomeConta = useMemo(() => new Map(contas.map((c) => [c.codigo, c.descricao])), [contas])
  const nomeBl = useMemo(() => new Map(bls.map((b) => [b.id, b.name])), [bls])

  // soma do % já cadastrado por chave (para não passar de 100)
  const soma = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of regras) { const k = `${r.source_type}|${r.source_key.trim().toLowerCase()}`; m.set(k, (m.get(k) ?? 0) + Number(r.allocation_pct)) }
    return m
  }, [regras])

  async function adicionar() {
    setMsg(null)
    const chave = novo.chave.trim()
    const pct = Number(novo.pct.replace(',', '.'))
    if (!chave) { setMsg('Erro: digite a conta (ex.: 4.02) ou a palavra (ex.: IPTU).'); return }
    if (!novo.bl) { setMsg('Erro: escolha o negócio (ou Comum).'); return }
    if (!(pct > 0 && pct <= 100)) { setMsg('Erro: o % vai de 1 a 100.'); return }
    if (novo.tipo === 'texto' && chave.length < 3) { setMsg('Erro: use uma palavra com 3 letras ou mais.'); return }
    if (novo.tipo === 'conta' && !nomeConta.has(chave)) { setMsg(`Erro: a conta ${chave} não existe no plano de contas.`); return }
    const ja = soma.get(`${novo.tipo}|${chave.toLowerCase()}`) ?? 0
    if (ja + pct > 100.0001) { setMsg(`Erro: "${chave}" já tem ${ja}% — com mais ${pct}% passa de 100%.`); return }
    const comum = novo.bl === COMUM
    const { error } = await supabase.from('cost_center_map').insert({
      company_id: companyId, source_type: novo.tipo, source_key: chave,
      business_line_id: comum ? null : novo.bl, tipo_apropriacao: comum ? 'comum' : 'direto',
      allocation_pct: pct, cost_scope: 'todos', priority: 0, ativo: true,
    })
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg(`Regra gravada: ${novo.tipo} "${chave}" → ${comum ? 'Comum (rateio)' : nomeBl.get(novo.bl)} ${pct}%.`)
    setNovo({ ...novo, chave: '', pct: ja + pct < 100 ? String(100 - ja - pct) : '100' })
    await carregar()
  }

  async function remover(r: Regra) {
    if (!window.confirm(`Tirar a regra ${r.source_type} "${r.source_key}" → ${r.business_line_id ? nomeBl.get(r.business_line_id) : 'Comum'} ${r.allocation_pct}%?`)) return
    setMsg(null)
    // regra de conta/texto não está gravada em nenhum lançamento: tirar não quebra histórico (o cálculo é sempre na hora)
    const { error } = await supabase.from('cost_center_map').delete().eq('id', r.id).eq('company_id', companyId)
    if (error) setMsg('Erro: ' + error.message)
    else { setMsg('Regra retirada.'); await carregar() }
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 16, color: ESP }}>
      <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
        Regras de rateio por conta e por texto <AjudaCampo chave="cc.regras" rota={ROTA} />
      </div>
      <div style={{ fontSize: 12, color: ESP60, margin: '4px 0 12px' }}>
        Dizem para qual negócio vai cada despesa ou receita no <a href="/dashboard/gestao-empresarial/resultado-por-negocio" style={{ color: GOLD, fontWeight: 600 }}>Resultado por negócio</a>, sem mexer nos lançamentos.
        A conta mais específica ganha (4.02.04 vence 4.02, que vence 4). Texto vence conta. Para dividir, cadastre a mesma chave uma vez por negócio.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={lbl}>
          <span style={lblTxt}>Tipo <AjudaCampo chave="cc.regra_tipo" rota={ROTA} /></span>
          <select style={inp} value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}>
            <option value="conta">Conta do plano</option>
            <option value="texto">Texto na descrição / fornecedor</option>
          </select>
        </label>
        <label style={lbl}>
          <span style={lblTxt}>{novo.tipo === 'conta' ? 'Conta' : 'Palavra'} <AjudaCampo chave="cc.regra_chave" rota={ROTA} /></span>
          <input style={{ ...inp, minWidth: 160 }} value={novo.chave} list={novo.tipo === 'conta' ? 'cc-contas' : undefined}
            placeholder={novo.tipo === 'conta' ? 'ex.: 4.02' : 'ex.: IPTU'} onChange={(e) => setNovo({ ...novo, chave: e.target.value })} />
          <datalist id="cc-contas">{contas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} {c.descricao}</option>)}</datalist>
        </label>
        <label style={lbl}>
          <span style={lblTxt}>Negócio <AjudaCampo chave="cc.regra_negocio" rota={ROTA} /></span>
          <select style={inp} value={novo.bl} onChange={(e) => setNovo({ ...novo, bl: e.target.value })}>
            <option value="">— escolha —</option>
            {bls.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value={COMUM}>Comum (rateio pela receita)</option>
          </select>
        </label>
        <label style={lbl}>
          <span style={lblTxt}>% <AjudaCampo chave="cc.regra_pct" rota={ROTA} /></span>
          <input style={{ ...inp, minWidth: 70, width: 80 }} inputMode="decimal" value={novo.pct} onChange={(e) => setNovo({ ...novo, pct: e.target.value })} />
        </label>
        <button onClick={() => void adicionar()} style={btnPri}>+ Gravar regra</button>
      </div>
      {novo.tipo === 'conta' && novo.chave.trim() && nomeConta.has(novo.chave.trim()) && (
        <div style={{ fontSize: 12, color: ESP60, marginTop: -6, marginBottom: 10 }}>{novo.chave.trim()} — {nomeConta.get(novo.chave.trim())}</div>
      )}
      {msg && <div style={{ marginBottom: 10, fontSize: 13, color: msg.startsWith('Erro') ? RED : GREEN }}>{msg}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ color: ESP60, textAlign: 'left' }}>
            <th style={th}>Tipo</th><th style={th}>Chave</th><th style={th}>Negócio</th><th style={{ ...th, textAlign: 'right' }}>%</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {regras.map((r) => {
              const total = soma.get(`${r.source_type}|${r.source_key.trim().toLowerCase()}`) ?? 0
              return (
                <tr key={r.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={td}>{r.source_type === 'conta' ? 'Conta' : 'Texto'}</td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {r.source_type === 'conta' ? `${r.source_key} ${nomeConta.get(r.source_key) ?? ''}` : `"${r.source_key}"`}
                    {total < 99.99 && <span style={{ color: RED, fontWeight: 400, fontSize: 11 }}> · soma {total}% (o resto vai para o rateio)</span>}
                  </td>
                  <td style={td}>{r.business_line_id ? nomeBl.get(r.business_line_id) ?? '—' : 'Comum (rateio)'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{Number(r.allocation_pct)}%</td>
                  <td style={td}><button onClick={() => void remover(r)} style={btnDel}>Tirar</button></td>
                </tr>
              )
            })}
            {regras.length === 0 && <tr><td style={{ ...td, color: ESP60 }} colSpan={5}>Nenhuma regra ainda. Sem regra, toda despesa sem centro de custo vai para o rateio pela receita.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = { padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 13, background: '#fff', color: ESP, minWidth: 140 }
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const lblTxt: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: ESP60, display: 'flex', alignItems: 'center', gap: 4 }
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' }
const btnPri: React.CSSProperties = { padding: '8px 14px', background: GOLD, color: '#3D2314', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }
const btnDel: React.CSSProperties = { padding: '5px 10px', background: 'transparent', color: RED, border: `1px solid ${RED}55`, borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 12 }
