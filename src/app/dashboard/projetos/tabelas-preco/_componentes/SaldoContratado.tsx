'use client'

// HB2 · Saldo contratado do contrato de preços: contratado × medido (medições salvas) = saldo, por serviço.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const fmtN = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
type L = { servico_ref: string; contratado: number; medido: number; saldo: number }

export function SaldoContratado({ tabelaId, servicos, podeGravar, versao }: { tabelaId: string; podeGravar: boolean; versao: number; servicos: { ref: string; nome: string; unidade: string }[] }) {
  const [linhas, setLinhas] = useState<L[]>([])
  const [ref, setRef] = useState(servicos[0]?.ref ?? '')
  const [qtd, setQtd] = useState('')
  const [erro, setErro] = useState('')
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_tabela_preco_saldo', { p_tabela: tabelaId })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar o saldo contratado.')); return }
    setLinhas(((data as { linhas: L[] }).linhas ?? []).map(x => ({ ...x, contratado: Number(x.contratado), medido: Number(x.medido), saldo: Number(x.saldo) })))
  }, [tabelaId])
  useEffect(() => { carregar() }, [carregar, versao])
  const def = servicos.find(s => s.ref === ref)
  const nome = (r: string) => servicos.find(s => s.ref === r)?.nome ?? r
  const salvar = async () => {
    setErro('')
    const n = Number(qtd.replace(/\./g, '').replace(',', '.'))
    if (!ref || !qtd.trim() || !(n >= 0)) { setErro('Informe a quantidade contratada (número maior ou igual a zero).'); return }
    const { error } = await supabase.rpc('fn_tabela_preco_saldo_definir', { p_tabela: tabelaId, p_servico_ref: ref, p_quantidade: n })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível salvar o saldo contratado.')); return }
    setQtd(''); carregar()
  }
  const campo: React.CSSProperties = { padding: 8, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 15, background: '#fff', color: ESP, width: '100%', minWidth: 0 }
  return (
    <div data-testid="tp-saldo" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10, display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>Saldo contratado <AjudaCampo chave="hub.tabela_preco.saldo" /></div>
      {linhas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, minWidth: 380 }}>
            <thead><tr style={{ color: MUT, textAlign: 'left' }}><th>Serviço</th><th style={{ textAlign: 'right' }}>Contratado</th><th style={{ textAlign: 'right' }}>Medido</th><th style={{ textAlign: 'right' }}>Saldo</th></tr></thead>
            <tbody>{linhas.map(l => (
              <tr key={l.servico_ref} style={{ borderTop: `1px solid ${LINE}` }}>
                <td>{nome(l.servico_ref)}</td><td style={{ textAlign: 'right' }}>{fmtN(l.contratado)}</td><td style={{ textAlign: 'right' }}>{fmtN(l.medido)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: l.saldo < 0 ? '#B91C1C' : ESP }}>{fmtN(l.saldo)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {podeGravar && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, alignItems: 'end' }}>
          <label style={{ fontSize: 12, color: MUT }}>Serviço
            <select aria-label="Serviço do saldo" style={campo} value={ref} onChange={e => setRef(e.target.value)}>{servicos.map(s => <option key={s.ref} value={s.ref}>{s.nome} ({s.unidade})</option>)}</select></label>
          <label style={{ fontSize: 12, color: MUT }}>Quantidade contratada{def ? ` (${def.unidade})` : ''} <AjudaCampo chave="hub.tabela_preco.saldo_contratado" />
            <input aria-label="Quantidade contratada" data-testid="saldo-qtd" inputMode="decimal" style={campo} value={qtd} onChange={e => setQtd(e.target.value)} placeholder="1000" /></label>
          <button type="button" data-testid="saldo-salvar" onClick={salvar} style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: `1px solid ${GOLD}`, background: '#fff', color: ESP, fontWeight: 700 }}>Definir saldo</button>
        </div>
      )}
      {erro && <p role="alert" style={{ color: '#B91C1C', margin: 0 }}>{erro}</p>}
    </div>
  )
}
