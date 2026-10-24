'use client'

// HB2 · Medição ao cliente (tela 273): quantidade medida × serviço × regime → faixa, adicional, preço, código do cliente
// e total. Cada linha sai por fn_tabela_preco_medir, a MESMA regra do contrato (o número bate com a tabela).
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Linha = { servico_ref: string; quantidade: string; condicao: string }
type Res = { ok: boolean; erro?: string; servico_ref?: string; quantidade: number; faixa_de?: number; faixa_ate?: number | null; condicao?: string; preco_unitario?: number; total?: number; codigo_externo?: string | null; unidade?: string }

export function MedicaoContrato({ tabelaId, servicos, regimes }: { tabelaId: string; servicos: { ref: string; nome: string; unidade: string }[]; regimes: string[] }) {
  const [linhas, setLinhas] = useState<Linha[]>([{ servico_ref: servicos[0]?.ref ?? '', quantidade: '', condicao: 'normal' }])
  const [res, setRes] = useState<{ linhas: Res[]; total: number } | null>(null)
  const [erro, setErro] = useState('')
  const campo: React.CSSProperties = { padding: 8, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 15, background: '#fff', color: ESP, width: '100%', minWidth: 0 }
  const nome = (r?: string) => servicos.find(s => s.ref === r)?.nome ?? r ?? ''
  const setL = (i: number, p: Partial<Linha>) => setLinhas(ls => ls.map((l, k) => (k === i ? { ...l, ...p } : l)))

  const medir = async () => {
    setErro('')
    const validas = linhas.filter(l => l.servico_ref && Number(l.quantidade.replace(',', '.')) > 0)
    if (!validas.length) { setErro('Informe a quantidade medida de pelo menos um serviço.'); return }
    const { data, error } = await supabase.rpc('fn_tabela_preco_medir', { p_tabela: tabelaId, p_linhas: validas.map(l => ({ servico_ref: l.servico_ref, quantidade: Number(l.quantidade.replace(',', '.')), condicao: l.condicao })) })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível calcular a medição.')); return }
    setRes(data as { linhas: Res[]; total: number })
  }

  return (
    <section data-testid="tp-medicao" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginTop: 16, display: 'grid', gap: 12 }}>
      <h2 style={{ fontSize: 17, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>Medição ao cliente <AjudaCampo chave="hub.tabela_preco.medicao" /></h2>
      <p style={{ fontSize: 13, color: MUT, margin: 0 }}>Informe o que foi medido no período: o preço sai pela faixa e pelo regime do contrato, com o código do cliente.</p>
      {linhas.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
          <label style={{ fontSize: 12, color: MUT }}>Serviço <AjudaCampo chave="hub.tabela_preco.servico" />
            <select aria-label="Serviço medido" style={campo} value={l.servico_ref} onChange={e => setL(i, { servico_ref: e.target.value })}>
              {servicos.map(s => <option key={s.ref} value={s.ref}>{s.nome} ({s.unidade})</option>)}
            </select></label>
          <label style={{ fontSize: 12, color: MUT }}>Quantidade <AjudaCampo chave="hub.tabela_preco.medicao_qtd" />
            <input aria-label="Quantidade medida" data-testid="med-qtd" inputMode="decimal" placeholder="quantidade" style={campo} value={l.quantidade} onChange={e => setL(i, { quantidade: e.target.value })} /></label>
          <label style={{ fontSize: 12, color: MUT }}>Regime <AjudaCampo chave="hub.tabela_preco.condicao" />
            <select aria-label="Regime" style={campo} value={l.condicao} onChange={e => setL(i, { condicao: e.target.value })}>
              <option value="normal">Normal</option>{regimes.map(r => <option key={r} value={r}>{r}</option>)}
            </select></label>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={{ minHeight: 44 }} onClick={() => setLinhas(ls => [...ls, { servico_ref: servicos[0]?.ref ?? '', quantidade: '', condicao: 'normal' }])}>+ Linha</button>
        <button type="button" data-testid="med-calcular" onClick={medir} style={{ background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '12px 20px', fontWeight: 700, minHeight: 44 }}>Calcular medição</button>
      </div>
      {erro && <p role="alert" style={{ color: '#B91C1C', margin: 0 }}>{erro}</p>}
      {res && (
        <div data-testid="med-extrato" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, minWidth: 520 }}>
            <thead><tr style={{ color: MUT, textAlign: 'left' }}><th>Serviço</th><th>Qtd</th><th>Regime</th><th>Código</th><th style={{ textAlign: 'right' }}>Unitário</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>{res.linhas.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                <td>{nome(r.servico_ref)}</td><td>{r.quantidade}</td><td>{r.condicao ?? ''}</td>
                <td>{r.ok ? (r.codigo_externo ?? 'sem código') : ''}</td>
                <td style={{ textAlign: 'right' }}>{r.ok ? fmtR(r.preco_unitario!) : r.erro}</td>
                <td style={{ textAlign: 'right' }}>{r.ok ? fmtR(r.total!) : '—'}</td>
              </tr>))}</tbody>
          </table>
          <div style={{ textAlign: 'right', fontSize: 18, marginTop: 8 }} data-testid="med-total">Total da medição: <b>{fmtR(res.total)}</b></div>
        </div>
      )}
    </section>
  )
}
