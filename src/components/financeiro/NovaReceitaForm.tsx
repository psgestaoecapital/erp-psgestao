'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Cliente = {
  id: string
  nome_fantasia: string
  razao_social: string | null
  cpf_cnpj: string | null
}

type Categoria = {
  id: string
  codigo: string
  descricao: string
  nivel: number
}

type ContaBancaria = {
  id: string
  nome: string
  banco: string
}

interface NovaReceitaFormProps {
  companyId: string
  onSucesso?: (receitaId: string) => void
  onCancelar?: () => void
}

const exibirNomeCliente = (c: Cliente) =>
  c.nome_fantasia || c.razao_social || 'Sem nome'

export default function NovaReceitaForm({ companyId, onSucesso, onCancelar }: NovaReceitaFormProps) {
  const router = useRouter()

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [contas, setContas] = useState<ContaBancaria[]>([])

  const [clienteId, setClienteId] = useState('')
  const [clienteNome, setClienteNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [dataRecebimento, setDataRecebimento] = useState(
    new Date().toISOString().split('T')[0],
  )
  const [dataCompetencia, setDataCompetencia] = useState('')
  const [parcelas, setParcelas] = useState(1)
  const [intervaloDias, setIntervaloDias] = useState(30)
  const [categoriaCodigo, setCategoriaCodigo] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [formaRecebimento, setFormaRecebimento] = useState('pix')
  const [contaBancaria, setContaBancaria] = useState('')
  const [observacao, setObservacao] = useState('')
  const [jaRecebido, setJaRecebido] = useState(false)
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().split('T')[0])

  const [loading, setLoading] = useState(false)
  const [semPlano, setSemPlano] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    ;(async () => {
      const [cli, cats, bcs] = await Promise.all([
        supabase
          .from('erp_clientes')
          .select('id, nome_fantasia, razao_social, cpf_cnpj')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome_fantasia'),
        supabase
          .from('erp_plano_contas')
          .select('id, codigo, descricao, nivel')
          .eq('company_id', companyId)
          .eq('tipo', 'receita')
          .eq('ativo', true)
          .order('codigo'),
        supabase
          .from('erp_banco_contas')
          .select('id, nome, banco')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome'),
      ])
      if (!alive) return
      setClientes((cli.data as Cliente[] | null) ?? [])
      setCategorias((cats.data as Categoria[] | null) ?? [])
      setContas((bcs.data as ContaBancaria[] | null) ?? [])
    })()
    return () => {
      alive = false
    }
  }, [companyId])

  function validar(): string | null {
    if (!descricao.trim()) return 'Descreva a receita (ex: "Mensalidade cliente X · maio")'
    if (!valor || parseFloat(valor) <= 0) return 'Valor deve ser maior que zero'
    if (!dataRecebimento) return 'Quando entra na conta?'
    if (parcelas < 1 || parcelas > 60) return 'Parcelas entre 1 e 60'
    return null
  }

  async function salvar() {
    const erroValidacao = validar()
    if (erroValidacao) {
      setErro(erroValidacao)
      return
    }

    setLoading(true)
    setErro(null)

    const { data, error } = await supabase.rpc('fn_receber_criar_com_parcelas', {
      p_company_id: companyId,
      p_cliente_id: clienteId || null,
      p_cliente_nome: clienteNome || null,
      p_descricao: descricao.trim(),
      p_valor_total: parseFloat(valor),
      p_data_emissao: new Date().toISOString().split('T')[0],
      p_data_primeiro_recebimento: dataRecebimento,
      p_total_parcelas: parcelas,
      p_categoria: categoriaCodigo || null,
      p_numero_documento: numeroDocumento || null,
      p_forma_recebimento: formaRecebimento || null,
      p_observacao: observacao || null,
      p_intervalo_dias: intervaloDias,
      p_status_inicial: 'pendente',
      p_conta_bancaria: contaBancaria || null,
    })

    if (error) {
      setLoading(false)
      setErro(error.message)
      return
    }

    const resultado = data as {
      success?: boolean
      sem_plano?: boolean
      qtd_parcelas_criadas?: number
      valor_por_parcela?: number
      status_inicial?: string
      ids?: string[]
    } | null

    if (resultado?.sem_plano) {
      setLoading(false)
      setSemPlano(true)
      return
    }

    const ids = resultado?.ids ?? []
    const dataCompFinal = dataCompetencia || dataRecebimento
    if (ids.length > 0 && dataCompFinal) {
      await supabase.from('erp_receber').update({ data_competencia: dataCompFinal }).in('id', ids)
    }

    if (jaRecebido && ids.length > 0 && contaBancaria) {
      for (const id of ids) {
        await supabase.rpc('fn_receber_baixar_pagamento', {
          p_receber_id: id,
          p_data_pagamento: dataPagamento,
          p_conta_bancaria_id: contaBancaria,
          p_forma_pagamento: (formaRecebimento || 'PIX').toUpperCase(),
          p_valor_pago: null,
        })
      }
    }

    setLoading(false)

    const primeiroId = ids[0]
    if (primeiroId && onSucesso) {
      onSucesso(primeiroId)
    } else {
      router.push('/dashboard/financeiro/receber?area=gestao_empresarial')
    }
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            color: 'rgba(61,35,20,0.55)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          Financeiro · Receitas a receber
        </div>
        <h1 style={{ fontSize: 24, color: '#3D2314', margin: 0, fontWeight: 500 }}>Nova receita</h1>
        <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>
          Cadastre uma entrada nova · venda · serviço · mensalidade
        </div>
      </div>

      <div
        style={{
          background: '#FFFFFF',
          border: '0.5px solid rgba(61,35,20,0.12)',
          borderRadius: 12,
          padding: '24px 28px',
          maxWidth: 720,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 18,
          }}
        >
          <Campo label="O que é essa receita?" obrigatorio fullWidth>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder='ex: "Mensalidade cliente X · maio" · "Venda 200 unidades"'
              style={inputStyle}
              maxLength={200}
            />
          </Campo>

          <Campo label="Quanto vou receber?" obrigatorio>
            <input
              type="number"
              step="0.01"
              min="0"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="0,00"
              style={inputStyle}
            />
            <small style={helperStyle}>Em reais (R$)</small>
          </Campo>

          <Campo label="Quando entra na conta?" obrigatorio>
            <input
              type="date"
              value={dataRecebimento}
              onChange={(e) => setDataRecebimento(e.target.value)}
              style={inputStyle}
            />
          </Campo>

          <Campo label="Data de competência (opcional)">
            <input
              type="date"
              value={dataCompetencia}
              onChange={(e) => setDataCompetencia(e.target.value)}
              placeholder={dataRecebimento}
              style={inputStyle}
            />
            <small style={helperStyle}>
              Mês contábil ao qual essa receita pertence. Default = data de recebimento.
            </small>
          </Campo>

          <Campo label="De quem você vai receber?">
            <select
              value={clienteId}
              onChange={(e) => {
                setClienteId(e.target.value)
                const c = clientes.find((x) => x.id === e.target.value)
                setClienteNome(c ? exibirNomeCliente(c) : '')
              }}
              style={inputStyle}
            >
              <option value="">— sem cliente cadastrado —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {exibirNomeCliente(c)}
                </option>
              ))}
            </select>
            {clientes.length === 0 && (
              <small style={{ ...helperStyle, color: '#854F0B' }}>
                Você ainda não tem clientes · cadastra um primeiro?
              </small>
            )}
          </Campo>

          <Campo label="Em qual categoria do DRE?">
            <select
              value={categoriaCodigo}
              onChange={(e) => setCategoriaCodigo(e.target.value)}
              style={inputStyle}
            >
              <option value="">— escolher depois —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.codigo}>
                  {c.codigo} · {c.descricao}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Quantas parcelas?">
            <input
              type="number"
              min="1"
              max="60"
              value={parcelas}
              onChange={(e) => setParcelas(parseInt(e.target.value) || 1)}
              style={inputStyle}
            />
            <small style={helperStyle}>1 = recebimento à vista</small>
          </Campo>

          {parcelas > 1 && (
            <Campo label="Intervalo entre parcelas">
              <select
                value={intervaloDias}
                onChange={(e) => setIntervaloDias(parseInt(e.target.value))}
                style={inputStyle}
              >
                <option value="7">Semanal (7 dias)</option>
                <option value="15">Quinzenal (15 dias)</option>
                <option value="30">Mensal (30 dias)</option>
                <option value="60">Bimestral (60 dias)</option>
              </select>
            </Campo>
          )}

          <Campo label="Como você vai receber?">
            <select
              value={formaRecebimento}
              onChange={(e) => setFormaRecebimento(e.target.value)}
              style={inputStyle}
            >
              <option value="pix">Pix</option>
              <option value="boleto">Boleto</option>
              <option value="transferencia">Transferência (TED/DOC)</option>
              <option value="cartao_credito">Cartão de crédito</option>
              <option value="cartao_debito">Cartão de débito</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="cheque">Cheque</option>
            </select>
          </Campo>

          <Campo label="Em qual conta entra o dinheiro?">
            <select
              value={contaBancaria}
              onChange={(e) => setContaBancaria(e.target.value)}
              style={inputStyle}
            >
              <option value="">— escolher depois —</option>
              {contas.map((c) => (
                <option key={c.id} value={c.nome}>
                  {c.nome}{c.banco ? ` · ${c.banco}` : ''}
                </option>
              ))}
            </select>
            {contas.length === 0 && (
              <small style={{ ...helperStyle, color: '#854F0B' }}>
                Nenhuma conta bancária cadastrada · pule por agora
              </small>
            )}
          </Campo>

          <Campo label="Número do documento (opcional)">
            <input
              value={numeroDocumento}
              onChange={(e) => setNumeroDocumento(e.target.value)}
              placeholder='ex: "NF 12345" · "Pedido 987"'
              style={inputStyle}
              maxLength={50}
            />
          </Campo>

          <Campo label="Observação (opcional)" fullWidth>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Qualquer detalhe importante..."
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              maxLength={500}
            />
          </Campo>

          <div style={{ gridColumn: '1 / -1', borderTop: '0.5px solid rgba(61,35,20,0.12)', paddingTop: 12, marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#3D2314', cursor: 'pointer', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={jaRecebido}
                onChange={(e) => setJaRecebido(e.target.checked)}
              />
              Já recebi essa receita
            </label>
            {jaRecebido && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
                <Campo label="Data do recebimento" obrigatorio>
                  <input
                    type="date"
                    value={dataPagamento}
                    onChange={(e) => setDataPagamento(e.target.value)}
                    style={inputStyle}
                  />
                </Campo>
                {!contaBancaria && (
                  <small style={{ ...helperStyle, color: '#A32D2D', gridColumn: '1 / -1' }}>
                    Selecione uma conta bancária acima pra registrar o recebimento.
                  </small>
                )}
              </div>
            )}
          </div>
        </div>

        {semPlano && (
          <div
            style={{
              background: '#FFF7ED',
              color: '#854F0B',
              border: '0.5px solid rgba(200,148,26,0.4)',
              padding: '10px 14px',
              borderRadius: 6,
              marginTop: 18,
              fontSize: 13,
            }}
          >
            Esta empresa ainda não tem o plano <strong>Gestão Empresarial Pro</strong> ativo.
            Ative o plano pra cadastrar receitas.
          </div>
        )}

        {erro && (
          <div
            style={{
              background: '#FCEBEB',
              color: '#A32D2D',
              padding: '10px 14px',
              borderRadius: 6,
              marginTop: 18,
              fontSize: 13,
            }}
          >
            {erro}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 24,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={onCancelar || (() => router.back())}
            disabled={loading}
            style={{
              background: 'transparent',
              color: '#3D2314',
              border: '0.5px solid rgba(61,35,20,0.25)',
              padding: '10px 20px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={loading}
            style={{
              background: '#C8941A',
              color: '#3D2314',
              border: 'none',
              padding: '10px 28px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Salvando...' : 'Salvar receita'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 13,
  background: '#FFFFFF',
  color: '#3D2314',
  fontFamily: 'inherit',
}

const helperStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'rgba(61,35,20,0.55)',
  marginTop: 4,
}

function Campo({
  label,
  children,
  obrigatorio = false,
  fullWidth = false,
}: {
  label: string
  children: React.ReactNode
  obrigatorio?: boolean
  fullWidth?: boolean
}) {
  return (
    <div style={fullWidth ? { gridColumn: '1 / -1' } : undefined}>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          color: 'rgba(61,35,20,0.65)',
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        {label}
        {obrigatorio && <span style={{ color: '#A32D2D', marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  )
}
