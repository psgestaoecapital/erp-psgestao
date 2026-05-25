'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Fornecedor = {
  id: string
  nome_fantasia: string | null
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

interface NovaDespesaFormProps {
  companyId: string
  onSucesso?: (despesaId: string) => void
  onCancelar?: () => void
}

const exibirNomeFornecedor = (f: Fornecedor) =>
  f.nome_fantasia || f.razao_social || 'Sem nome'

export default function NovaDespesaForm({ companyId, onSucesso, onCancelar }: NovaDespesaFormProps) {
  const router = useRouter()

  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [, setContas] = useState<ContaBancaria[]>([])

  const [fornecedorId, setFornecedorId] = useState('')
  const [fornecedorNome, setFornecedorNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [dataVencimento, setDataVencimento] = useState(
    new Date().toISOString().split('T')[0],
  )
  const [parcelas, setParcelas] = useState(1)
  const [intervaloDias, setIntervaloDias] = useState(30)
  const [categoriaCodigo, setCategoriaCodigo] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('pix')
  const [observacao, setObservacao] = useState('')

  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    ;(async () => {
      const [forn, cats, bcs] = await Promise.all([
        supabase
          .from('erp_fornecedores')
          .select('id, nome_fantasia, razao_social, cpf_cnpj')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome_fantasia'),
        supabase
          .from('erp_plano_contas')
          .select('id, codigo, descricao, nivel')
          .eq('company_id', companyId)
          .eq('tipo', 'despesa')
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
      setFornecedores((forn.data as Fornecedor[] | null) ?? [])
      setCategorias((cats.data as Categoria[] | null) ?? [])
      setContas((bcs.data as ContaBancaria[] | null) ?? [])
    })()
    return () => {
      alive = false
    }
  }, [companyId])

  function validar(): string | null {
    if (!descricao.trim()) return 'Descreva a despesa (ex: "Aluguel sala maio")'
    if (!valor || parseFloat(valor) <= 0) return 'Valor deve ser maior que zero'
    if (!dataVencimento) return 'Quando vence?'
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

    const { data, error } = await supabase.rpc('fn_pagar_criar_com_parcelas', {
      p_company_id: companyId,
      p_fornecedor_id: fornecedorId || null,
      p_fornecedor_nome: fornecedorNome || null,
      p_descricao: descricao.trim(),
      p_valor_total: parseFloat(valor),
      p_data_emissao: new Date().toISOString().split('T')[0],
      p_data_primeiro_vencimento: dataVencimento,
      p_total_parcelas: parcelas,
      p_categoria: categoriaCodigo || null,
      p_numero_documento: numeroDocumento || null,
      p_forma_pagamento: formaPagamento || null,
      p_observacao: observacao || null,
      p_intervalo_dias: intervaloDias,
    })

    setLoading(false)

    if (error) {
      setErro(error.message)
      return
    }

    const resultado = data as { sucesso?: boolean; despesa_id?: string; erro?: string } | null

    if (resultado?.erro) {
      setErro(resultado.erro)
      return
    }

    if (resultado?.despesa_id && onSucesso) {
      onSucesso(resultado.despesa_id)
    } else {
      router.push('/dashboard/financeiro/titulos?area=gestao_empresarial')
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
          Financeiro · Despesas a pagar
        </div>
        <h1 style={{ fontSize: 24, color: '#3D2314', margin: 0, fontWeight: 500 }}>Nova despesa</h1>
        <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>
          Cadastre uma despesa nova · simples como uma nota fiscal
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
          <Campo label="O que é essa despesa?" obrigatorio fullWidth>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder='ex: "Aluguel sala maio" · "Combustível semana"'
              style={inputStyle}
              maxLength={200}
            />
          </Campo>

          <Campo label="Quanto custa?" obrigatorio>
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

          <Campo label="Quando vence?" obrigatorio>
            <input
              type="date"
              value={dataVencimento}
              onChange={(e) => setDataVencimento(e.target.value)}
              style={inputStyle}
            />
          </Campo>

          <Campo label="Para quem você paga?">
            <select
              value={fornecedorId}
              onChange={(e) => {
                setFornecedorId(e.target.value)
                const f = fornecedores.find((x) => x.id === e.target.value)
                setFornecedorNome(f ? exibirNomeFornecedor(f) : '')
              }}
              style={inputStyle}
            >
              <option value="">— sem fornecedor cadastrado —</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {exibirNomeFornecedor(f)}
                </option>
              ))}
            </select>
            {fornecedores.length === 0 && (
              <small style={{ ...helperStyle, color: '#854F0B' }}>
                Você ainda não tem fornecedores · cadastra um primeiro?
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
            <small style={helperStyle}>1 = pagamento à vista</small>
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

          <Campo label="Como você vai pagar?">
            <select
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
              style={inputStyle}
            >
              <option value="pix">Pix</option>
              <option value="boleto">Boleto</option>
              <option value="transferencia">Transferência (TED/DOC)</option>
              <option value="cartao_credito">Cartão de crédito</option>
              <option value="cartao_debito">Cartão de débito</option>
              <option value="dinheiro">Dinheiro</option>
            </select>
          </Campo>

          <Campo label="Número do documento (opcional)">
            <input
              value={numeroDocumento}
              onChange={(e) => setNumeroDocumento(e.target.value)}
              placeholder='ex: "NF 12345" · "Boleto 987"'
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
        </div>

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
            {loading ? 'Salvando...' : 'Salvar despesa'}
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
