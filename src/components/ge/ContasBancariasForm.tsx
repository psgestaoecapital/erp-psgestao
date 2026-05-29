'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

const TIPOS = [
  { value: 'corrente', label: 'Conta Corrente', icone: '🏦' },
  { value: 'poupanca', label: 'Poupança', icone: '🐷' },
  { value: 'caixinha', label: 'Caixinha / Cofre', icone: '💰' },
  { value: 'permuta', label: 'Permuta', icone: '🔄' },
  { value: 'cartao', label: 'Cartão de Crédito', icone: '💳' },
  { value: 'investimento', label: 'Investimento', icone: '📈' },
]

const CORES_SUGERIDAS = ['#3D2314', '#C8941A', '#3B6D11', '#A32D2D', '#854F0B', '#3B82F6', '#8B5CF6', '#EC4899']

// Schema real: erp_banco_contas usa `tipo_conta` (não `tipo`) e NÃO tem
// coluna `digito` (audited 2026-05-23). Form trabalha em tipo_conta direto.
export interface Conta {
  id: string
  nome: string
  banco: string | null
  agencia: string | null
  conta: string | null
  tipo_conta: string | null
  saldo_inicial: number
  data_saldo_inicial: string | null
  soma_no_saldo: boolean
  cor: string | null
  ativo: boolean
  incluir_no_resumo: boolean
  incluir_no_fluxo: boolean
  incluir_no_orcamento: boolean
}

interface Props {
  companyId: string
  conta: Conta | null
  onClose: () => void
  onSaved: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 13,
  color: '#3D2314',
  background: '#FFFFFF',
  boxSizing: 'border-box',
}

