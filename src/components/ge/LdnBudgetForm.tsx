'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface LDNRef {
  id: string
  nome: string
  cor: string | null
}

interface Props {
  companyId: string
  ldn: LDNRef
  ano: number
  onClose: () => void
  onSaved: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 14,
  color: '#3D2314',
  background: '#FFFFFF',
  boxSizing: 'border-box',
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function LdnBudgetForm({ companyId, ldn, ano, onClose, onSaved }: Props) {
  const [receitaMensal, setReceitaMensal] = useState('0')
  const [despesaMensal, setDespesaMensal] = useState('0')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function handleSalvar() {
    setSalvando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_ldn_aplicar_budget_anual', {
      p_company_id: companyId,
      p_linha_id: ldn.id,
      p_ano: ano,
      p_receita_mensal: parseFloat(receitaMensal) || 0,
      p_despesa_mensal: parseFloat(despesaMensal) || 0,
    })
    setSalvando(false)
    if (error) {
      setErro('Não consegui salvar: ' + error.message)
      return
    }
    const result = data as { sem_plano?: boolean; erro?: boolean; mensagem?: string } | null
    if (result?.sem_plano) {
      setErro('Plano Gestão Empresarial Pró é necessário')
      return
    }
    if (result?.erro) {
      setErro(result.mensagem ?? 'Erro ao aplicar planejamento')
      return
    }
    onSaved()
  }

  const recM = parseFloat(receitaMensal) || 0
  const desM = parseFloat(despesaMensal) || 0
  const margemMensal = recM - desM
  const receitaAnual = recM * 12
  const despesaAnual = desM * 12
  const corMargem = margemMensal >= 0 ? '#3B6D11' : '#A32D2D'

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FAF7F2', borderRadius: 12, maxWidth: 540, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
      >
        <div style={{ background: '#3D2314', color: '#FAF7F2', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0, gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            Planejado {ano} · {ldn.nome}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 0, width: 28, height: 28 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{erro}</div>
          )}

          <div style={{ background: 'rgba(200,148,26,0.1)', padding: '12px 14px', borderRadius: 6, marginBottom: 20, fontSize: 12, color: '#854F0B' }}>
            💡 Aplica o mesmo valor aos 12 meses de {ano}. Você poderá ajustar mês a mês numa próxima versão.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontWeight: 700 }}>
                Receita por mês (R$)
              </label>
              <input type="number" step="0.01" value={receitaMensal} onChange={(e) => setReceitaMensal(e.target.value)} placeholder="0,00" style={inputStyle} />
              <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>
                Total anual: R$ {fmt(receitaAnual)}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontWeight: 700 }}>
                Despesa por mês (R$)
              </label>
              <input type="number" step="0.01" value={despesaMensal} onChange={(e) => setDespesaMensal(e.target.value)} placeholder="0,00" style={inputStyle} />
              <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>
                Total anual: R$ {fmt(despesaAnual)}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20, padding: '14px 16px', background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.7)' }}>
              Margem esperada por mês:{' '}
              <strong style={{ color: corMargem }}>R$ {fmt(margemMensal)}</strong>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>
              Margem anual: <strong style={{ color: corMargem }}>R$ {fmt(margemMensal * 12)}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, flexWrap: 'wrap' }}>
            <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
            <button type="button" onClick={handleSalvar} disabled={salvando} style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 22px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}>
              {salvando ? 'Aplicando…' : `Aplicar para 12 meses de ${ano}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
