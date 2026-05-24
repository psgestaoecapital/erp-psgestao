'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Cliente {
  id: string
  nome_fantasia: string
  razao_social: string | null
  cnpj_cpf: string | null
  email: string | null
  telefone: string | null
}

export interface Contrato {
  id?: string
  numero?: string
  nome?: string
  tipo?: string
  cliente_id?: string | null
  cliente_nome?: string | null
  cliente_cnpj?: string | null
  cliente_email?: string | null
  cliente_telefone?: string | null
  valor_mensal?: number
  valor_atual?: number | null
  data_inicio?: string
  data_fim?: string | null
  data_primeiro_vencimento?: string | null
  dia_vencimento?: number
  periodicidade?: string
  tipo_reajuste?: string
  reajuste_percentual?: number
  forma_pagamento?: string
  status?: string
  descricao?: string | null
}

const TIPOS = [
  { value: 'mensalidade', label: 'Mensalidade' },
  { value: 'aluguel', label: 'Aluguel' },
  { value: 'servico', label: 'Serviço continuado' },
  { value: 'assinatura', label: 'Assinatura' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'bpo_financeiro', label: 'BPO Financeiro' },
  { value: 'outros', label: 'Outros' },
]

const PERIODICIDADES = [
  { value: 'mensal', label: 'Todo mês' },
  { value: 'bimestral', label: 'A cada 2 meses' },
  { value: 'trimestral', label: 'A cada 3 meses' },
  { value: 'semestral', label: 'A cada 6 meses' },
  { value: 'anual', label: 'Uma vez por ano' },
]

const TIPOS_REAJUSTE = [
  { value: 'nenhum', label: 'Sem reajuste' },
  { value: 'ipca', label: 'Anual IPCA (~4,5%)' },
  { value: 'igpm', label: 'Anual IGPM (~6%)' },
  { value: 'personalizado', label: 'Personalizado' },
]

interface Props {
  companyId: string
  contrato: Contrato | null
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

const gridResponsivo: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 12,
}

function nomeDoCliente(c: Cliente): string {
  return c.nome_fantasia || c.razao_social || 'Cliente sem nome'
}

