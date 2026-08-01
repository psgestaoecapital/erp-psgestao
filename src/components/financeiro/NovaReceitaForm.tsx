'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import CategoriaCombobox from './CategoriaCombobox'
import Modal from '@/components/ui/Modal'
import ClienteForm, { type ClienteFormInitial } from '@/components/clientes/ClienteForm'

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

type CentroCusto = { id: string; nome: string }

interface NovaReceitaFormProps {
  companyId: string
  onSucesso?: (receitaId: string) => void
  onCancelar?: () => void
}

const exibirNomeCliente = (c: Cliente) =>
  c.nome_fantasia || c.razao_social || 'Sem nome'

export default function NovaReceitaForm({ companyId, onSucesso, onCancelar }: NovaReceitaFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Conciliacao: quando vem ?origem_conciliacao=<mov_id>, esta receita nasce
  // vinculada a um movimento do extrato. Fluxo atomico via
  // fn_conciliacao_aplicar_match -> trigger trg_baixa_por_conciliacao faz a baixa.
  const origemConciliacao = searchParams?.get('origem_conciliacao') ?? null

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [contas, setContas] = useState<ContaBancaria[]>([])
  const [centros, setCentros] = useState<CentroCusto[]>([])

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
  // Prévia editável de parcelas (RD-41 · espelho do #823): valor digitado = TOTAL
  // (total/N, última absorve resto) ou valor de CADA parcela (valor×N). Editável.
  const [modoValor, setModoValor] = useState<'total' | 'parcela'>('total')
  const [parcelasEdit, setParcelasEdit] = useState<{ vencimento: string; valor: number }[]>([])
  const [categoriaCodigo, setCategoriaCodigo] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [formaRecebimento, setFormaRecebimento] = useState('pix')
  const [contaBancaria, setContaBancaria] = useState('') // agora guarda o ID da conta (erp_banco_contas.id)
  const [centroCustoId, setCentroCustoId] = useState('')
  const [observacao, setObservacao] = useState('')
  const [jaRecebido, setJaRecebido] = useState(false)
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().split('T')[0])

  const [loading, setLoading] = useState(false)
  const [semPlano, setSemPlano] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dupWarn, setDupWarn] = useState(false)

  // Lote B — cliente inline: o cadastro de cliente abre COMO MODAL por cima da Nova Receita.
  // O form continua montado atrás (React não desmonta) → todo o estado digitado é preservado.
  const [clienteModal, setClienteModal] = useState<
    | null
    | { modo: 'novo' }
    | { modo: 'editar'; initial: ClienteFormInitial }
  >(null)
  const [toast, setToast] = useState<string | null>(null)

  // Recarrega a lista do seletor (mesma query do load inicial) e devolve os clientes atualizados,
  // pra podermos auto-selecionar o recém-criado/editado sem esperar o estado propagar.
  async function recarregarClientes(): Promise<Cliente[]> {
    const { data } = await supabase
      .from('erp_clientes')
      .select('id, nome_fantasia, razao_social, cpf_cnpj')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .order('nome_fantasia')
    const lista = (data as Cliente[] | null) ?? []
    setClientes(lista)
    return lista
  }

  // Abre o Modal de edição carregando o cadastro COMPLETO do cliente selecionado (RD-52: ClienteForm
  // é a fonte única — edita direto em erp_clientes, RLS por company). Nunca desmonta a Nova Receita.
  async function abrirEditarCliente() {
    if (!clienteId) return
    const { data, error } = await supabase
      .from('erp_clientes')
      .select('*')
      .eq('id', clienteId)
      .single()
    if (error || !data) {
      setToast('Não consegui abrir o cadastro do cliente.')
      return
    }
    setClienteModal({ modo: 'editar', initial: data as ClienteFormInitial })
  }

  // Pós-save (criar OU editar): recarrega o seletor, auto-seleciona o cliente, fecha o Modal
  // e mostra o toast. A Nova Receita reaparece com TODOS os campos intactos (nada foi desmontado).
  async function onClienteSalvo(cli: { id: string; nome: string }) {
    const modoAtual = clienteModal?.modo
    const lista = await recarregarClientes()
    const encontrado = lista.find((c) => c.id === cli.id)
    setClienteId(cli.id)
    setClienteNome(encontrado ? exibirNomeCliente(encontrado) : cli.nome)
    setClienteModal(null)
    setToast(`${modoAtual === 'editar' ? 'ALTEROU' : 'CRIOU'} cliente ${cli.nome || '—'}`)
  }

  // Semeia a prévia quando N ≥ 2. Reseeda ao mudar N/valor/recebimento/intervalo/modo.
  useEffect(() => {
    if (parcelas < 2) { setParcelasEdit([]); return }
    const total = parseFloat(valor) || 0
    const rows: { vencimento: string; valor: number }[] = []
    for (let i = 0; i < parcelas; i++) {
      const venc = addDaysISO(dataRecebimento, i * intervaloDias)
      const v = modoValor === 'total' ? round2(total / parcelas) : round2(total)
      rows.push({ vencimento: venc, valor: v })
    }
    if (modoValor === 'total' && parcelas > 0) {
      const somaAntes = round2(round2(total / parcelas) * (parcelas - 1))
      rows[parcelas - 1].valor = round2(total - somaAntes)
    }
    setParcelasEdit(rows)
  }, [parcelas, valor, dataRecebimento, intervaloDias, modoValor])

  const editParcela = (idx: number, campo: 'vencimento' | 'valor', valorNovo: string) => {
    setParcelasEdit((prev) => prev.map((p, i) => i === idx
      ? { ...p, [campo]: campo === 'valor' ? (parseFloat(valorNovo) || 0) : valorNovo }
      : p))
  }
  const somaParcelas = parcelasEdit.reduce((s, p) => s + (Number(p.valor) || 0), 0)

  // Prefill via query (?valor=&data=&descricao=) — fluxo Conciliacao "Incluir nova conta".
  useEffect(() => {
    if (!searchParams) return
    const v = searchParams.get('valor')
    const d = searchParams.get('data')
    const desc = searchParams.get('descricao')
    if (v && !valor) setValor(v)
    if (d && d.match(/^\d{4}-\d{2}-\d{2}$/)) setDataRecebimento(d)
    if (desc && !descricao) setDescricao(desc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    if (!companyId) return
    let alive = true
    ;(async () => {
      const [cli, cats, bcs, ccs] = await Promise.all([
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
        supabase
          .from('erp_centros_custo')
          .select('id, nome')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome'),
      ])
      if (!alive) return
      setClientes((cli.data as Cliente[] | null) ?? [])
      setCategorias((cats.data as Categoria[] | null) ?? [])
      setContas((bcs.data as ContaBancaria[] | null) ?? [])
      setCentros((ccs.data as CentroCusto[] | null) ?? [])
    })()
    return () => {
      alive = false
    }
  }, [companyId])

  // Toast some sozinho (UX). setTimeout no browser é OK.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  function validar(): string | null {
    // descrição é OPCIONAL (Jordana): se vazia, usamos um rótulo-fallback ao salvar.
    if (!valor || parseFloat(valor) <= 0) return 'Valor deve ser maior que zero'
    if (!dataRecebimento) return 'Quando entra na conta?'
    if (parcelas < 1 || parcelas > 60) return 'Parcelas entre 1 e 60'
    return null
  }

  async function salvar(forcar = false) {
    const erroValidacao = validar()
    if (erroValidacao) {
      setErro(erroValidacao)
      return
    }

    setLoading(true)
    setErro(null)
    setDupWarn(false)

    // descrição opcional (1a): fallback = cliente · competência quando vazia.
    const compRef = (dataCompetencia || dataRecebimento || '').slice(0, 7)
    const descricaoFinal = descricao.trim() || `${clienteNome || 'Receita'}${compRef ? ' · ' + compRef : ''}`
    // conta agora é ID; a coluna legada conta_bancaria (texto) recebe o NOME p/ compat/histórico.
    const nomeContaSel = contas.find((c) => c.id === contaBancaria)?.nome ?? null

    const hoje = new Date().toISOString().split('T')[0]
    // N ≥ 2 → v2 com o array editado (datas/valores por parcela). À vista → v1 (com trava de dup).
    const { data, error } = parcelas >= 2
      ? await supabase.rpc('fn_receber_criar_com_parcelas_v2', {
          p_company_id: companyId,
          p_cliente_id: clienteId || null,
          p_cliente_nome: clienteNome || null,
          p_descricao: descricaoFinal,
          p_data_emissao: hoje,
          p_categoria: categoriaCodigo || null,
          p_numero_documento: numeroDocumento || null,
          p_forma_recebimento: formaRecebimento || null,
          p_observacao: observacao || null,
          p_conta_bancaria: nomeContaSel,
          p_status_inicial: 'pendente',
          p_parcelas: parcelasEdit.map((p, idx) => ({
            n: idx + 1, data_vencimento: p.vencimento, valor: p.valor, data_competencia: null,
          })),
        })
      : await supabase.rpc('fn_receber_criar_com_parcelas', {
          p_company_id: companyId,
          p_cliente_id: clienteId || null,
          p_cliente_nome: clienteNome || null,
          p_descricao: descricaoFinal,
          p_valor_total: parseFloat(valor),
          p_data_emissao: hoje,
          p_data_primeiro_recebimento: dataRecebimento,
          p_total_parcelas: parcelas,
          p_categoria: categoriaCodigo || null,
          p_numero_documento: numeroDocumento || null,
          p_forma_recebimento: formaRecebimento || null,
          p_observacao: observacao || null,
          p_intervalo_dias: intervaloDias,
          p_status_inicial: 'pendente',
          p_conta_bancaria: nomeContaSel,
          p_forcar_dup: forcar,
        })

    if (error) {
      setLoading(false)
      // Trava de título duplicado (nossa): oferece "criar mesmo assim" em vez de erro cru.
      if (/idêntico|identico/i.test(error.message) || error.code === '23505') {
        setDupWarn(true)
      } else {
        setErro(error.message)
      }
      return
    }

    const resultado = data as {
      success?: boolean
      sucesso?: boolean
      sem_plano?: boolean
      erro?: string
      indice?: number
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

    if (resultado?.sucesso === false) {
      setLoading(false)
      setErro(
        resultado.erro === 'parcela_incompleta' ? `A parcela ${resultado.indice} está sem data ou valor.`
          : resultado.erro === 'sem_acesso' ? 'Você não tem permissão nesta empresa.'
          : 'Não foi possível salvar: ' + (resultado.erro ?? 'erro desconhecido'))
      return
    }

    const ids = resultado?.ids ?? []
    const dataCompFinal = dataCompetencia || dataRecebimento
    if (ids.length > 0) {
      // Persistir competência + FKs novas (conta/centro). Aditivo: a coluna texto legada já foi gravada pela RPC.
      const patch: Record<string, unknown> = {}
      if (dataCompFinal) patch.data_competencia = dataCompFinal
      if (contaBancaria) patch.conta_bancaria_id = contaBancaria
      if (centroCustoId) patch.centro_custo_id = centroCustoId
      if (Object.keys(patch).length) await supabase.from('erp_receber').update(patch).in('id', ids)
    }

    // Fluxo atomico (RD-38): quando vem da Conciliacao, a baixa e feita pelo
    // trigger trg_baixa_por_conciliacao — NUNCA chamar fn_receber_baixar_pagamento
    // aqui, mesmo com "ja recebido" marcado. Fonte unica da baixa.
    if (!origemConciliacao && jaRecebido && ids.length > 0 && contaBancaria) {
      // Baixa apenas a 1a parcela · as demais ficam 'aberto'.
      // ids[0] eh a parcela 1/N (fn_receber_criar_com_parcelas retorna na ordem).
      const primeiroId = ids[0]
      await supabase.rpc('fn_receber_baixar_pagamento', {
        p_receber_id: primeiroId,
        p_data_pagamento: dataPagamento,
        p_conta_bancaria_id: contaBancaria,
        p_forma_pagamento: (formaRecebimento || 'PIX').toUpperCase(),
        p_valor_pago: null,
      })
    }

    // Vincula ao movimento do extrato -> trigger dispara a baixa canonica.
    if (origemConciliacao && ids.length > 0) {
      const primeiroId = ids[0]
      const { data: { user } } = await supabase.auth.getUser()
      const { error: matchErr } = await supabase.rpc('fn_conciliacao_aplicar_match', {
        p_movimento_id: origemConciliacao,
        p_lancamento_tabela: 'erp_receber',
        p_lancamento_id: primeiroId,
        p_operador_id: user?.id ?? null,
        p_origem: 'novo_lancamento',
      })
      if (matchErr) {
        setLoading(false)
        setErro('Receita CRIOU mas nao CONCILIOU: ' + matchErr.message)
        return
      }
    }

    setLoading(false)

    const primeiroId = ids[0]
    if (origemConciliacao) {
      router.push('/dashboard/financeiro/conciliacao/inbox')
      return
    }
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
          <Campo label="O que é essa receita? (opcional)" fullWidth>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder='opcional · ex: "Mensalidade cliente X · maio" · "Venda 200 unidades"'
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
              <select
                value={clienteId}
                onChange={(e) => {
                  setClienteId(e.target.value)
                  const c = clientes.find((x) => x.id === e.target.value)
                  setClienteNome(c ? exibirNomeCliente(c) : '')
                }}
                style={{ ...inputStyle, flex: '1 1 180px', minWidth: 0 }}
              >
                <option value="">— sem cliente cadastrado —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {exibirNomeCliente(c)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setClienteModal({ modo: 'novo' })}
                style={clienteBtnStyle}
                title="Cadastrar um cliente novo sem sair desta receita"
              >
                + Novo cliente
              </button>
              <button
                type="button"
                onClick={abrirEditarCliente}
                disabled={!clienteId}
                style={{ ...clienteBtnStyle, opacity: clienteId ? 1 : 0.45, cursor: clienteId ? 'pointer' : 'not-allowed' }}
                title={clienteId ? 'Editar o cadastro do cliente selecionado' : 'Selecione um cliente para editar'}
              >
                ✎ Editar
              </button>
            </div>
            {clientes.length === 0 && (
              <small style={{ ...helperStyle, color: '#854F0B' }}>
                Você ainda não tem clientes · use “+ Novo cliente” — o form desta receita fica salvo.
              </small>
            )}
          </Campo>

          <Campo label="Em qual categoria do DRE?">
            {/* FASE-1 CATEGORIAS (07/07): combobox digitavel + criar inline. */}
            <CategoriaCombobox
              companyId={companyId}
              aplicacao="receber"
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

          {parcelas >= 2 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', fontWeight: 500 }}>O valor informado é:</span>
                <div style={{ display: 'inline-flex', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, overflow: 'hidden' }}>
                  {([['total', 'Total da conta'], ['parcela', 'Valor de cada parcela']] as const).map(([m, rot]) => (
                    <button key={m} type="button" onClick={() => setModoValor(m)}
                      style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: modoValor === m ? '#3D2314' : 'transparent', color: modoValor === m ? '#FAF7F2' : '#3D2314' }}>
                      {rot}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr', background: '#F3ECE0' }}>
                  <div style={cellHead}>Nº</div>
                  <div style={cellHead}>Vencimento</div>
                  <div style={cellHead}>Valor (R$)</div>
                </div>
                {parcelasEdit.map((p, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr', borderTop: '0.5px solid rgba(61,35,20,0.1)', alignItems: 'center' }}>
                    <div style={{ ...cellBody, fontWeight: 600 }}>{idx + 1}/{parcelas}</div>
                    <div style={cellBody}>
                      <input type="date" value={p.vencimento} onChange={(e) => editParcela(idx, 'vencimento', e.target.value)} style={inputMini} />
                    </div>
                    <div style={cellBody}>
                      <input type="number" step="0.01" min="0" value={p.valor} onChange={(e) => editParcela(idx, 'valor', e.target.value)} style={inputMini} />
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: '0.5px solid rgba(61,35,20,0.15)', background: '#FAF7F2' }}>
                  <span style={{ fontSize: 12, color: 'rgba(61,35,20,0.6)' }}>Soma das parcelas</span>
                  <b style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{brl(somaParcelas)}</b>
                </div>
              </div>

              {modoValor === 'total' && Math.abs(somaParcelas - (parseFloat(valor) || 0)) > 0.01 && (
                <div style={{ marginTop: 8, background: '#FEF6E0', border: '1px solid #C8941A', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#854F0B' }}>
                  A soma das parcelas difere do total informado ({brl(parseFloat(valor) || 0)}) — variação permitida.
                </div>
              )}
              <small style={helperStyle}>Ajuste vencimento e valor de cada parcela livremente (permite parcelas de valor/data variável).</small>
            </div>
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
                <option key={c.id} value={c.id}>
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

          <Campo label="Centro de custo (opcional)">
            <select
              value={centroCustoId}
              onChange={(e) => setCentroCustoId(e.target.value)}
              style={inputStyle}
            >
              <option value="">— sem centro de custo —</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            {centros.length === 0 && (
              <small style={{ ...helperStyle, color: '#854F0B' }}>
                Nenhum centro de custo · <a href="/dashboard/gestao-empresarial/centros-custo" style={{ color: '#C8941A' }}>cadastrar</a>
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
            {origemConciliacao ? (
              <div style={{ background: '#DCFCE7', color: '#166534', padding: '10px 12px', borderRadius: 8, fontSize: 12, border: '0.5px solid rgba(22,163,74,0.35)' }}>
                🔗 Esta receita CRIOU a partir de um movimento do extrato bancário.
                Ao salvar, ela CONCILIA automaticamente com o movimento — a baixa é feita
                pelo sistema (não precisa marcar &quot;já recebi&quot;).
              </div>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#3D2314', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={jaRecebido}
                  onChange={(e) => setJaRecebido(e.target.checked)}
                />
                {parcelas > 1 ? 'Já recebi a 1ª parcela' : 'Já recebi essa receita'}
              </label>
            )}
            {jaRecebido && !origemConciliacao && (
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
            onClick={() => salvar()}
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

      {dupWarn && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 440, width: '100%', border: '1px solid #E7DED3' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#3D2314', marginBottom: 8 }}>Título parecido já existe</div>
            <div style={{ fontSize: 13, color: '#6b5444', lineHeight: 1.5, marginBottom: 16 }}>
              Já existe um título igual: <strong style={{ color: '#3D2314' }}>{descricao.trim() || '—'}</strong> · R$ {parseFloat(valor || '0').toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · venc {dataRecebimento ? dataRecebimento.split('-').reverse().join('/') : '—'}. Isso costuma ser duplicidade. Deseja criar mesmo assim?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDupWarn(false)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #E7DED3', background: '#fff', color: '#3D2314', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => salvar(true)} disabled={loading} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#C8941A', color: '#fff', fontWeight: 600, fontSize: 13, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1 }}>Criar mesmo assim</button>
            </div>
          </div>
        </div>
      )}

      {/* Lote B — Modal de cliente SOBRE a Nova Receita. O form desta tela continua montado atrás,
          então valor/competência/descrição/conta etc. permanecem intactos ao abrir/salvar/cancelar. */}
      <Modal
        open={clienteModal !== null}
        onClose={() => setClienteModal(null)}
        title={clienteModal?.modo === 'editar' ? 'Editar cliente' : 'Novo cliente'}
        subtitle="O que você já preencheu na receita fica guardado."
        maxWidth={880}
      >
        {clienteModal && (
          <ClienteForm
            companyId={companyId}
            hideHeader
            initial={clienteModal.modo === 'editar' ? clienteModal.initial : null}
            onSaved={onClienteSalvo}
            onCancel={() => setClienteModal(null)}
          />
        )}
      </Modal>

      {toast && (
        <div
          role="status"
          onClick={() => setToast(null)}
          style={{
            position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
            background: '#3D2314', color: '#FAF7F2', padding: '10px 18px', borderRadius: 8,
            fontSize: 13, fontWeight: 500, zIndex: 1100, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            cursor: 'pointer', maxWidth: '90vw',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

const clienteBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  padding: '0 12px',
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
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

// Prévia de parcelas (RD-41 · espelho do #823)
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const brl = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
function addDaysISO(iso: string, days: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date().toISOString().slice(0, 10)
  const d = new Date(base + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const cellHead: React.CSSProperties = { padding: '7px 10px', fontSize: 11, fontWeight: 600, color: 'rgba(61,35,20,0.6)' }
const cellBody: React.CSSProperties = { padding: '6px 10px', fontSize: 13, color: '#3D2314' }
const inputMini: React.CSSProperties = { width: '100%', padding: '6px 8px', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 5, fontSize: 13, background: '#FFFFFF', color: '#3D2314', fontFamily: 'inherit', boxSizing: 'border-box' }

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