export default function ContasBancariasForm({ companyId, conta, onClose, onSaved }: Props) {
  const [nome, setNome] = useState(conta?.nome ?? '')
  const [banco, setBanco] = useState(conta?.banco ?? '')
  const [agencia, setAgencia] = useState(conta?.agencia ?? '')
  const [contaNumero, setContaNumero] = useState(conta?.conta ?? '')
  const [tipoConta, setTipoConta] = useState(conta?.tipo_conta ?? 'corrente')
  const [saldoInicial, setSaldoInicial] = useState(conta?.saldo_inicial?.toString() ?? '0')
  const [dataSaldoInicial, setDataSaldoInicial] = useState(
    conta?.data_saldo_inicial ?? new Date().toISOString().split('T')[0],
  )
  const [somaNoSaldo, setSomaNoSaldo] = useState(conta?.soma_no_saldo ?? true)
  const [incluirResumo, setIncluirResumo] = useState(conta?.incluir_no_resumo ?? true)
  const [incluirFluxo, setIncluirFluxo] = useState(conta?.incluir_no_fluxo ?? true)
  const [incluirOrcamento, setIncluirOrcamento] = useState(conta?.incluir_no_orcamento ?? true)
  const [cor, setCor] = useState(conta?.cor ?? '#3D2314')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function handleSalvar() {
    if (!nome.trim()) {
      setErro('Nome é obrigatório (ex: "BB Principal", "Caixinha")')
      return
    }
    setSalvando(true)
    setErro(null)

    const payload = {
      company_id: companyId,
      nome: nome.trim(),
      banco: banco.trim() || null,
      agencia: agencia.trim() || null,
      conta: contaNumero.trim() || null,
      tipo_conta: tipoConta,
      saldo_inicial: parseFloat(saldoInicial) || 0,
      data_saldo_inicial: dataSaldoInicial || null,
      soma_no_saldo: somaNoSaldo,
      incluir_no_resumo: incluirResumo,
      incluir_no_fluxo: incluirFluxo,
      incluir_no_orcamento: incluirOrcamento,
      cor,
      ativo: true,
    }

    const result = conta?.id
      ? await supabase.from('erp_banco_contas').update(payload).eq('id', conta.id)
      : await supabase.from('erp_banco_contas').insert(payload)

    setSalvando(false)
    if (result.error) setErro('Erro: ' + result.error.message)
    else onSaved()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(61,35,20,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FAF7F2',
          borderRadius: 12,
          maxWidth: 580,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            background: '#3D2314',
            color: '#FAF7F2',
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {conta?.id ? 'Editar' : 'Nova'} conta bancária
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
              {erro}
            </div>
          )}

          <Campo label="Nome / Apelido *" hint="Como você vai identificar essa conta no dia-a-dia">
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="BB Principal · Caixinha Reserva" style={inputStyle} />
          </Campo>

          <Campo label="Tipo *">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
              {TIPOS.map((t) => {
                const ativo = tipoConta === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipoConta(t.value)}
                    style={{
                      background: ativo ? '#3D2314' : '#FFFFFF',
                      color: ativo ? '#FAF7F2' : '#3D2314',
                      border: `0.5px solid ${ativo ? '#3D2314' : 'rgba(61,35,20,0.15)'}`,
                      padding: '10px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 18 }} aria-hidden>{t.icone}</span>
                    <span>{t.label}</span>
                  </button>
                )
              })}
            </div>
          </Campo>

          <Campo label="Banco" hint="Opcional · ex: '001 - Banco do Brasil'">
            <input value={banco} onChange={(e) => setBanco(e.target.value)} style={inputStyle} />
          </Campo>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Campo label="Agência">
              <input value={agencia} onChange={(e) => setAgencia(e.target.value)} style={inputStyle} />
            </Campo>
            <Campo label="Conta">
              <input value={contaNumero} onChange={(e) => setContaNumero(e.target.value)} style={inputStyle} />
            </Campo>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Campo label="Saldo inicial (R$)">
              <input type="number" step="0.01" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} style={inputStyle} />
            </Campo>
            <Campo label="Data do saldo">
              <input type="date" value={dataSaldoInicial} onChange={(e) => setDataSaldoInicial(e.target.value)} style={inputStyle} />
            </Campo>
          </div>

          <Campo label="Cor identificadora">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CORES_SUGERIDAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  aria-label={`Cor ${c}`}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: c,
                    cursor: 'pointer',
                    border: cor === c ? '2px solid #3D2314' : '0.5px solid rgba(61,35,20,0.15)',
                  }}
                  title={c}
                />
              ))}
            </div>
          </Campo>

          <div style={{ background: 'rgba(200,148,26,0.08)', border: '0.5px solid rgba(200,148,26,0.3)', borderRadius: 8, padding: 14, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={somaNoSaldo} onChange={(e) => setSomaNoSaldo(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#C8941A' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>Somar no saldo consolidado</div>
                <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.6)' }}>
                  Marque para contas operacionais. Desmarque para cartões de crédito ou investimentos que você quer ver separado.
                </div>
              </div>
            </label>
          </div>

          <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 8, padding: 14, marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 10 }}>
              Onde considerar esta conta
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0' }}>
              <input type="checkbox" checked={incluirResumo} onChange={(e) => setIncluirResumo(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#C8941A' }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>Incluir no Resumo</div>
                <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.6)' }}>Aparece no saldo total do hub</div>
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0' }}>
              <input type="checkbox" checked={incluirFluxo} onChange={(e) => setIncluirFluxo(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#C8941A' }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>Incluir no Fluxo de Caixa</div>
                <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.6)' }}>Movimentos somam na visão diária</div>
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0' }}>
              <input type="checkbox" checked={incluirOrcamento} onChange={(e) => setIncluirOrcamento(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#C8941A' }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>Incluir no Orçamento</div>
                <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.6)' }}>Lançamentos entram no Budget Anual</div>
              </div>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSalvar}
              disabled={salvando}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}
            >
              {salvando ? 'Salvando...' : conta?.id ? 'Salvar alterações' : 'Cadastrar conta'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}