export default function ContratoForm({ companyId, contrato, onClose, onSaved }: Props) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [nome, setNome] = useState(contrato?.nome ?? '')
  const [tipo, setTipo] = useState(contrato?.tipo ?? 'mensalidade')
  const [clienteId, setClienteId] = useState(contrato?.cliente_id ?? '')
  const [valorMensal, setValorMensal] = useState(contrato?.valor_mensal?.toString() ?? '')
  const [dataInicio, setDataInicio] = useState(
    contrato?.data_inicio ?? new Date().toISOString().split('T')[0],
  )
  const [dataFim, setDataFim] = useState(contrato?.data_fim ?? '')
  const [diaVencimento, setDiaVencimento] = useState(contrato?.dia_vencimento?.toString() ?? '10')
  const [periodicidade, setPeriodicidade] = useState(contrato?.periodicidade ?? 'mensal')
  const [tipoReajuste, setTipoReajuste] = useState(contrato?.tipo_reajuste ?? 'nenhum')
  const [reajustePercentual, setReajustePercentual] = useState(
    contrato?.reajuste_percentual?.toString() ?? '0',
  )
  const [descricao, setDescricao] = useState(contrato?.descricao ?? '')
  const [status, setStatus] = useState(contrato?.status ?? 'ativo')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      const { data } = await supabase
        .from('erp_clientes')
        .select('id, nome_fantasia, razao_social, cnpj_cpf, email, telefone')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .order('nome_fantasia')
      if (!ignore && data) setClientes(data as Cliente[])
    })()
    return () => { ignore = true }
  }, [companyId])

  async function handleSalvar() {
    if (!nome.trim()) {
      setErro('Dá um nome para essa cobrança — ex: "Aluguel sala 101"')
      return
    }
    if (!valorMensal || parseFloat(valorMensal) <= 0) {
      setErro('Valor precisa ser maior que zero')
      return
    }
    if (!dataInicio) {
      setErro('Quando essa cobrança começa?')
      return
    }
    setSalvando(true)
    setErro(null)

    const clienteSel = clientes.find((c) => c.id === clienteId) ?? null

    const payload = {
      company_id: companyId,
      numero: contrato?.numero || `CTR-${Date.now().toString().slice(-6)}`,
      nome: nome.trim(),
      tipo,
      cliente_id: clienteId || null,
      cliente_nome: clienteSel ? nomeDoCliente(clienteSel) : null,
      cliente_cnpj: clienteSel?.cnpj_cpf ?? null,
      cliente_email: clienteSel?.email ?? null,
      cliente_telefone: clienteSel?.telefone ?? null,
      valor_mensal: parseFloat(valorMensal),
      valor_atual: parseFloat(valorMensal),
      data_inicio: dataInicio,
      data_fim: dataFim || null,
      data_primeiro_vencimento: dataInicio,
      dia_vencimento: parseInt(diaVencimento, 10) || 10,
      periodicidade,
      tipo_reajuste: tipoReajuste,
      reajuste_percentual: parseFloat(reajustePercentual) || 0,
      descricao: descricao.trim() || null,
      status,
      updated_at: new Date().toISOString(),
    }

    const result = contrato?.id
      ? await supabase.from('erp_contratos').update(payload).eq('id', contrato.id)
      : await supabase.from('erp_contratos').insert(payload)

    setSalvando(false)
    if (result.error) setErro('Não consegui salvar: ' + result.error.message)
    else onSaved()
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FAF7F2', borderRadius: 12, maxWidth: 700, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
      >
        <div style={{ background: '#3D2314', color: '#FAF7F2', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {contrato?.id ? 'Editar cobrança' : 'Nova cobrança recorrente'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 22, cursor: 'pointer', padding: 0, width: 28, height: 28, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{erro}</div>
          )}

          <Campo label="Nome da cobrança *" hint='Ex: "Aluguel sala 101", "Mensalidade Cliente ABC"'>
            <input value={nome} onChange={(e) => setNome(e.target.value)} style={inputStyle} />
          </Campo>

          <div style={gridResponsivo}>
            <Campo label="Tipo *">
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inputStyle}>
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
                <option value="ativo">Ativo · cobrando</option>
                <option value="suspenso">Pausado</option>
                <option value="encerrado">Encerrado</option>
              </select>
            </Campo>
          </div>

          <Campo label="Cliente (opcional)" hint="Vincule a um cliente cadastrado. Se vazio, fica como cobrança avulsa.">
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={inputStyle}>
              <option value="">— Sem cliente vinculado —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {nomeDoCliente(c)}
                  {c.cnpj_cpf ? ` · ${c.cnpj_cpf}` : ''}
                </option>
              ))}
            </select>
          </Campo>

          <div style={{ ...gridResponsivo, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Campo label="Valor *">
              <input type="number" step="0.01" value={valorMensal} onChange={(e) => setValorMensal(e.target.value)} placeholder="0,00" style={inputStyle} />
            </Campo>
            <Campo label="Frequência *">
              <select value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)} style={inputStyle}>
                {PERIODICIDADES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Dia vence *">
              <input type="number" min={1} max={31} value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} style={inputStyle} />
            </Campo>
          </div>

          <div style={gridResponsivo}>
            <Campo label="Quando começa *">
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={inputStyle} />
            </Campo>
            <Campo label="Quando acaba (deixe vazio se indefinido)">
              <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inputStyle} />
            </Campo>
          </div>

          <div style={gridResponsivo}>
            <Campo label="Reajuste">
              <select value={tipoReajuste} onChange={(e) => setTipoReajuste(e.target.value)} style={inputStyle}>
                {TIPOS_REAJUSTE.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Campo>
            <Campo label="% anual">
              <input type="number" step="0.01" value={reajustePercentual} onChange={(e) => setReajustePercentual(e.target.value)} disabled={tipoReajuste === 'nenhum'} style={inputStyle} />
            </Campo>
          </div>

          <Campo label="Observações (opcional)">
            <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} style={{ ...inputStyle, fontFamily: 'inherit' }} placeholder="Algum detalhe importante?" />
          </Campo>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, flexWrap: 'wrap' }}>
            <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
            <button type="button" onClick={handleSalvar} disabled={salvando} style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}>
              {salvando ? 'Salvando…' : contrato?.id ? 'Salvar alterações' : 'Cadastrar cobrança'}
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
