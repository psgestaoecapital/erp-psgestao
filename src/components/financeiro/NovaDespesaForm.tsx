'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import CategoriaCombobox from './CategoriaCombobox'

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
  const searchParams = useSearchParams()
  // Conciliacao: se vier ?origem_conciliacao=<mov_id>, esta despesa nasce
  // vinculada a um movimento do extrato. Fluxo atomico: cria com status=aberto
  // + fn_conciliacao_aplicar_match -> trigger trg_baixa_por_conciliacao faz a baixa.
  const origemConciliacao = searchParams?.get('origem_conciliacao') ?? null

  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [contas, setContas] = useState<ContaBancaria[]>([])

  const [fornecedorId, setFornecedorId] = useState('')
  const [fornecedorNome, setFornecedorNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [dataVencimento, setDataVencimento] = useState(
    new Date().toISOString().split('T')[0],
  )
  const [dataCompetencia, setDataCompetencia] = useState('')
  const [parcelas, setParcelas] = useState(1)
  const [intervaloDias, setIntervaloDias] = useState(30)
  const [categoriaCodigo, setCategoriaCodigo] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('pix')
  const [contaBancaria, setContaBancaria] = useState('')
  const [observacao, setObservacao] = useState('')
  const [jaPago, setJaPago] = useState(false)
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().split('T')[0])
  // Fatia 3 estabilização nova-despesa (09/07): ⚡ conta com integração + salvar-dropdown
  const [contasAuto, setContasAuto] = useState<Set<string>>(new Set())
  const [ok, setOk] = useState<string | null>(null)
  const [salvarMenu, setSalvarMenu] = useState(false)

  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [copiarAberto, setCopiarAberto] = useState(false)

  // Prefill via query (?valor=&data=&descricao=) — usado pelo fluxo Conciliacao
  // "Incluir nova conta" que envia os dados do movimento.
  useEffect(() => {
    if (!searchParams) return
    const v = searchParams.get('valor')
    const d = searchParams.get('data')
    const desc = searchParams.get('descricao')
    if (v && !valor) setValor(v)
    if (d && d.match(/^\d{4}-\d{2}-\d{2}$/)) setDataVencimento(d)
    if (desc && !descricao) setDescricao(desc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    if (!companyId) return
    let alive = true
    ;(async () => {
      const [forn, cats, bcs, prov] = await Promise.all([
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
        // Fatia 3: contas com integração bancária ativa → ícone ⚡ (concilia automático)
        supabase
          .from('erp_banco_provider_config')
          .select('banco_conta_id')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .not('banco_conta_id', 'is', null),
      ])
      if (!alive) return
      setFornecedores((forn.data as Fornecedor[] | null) ?? [])
      setCategorias((cats.data as Categoria[] | null) ?? [])
      setContas((bcs.data as ContaBancaria[] | null) ?? [])
      setContasAuto(new Set(((prov.data as { banco_conta_id: string | null }[] | null) ?? [])
        .map((p) => p.banco_conta_id).filter((x): x is string => !!x)))
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

  function limparForm() {
    setFornecedorId(''); setFornecedorNome(''); setDescricao(''); setValor('')
    setDataVencimento(new Date().toISOString().split('T')[0]); setDataCompetencia('')
    setParcelas(1); setIntervaloDias(30); setCategoriaCodigo(''); setNumeroDocumento('')
    setObservacao(''); setJaPago(false); setContaBancaria('')
  }

  // modo: 'fechar' = comportamento padrão (redireciona/onSucesso);
  //       'nova' = salva e limpa o form pra lançar outra; 'duplicar' = salva e MANTÉM os
  //       valores pra lançar uma parecida. (Fatia 3 · "Salvar" dropdown estilo ContaAzul.)
  async function salvar(modo: 'fechar' | 'nova' | 'duplicar' = 'fechar') {
    setSalvarMenu(false)
    setOk(null)
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
      ids?: string[]
    } | null

    if (resultado?.sem_plano) {
      setLoading(false)
      setErro('Não foi possível salvar agora. Verifique o cadastro da empresa.')
      return
    }

    const ids = resultado?.ids ?? []
    const dataCompFinal = dataCompetencia || dataVencimento
    if (ids.length > 0 && dataCompFinal) {
      await supabase.from('erp_pagar').update({ data_competencia: dataCompFinal }).in('id', ids)
    }

    // Fluxo atomico (RD-38): quando vem da Conciliacao, a baixa e feita pelo
    // trigger trg_baixa_por_conciliacao — NUNCA chamar fn_pagar_baixar_pagamento
    // aqui, mesmo se o usuario tiver marcado "ja pago". Fonte unica da baixa.
    if (!origemConciliacao && jaPago && ids.length > 0 && contaBancaria) {
      // Baixa apenas a 1a parcela · as demais ficam 'aberto'.
      // ids[0] eh a parcela 1/N (fn_pagar_criar_com_parcelas retorna na ordem).
      const primeiroId = ids[0]
      await supabase.rpc('fn_pagar_baixar_pagamento', {
        p_pagar_id: primeiroId,
        p_data_pagamento: dataPagamento,
        p_conta_bancaria_id: contaBancaria,
        p_forma_pagamento: (formaPagamento || 'PIX').toUpperCase(),
        p_valor_pago: null,
      })
    }

    // Vincula ao movimento do extrato -> trigger dispara a baixa canonica.
    if (origemConciliacao && ids.length > 0) {
      const primeiroId = ids[0]
      const { data: { user } } = await supabase.auth.getUser()
      const { error: matchErr } = await supabase.rpc('fn_conciliacao_aplicar_match', {
        p_movimento_id: origemConciliacao,
        p_lancamento_tabela: 'erp_pagar',
        p_lancamento_id: primeiroId,
        p_operador_id: user?.id ?? null,
        p_origem: 'novo_lancamento',
      })
      if (matchErr) {
        setLoading(false)
        setErro('Despesa CRIOU mas nao CONCILIOU: ' + matchErr.message)
        return
      }
    }

    setLoading(false)

    const primeiroId = ids[0]
    if (origemConciliacao) {
      // Volta pra Conciliacao (o movimento agora esta CONCILIADO) — fluxo sempre fecha.
      router.push('/dashboard/financeiro/conciliacao/inbox')
      return
    }
    // Fatia 3: "Salvar e nova" / "Salvar e duplicar" NÃO navegam — ficam no form.
    if (modo === 'nova') {
      limparForm()
      setOk('✓ CRIOU a despesa. Form limpo pra lançar outra.')
      return
    }
    if (modo === 'duplicar') {
      setOk('✓ CRIOU a despesa. Valores mantidos — ajuste e salve outra.')
      return
    }
    if (primeiroId && onSucesso) {
      onSucesso(primeiroId)
    } else {
      router.push('/dashboard/financeiro/pagar?area=gestao_empresarial')
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

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ ...atalhoBtn(true), pointerEvents: 'none' }}>🆕 Despesa nova</span>
          <button type="button" onClick={() => setCopiarAberto(true)} style={atalhoBtn(false)}>
            📋 Copiar de outra
          </button>
          <span title="Em breve: modelos de despesa" style={{ ...atalhoBtn(false), opacity: 0.45, cursor: 'not-allowed' }}>
            📌 Usar modelo
          </span>
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

          <Campo label="Data de competência (opcional)">
            <input
              type="date"
              value={dataCompetencia}
              onChange={(e) => setDataCompetencia(e.target.value)}
              placeholder={dataVencimento}
              style={inputStyle}
            />
            <small style={helperStyle}>
              Mês contábil ao qual essa despesa pertence. Default = vencimento.
            </small>
          </Campo>

          <Campo label="Para quem você paga?">
            {fornecedores.length > 0 ? (
              <>
                <select
                  value={fornecedorId}
                  onChange={(e) => {
                    setFornecedorId(e.target.value)
                    const f = fornecedores.find((x) => x.id === e.target.value)
                    setFornecedorNome(f ? exibirNomeFornecedor(f) : '')
                  }}
                  style={inputStyle}
                >
                  <option value="">— Outro (digite abaixo) —</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {exibirNomeFornecedor(f)}
                    </option>
                  ))}
                </select>
                {!fornecedorId && (
                  <input
                    value={fornecedorNome}
                    onChange={(e) => setFornecedorNome(e.target.value)}
                    placeholder="Digite o nome do fornecedor"
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                )}
                {!fornecedorId && fornecedorNome && (
                  <small style={helperStyle}>
                    Vamos cadastrar esse fornecedor pra você automaticamente.
                  </small>
                )}
              </>
            ) : (
              <>
                <input
                  value={fornecedorNome}
                  onChange={(e) => { setFornecedorNome(e.target.value); setFornecedorId('') }}
                  placeholder="Digite o nome do fornecedor"
                  style={inputStyle}
                />
                <small style={helperStyle}>
                  Não está na lista? Digite o nome e a gente cadastra depois.
                </small>
              </>
            )}
          </Campo>

          <Campo label="Em qual categoria do DRE?">
            {/* FASE-1 CATEGORIAS (07/07): combobox digitavel + criar inline.
                Substitui <select> antigo que so listava categorias existentes.
                Backend: fn_plano_contas_buscar + fn_plano_contas_criar_inline. */}
            <CategoriaCombobox
              companyId={companyId}
              aplicacao="pagar"
              value={categoriaCodigo}
              onChange={setCategoriaCodigo}
            />
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

          <Campo label="Em qual conta sai o dinheiro?">
            <select
              value={contaBancaria}
              onChange={(e) => setContaBancaria(e.target.value)}
              style={inputStyle}
            >
              <option value="">— escolher depois —</option>
              {contas.map((c) => {
                const auto = contasAuto.has(c.id)
                return (
                  <option key={c.id} value={c.nome}>
                    🏦 {c.nome}{c.banco ? ` · ${c.banco}` : ''}{auto ? ' ⚡' : ''}
                  </option>
                )
              })}
            </select>
            {contas.length === 0 ? (
              <small style={{ ...helperStyle, color: '#854F0B' }}>
                Nenhuma conta bancária cadastrada · pule por agora
              </small>
            ) : contasAuto.size > 0 ? (
              <small style={helperStyle}>⚡ = conta com integração bancária (concilia automático)</small>
            ) : null}
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

          <div style={{ gridColumn: '1 / -1', borderTop: '0.5px solid rgba(61,35,20,0.12)', paddingTop: 12, marginTop: 4 }}>
            {origemConciliacao ? (
              <div style={{ background: '#DCFCE7', color: '#166534', padding: '10px 12px', borderRadius: 8, fontSize: 12, border: '0.5px solid rgba(22,163,74,0.35)' }}>
                🔗 Esta despesa CRIOU a partir de um movimento do extrato bancário.
                Ao salvar, ela CONCILIA automaticamente com o movimento — a baixa é feita
                pelo sistema (não precisa marcar "já paguei").
              </div>
            ) : (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#3D2314', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={jaPago}
                    onChange={(e) => setJaPago(e.target.checked)}
                  />
                  {parcelas > 1 ? 'Já paguei a 1ª parcela' : 'Já paguei essa despesa'}
                </label>
              </>
            )}
            {jaPago && !origemConciliacao && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
                <Campo label="Data do pagamento" obrigatorio>
                  <input
                    type="date"
                    value={dataPagamento}
                    onChange={(e) => setDataPagamento(e.target.value)}
                    style={inputStyle}
                  />
                </Campo>
                {!contaBancaria && (
                  <small style={{ ...helperStyle, color: '#A32D2D', gridColumn: '1 / -1' }}>
                    Selecione uma conta bancária acima pra registrar o pagamento.
                  </small>
                )}
              </div>
            )}
          </div>
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
        {ok && (
          <div style={{ background: '#EAF3DE', color: '#3B6D11', padding: '10px 14px', borderRadius: 6, marginTop: 18, fontSize: 13, fontWeight: 600 }}>
            {ok}
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
          {/* Fatia 3: dropdown Salvar (Salvar / Salvar e nova / Salvar e duplicar) */}
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              onClick={() => void salvar('fechar')}
              disabled={loading}
              style={{
                background: '#C8941A', color: '#3D2314', border: 'none',
                padding: '10px 20px', borderRadius: '6px 0 0 6px', fontSize: 13, fontWeight: 500,
                cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Salvando...' : 'Salvar despesa'}
            </button>
            <button
              type="button"
              aria-label="Mais opções de salvar"
              onClick={() => setSalvarMenu((v) => !v)}
              disabled={loading}
              style={{
                background: '#C8941A', color: '#3D2314', border: 'none',
                borderLeft: '1px solid rgba(61,35,20,0.25)', padding: '10px 12px',
                borderRadius: '0 6px 6px 0', fontSize: 13, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1,
              }}
            >
              ▾
            </button>
            {salvarMenu && !loading && (
              <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 8, boxShadow: '0 8px 24px rgba(61,35,20,0.15)', zIndex: 20, minWidth: 200, overflow: 'hidden' }}>
                <button type="button" onClick={() => void salvar('nova')} style={menuItemStyle}>Salvar e lançar nova</button>
                <button type="button" onClick={() => void salvar('duplicar')} style={{ ...menuItemStyle, borderTop: '0.5px solid rgba(61,35,20,0.1)' }}>Salvar e duplicar</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <CopiarDespesaModal
        open={copiarAberto}
        companyId={companyId}
        onClose={() => setCopiarAberto(false)}
        onUsar={(d) => {
          setFornecedorId(d.fornecedor_id ?? '')
          setFornecedorNome(d.fornecedor_nome ?? '')
          setDescricao(d.descricao ?? '')
          setValor(d.valor != null ? String(d.valor) : '')
          setCategoriaCodigo(d.categoria ?? '')
          setNumeroDocumento(d.numero_documento ?? '')
          setFormaPagamento(d.forma_pagamento || 'pix')
          setCopiarAberto(false)
        }}
      />
    </div>
  )
}

interface DespesaCopiavel {
  id: string
  fornecedor_id: string | null
  fornecedor_nome: string | null
  descricao: string | null
  valor: number | null
  categoria: string | null
  numero_documento: string | null
  forma_pagamento: string | null
}

function CopiarDespesaModal({ open, companyId, onClose, onUsar }: {
  open: boolean
  companyId: string
  onClose: () => void
  onUsar: (d: DespesaCopiavel) => void
}) {
  const [despesas, setDespesas] = useState<DespesaCopiavel[]>([])
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !companyId) return
    let ignore = false
    setLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('erp_pagar')
        .select('id, fornecedor_id, fornecedor_nome, descricao, valor, categoria, numero_documento, forma_pagamento, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (!ignore) {
        setDespesas((data ?? []) as DespesaCopiavel[])
        setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [open, companyId])

  if (!open) return null
  const q = busca.trim().toLowerCase()
  const filtradas = q
    ? despesas.filter((d) => `${d.descricao ?? ''} ${d.fornecedor_nome ?? ''} ${d.categoria ?? ''}`.toLowerCase().includes(q))
    : despesas

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FAF7F2', borderRadius: 12, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto', border: '1px solid #C8941A' }}>
        <div style={{ background: '#3D2314', color: '#FAF7F2', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 12, borderTopRightRadius: 12, position: 'sticky', top: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Copiar de outra despesa</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', color: '#FAF7F2', border: 'none', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 16 }}>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por descrição, fornecedor, categoria…"
            style={inputStyle}
          />
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading ? (
              <div style={{ color: 'rgba(61,35,20,0.55)', fontSize: 12, padding: 14, textAlign: 'center' }}>Carregando últimas 20 despesas…</div>
            ) : filtradas.length === 0 ? (
              <div style={{ color: 'rgba(61,35,20,0.55)', fontSize: 12, padding: 14, textAlign: 'center' }}>Nenhuma despesa encontrada.</div>
            ) : (
              filtradas.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onUsar(d)}
                  style={{ textAlign: 'left', background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.descricao || '(sem descrição)'}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
                      {d.fornecedor_nome ? `${d.fornecedor_nome} · ` : ''}{d.categoria ? `${d.categoria} · ` : ''}{d.forma_pagamento ?? ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#A32D2D', fontVariantNumeric: 'tabular-nums' }}>
                    R$ {Number(d.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function atalhoBtn(ativo: boolean): React.CSSProperties {
  return {
    background: ativo ? '#3D2314' : 'transparent',
    color: ativo ? '#FAF7F2' : '#3D2314',
    border: `0.5px solid ${ativo ? '#3D2314' : 'rgba(61,35,20,0.2)'}`,
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: ativo ? 'default' : 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }
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

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  padding: '10px 14px',
  fontSize: 13,
  color: '#3D2314',
  cursor: 'pointer',
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
