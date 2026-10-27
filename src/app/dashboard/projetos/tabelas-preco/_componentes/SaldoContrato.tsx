'use client'

// HB2 · Saldo contratado: quantidade contratada por serviço × o que já foi medido nas medições salvas.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const fmtN = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

type Linha = { servico_ref: string; contratada: number; medida: number; saldo: number }

export function SaldoContrato({ tabelaId, servicos, podeGravar, recarregar }: { tabelaId: string; podeGravar: boolean; recarregar: number; servicos: { ref: string; nome: string; unidade: string }[] }) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [ref, setRef] = useState(servicos[0]?.ref ?? '')
  const [qtd, setQtd] = useState('')
  const [erro, setErro] = useState('')
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_tabela_preco_saldo', { p_tabela: tabelaId })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar o saldo contratado.')); return }
    setErro('')
    setLinhas(((data as { linhas: Linha[] }).linhas ?? []).map(l => ({ ...l, contratada: Number(l.contratada), medida: Number(l.medida), saldo: Number(l.saldo) })))
  }, [tabelaId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga do saldo (recarrega quando uma medição é salva/excluída)
  useEffect(() => { carregar() }, [carregar, recarregar])
  const nome = (r: string) => servicos.find(s => s.ref === r)?.nome ?? r
  const un = (r: string) => servicos.find(s => s.ref === r)?.unidade ?? ''
  const gravar = async (servico: string, valor: string) => {
    const n = valor.trim() === '' ? null : Number(valor.replace(',', '.'))
    if (n !== null && (!Number.isFinite(n) || n < 0)) { setErro('Informe uma quantidade válida (zero ou mais).'); return }
    const { error } = await supabase.rpc('fn_tabela_preco_saldo_gravar', { p_tabela: tabelaId, p_servico_ref: servico, p_quantidade: n })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível gravar a quantidade contratada.')); return }
    setQtd(''); carregar()
  }
  const campo: React.CSSProperties = { padding: 8, border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 15, background: '#fff', color: ESP, minWidth: 0 }
  return (
    <section data-testid="tp-saldo" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginTop: 16, display: 'grid', gap: 10 }}>
      <h2 style={{ fontSize: 17, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>Saldo contratado <AjudaCampo chave="hub.tabela_preco.saldo" /></h2>
      <p style={{ fontSize: 13, color: MUT, margin: 0, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>Quanto do contrato já foi medido (medições salvas) e quanto ainda resta, por serviço.<AjudaCampo chave="hub.tabela_preco.saldo_colunas" /></p>
      {podeGravar && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: MUT }}>Serviço <AjudaCampo chave="hub.tabela_preco.servico" />
            <select aria-label="Serviço do saldo" style={{ ...campo, display: 'block' }} value={ref} onChange={e => setRef(e.target.value)}>
              {servicos.map(s => <option key={s.ref} value={s.ref}>{s.nome} ({s.unidade})</option>)}
            </select></label>
          <label style={{ fontSize: 12, color: MUT }}>Quantidade contratada <AjudaCampo chave="hub.tabela_preco.saldo_contratada" />
            <input aria-label="Quantidade contratada" data-testid="saldo-qtd" inputMode="decimal" style={{ ...campo, display: 'block' }} value={qtd} onChange={e => setQtd(e.target.value)} placeholder="5000" /></label>
          <button type="button" data-testid="saldo-gravar" onClick={() => gravar(ref, qtd)} style={{ minHeight: 44, padding: '0 16px', borderRadius: 8, border: `1px solid ${GOLD}`, background: '#fff', color: ESP, fontWeight: 700 }}>Definir contratado</button>
        </div>
      )}
      {erro && <p role="alert" style={{ color: '#B91C1C', margin: 0 }}>{erro}</p>}
      {linhas.length === 0 ? <p style={{ fontSize: 13, color: MUT, margin: 0 }}>Nenhum serviço com quantidade contratada ainda.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table data-testid="saldo-tabela" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, minWidth: 420 }}>
            <thead><tr style={{ color: MUT, textAlign: 'left' }}><th>Serviço</th><th style={{ textAlign: 'right' }}>Contratado</th><th style={{ textAlign: 'right' }}>Medido</th><th style={{ textAlign: 'right' }}>Saldo</th></tr></thead>
            <tbody>{linhas.map(l => (
              <tr key={l.servico_ref} style={{ borderTop: `1px solid ${LINE}` }}>
                <td>{nome(l.servico_ref)}</td>
                <td style={{ textAlign: 'right' }}>{fmtN(l.contratada)} {un(l.servico_ref)}</td>
                <td style={{ textAlign: 'right' }}>{fmtN(l.medida)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: l.saldo < 0 ? '#B91C1C' : ESP }}>{fmtN(l.saldo)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
