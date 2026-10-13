'use client'

import React, { useState, useEffect } from 'react'
import { FORMAS_PAGAMENTO, ehPix, normalizarChavePix, validarChavePix } from '@/lib/financeiro/formasPagamento'
import { CamposPix } from './CamposPix'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import CategoriaCombobox from './CategoriaCombobox'
import { parseBoletoBarras, codigoBarrasParaConsulta, reconhecerBoleto, validarCodigoBarrasEntrada } from '@/lib/financeiro/boleto-parser'
import { PSGC_COLORS } from '@/lib/psgc-tokens'
// RD-41 · padrão único de "erro de salvamento" (piloto)
import FeedbackSalvar from '@/components/ui/feedback/FeedbackSalvar'
import { Campo } from '@/components/ui/feedback/Campo'
import { useSalvar } from '@/components/ui/feedback/useSalvar'
import { estiloBordaInput } from '@/components/ui/feedback/contratoSalvar'
// #71 · modo edição: a mesma tela da inclusão abre o lançamento existente
import { useEdicaoLancamento, ReplicaParcelasDialog, SituacaoEdicao, type Campos } from './edicaoLancamento'

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
  // Cartão de crédito: ciclo de fatura (auto-data de pagamento ao lançar despesa no cartão).
  tipo_conta?: string | null
  dia_fechamento_fatura?: number | null
  dia_vencimento_fatura?: number | null
}

type DupConta = {
  id: string
  descricao: string | null
  valor: number | null
  vencimento: string | null
  status: string | null
  criado_em: string | null
}

type ContaExistente = {
  id: string
  descricao: string | null
  fornecedor_nome: string | null
  valor: number | null
  data_vencimento: string | null
  data_pagamento: string | null
  status: string | null
  numero_documento: string | null
  categoria: string | null
  forma_pagamento: string | null
  codigo_barras: string | null
  created_at: string | null
}

type DupLogica = {
  id: string
  descricao: string | null
  valor: number | null
  vencimento: string | null
  status: string | null
  numero_documento: string | null
  codigo_barras: string | null
  criado_em: string | null
}

interface NovaDespesaFormProps {
  companyId: string
  onSucesso?: (despesaId: string) => void
  onCancelar?: () => void
  // #71 · id de erp_pagar → a tela abre em modo EDIÇÃO (mesmos campos/listas da inclusão)
  editarId?: string
}

const exibirNomeFornecedor = (f: Fornecedor) =>
  f.nome_fantasia || f.razao_social || 'Sem nome'

// [→GE] Data de vencimento da fatura do cartão a partir da data da compra.
// Regra: compra até o dia de fechamento entra no ciclo que fecha neste mês; depois, no ciclo seguinte.
// O vencimento cai após o fechamento — mesmo mês se o dia de vencimento > fechamento, senão mês seguinte.
// Não recria janela financeira: só calcula a data que a despesa (contas a pagar da GE) vai usar.
function calcularVencimentoFatura(dataCompraISO: string, diaFechamento: number, diaVencimento: number): string {
  const [y, m, d] = dataCompraISO.split('-').map(Number)
  if (!y || !m || !d) return dataCompraISO
  let closeIdx = y * 12 + (m - 1)              // índice absoluto do mês da compra (0-based)
  if (d > diaFechamento) closeIdx += 1          // compra após o fechamento → próximo ciclo
  const vencIdx = closeIdx + (diaVencimento > diaFechamento ? 0 : 1)
  const vy = Math.floor(vencIdx / 12)
  const vm = vencIdx % 12                        // 0-based
  const ultimoDia = new Date(vy, vm + 1, 0).getDate()
  const dia = Math.min(diaVencimento, ultimoDia) // 31 em mês curto → último dia
  return `${vy}-${String(vm + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

export default function NovaDespesaForm({ companyId, onSucesso, onCancelar, editarId }: NovaDespesaFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editando = !!editarId
  const ed = useEdicaoLancamento('pagar', editarId, companyId)
  const [erroReplica, setErroReplica] = useState<string | null>(null)
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
  // Dia fixo de vencimento (1–31) · só faz sentido mensal/bimestral. Vazio = comportamento antigo.
  const [diaFixo, setDiaFixo] = useState('')
  // Prévia editável de parcelas (RD-41): o valor digitado pode ser o TOTAL da conta
  // (semeia total/N, última absorve o resto) ou o valor de CADA parcela (valor×N).
  // Ambos os campos por parcela são editáveis (valor/data variável).
  const [modoValor, setModoValor] = useState<'total' | 'parcela'>('total')
  const [parcelasEdit, setParcelasEdit] = useState<{ vencimento: string; valor: number }[]>([])
  const [categoriaCodigo, setCategoriaCodigo] = useState('')
  // 01/10 · centro de custo de verdade (erp_pagar.centro_custo_id). Cada obra do Hub tem o seu → liga a despesa à obra.
  const [centros, setCentros] = useState<{ id: string; nome: string }[]>([])
  const [centroCustoId, setCentroCustoId] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('pix')
  const [tipoChavePix, setTipoChavePix] = useState('cpf_cnpj')
  const [chavePix, setChavePix] = useState('')
  const [contaBancaria, setContaBancaria] = useState('')
  const [observacao, setObservacao] = useState('')
  // #71 · só na edição (ajustes do título): juros / multa / desconto
  const [juros, setJuros] = useState('')
  const [multa, setMulta] = useState('')
  const [desconto, setDesconto] = useState('')
  const [jaPago, setJaPago] = useState(false)
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().split('T')[0])
  // [→GE] Cartão de crédito: data da compra → vencimento da fatura calculado automaticamente.
  const [dataCompra, setDataCompra] = useState(new Date().toISOString().split('T')[0])
  // Fatia 3 estabilização nova-despesa (09/07): ⚡ conta com integração + salvar-dropdown
  const [contasAuto, setContasAuto] = useState<Set<string>>(new Set())
  const [salvarMenu, setSalvarMenu] = useState(false)
  const [copiarAberto, setCopiarAberto] = useState(false)

  // RD-41 piloto · padrão único de feedback. Erro → banner fixo (feedback) +
  // destaque vermelho no campo (erroCampo); sucesso → toast CRIOU/ALTEROU/EXCLUIU.
  const { salvar: rpcSalvar, salvando: loading, feedback, erroCampo, limpar: limparFeedback, setFeedback, setErroCampo } = useSalvar()
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])

  // ANTI-DUPLICIDADE (código de barras) — captura + alerta no REGISTRO (não bloqueia).
  const [codigoBarras, setCodigoBarras] = useState('')
  const [dupContas, setDupContas] = useState<DupConta[]>([])
  const [dupIgnorado, setDupIgnorado] = useState(false) // "é diferente — continuar"
  const [checandoDup, setChecandoDup] = useState(false)
  const dupTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // 🔑 leitor de código de barras "digita" rápido + Enter → onChange (debounce), onPaste (colar),
  // onBlur (sair do campo). Normaliza só dígitos e só consulta com ≥44 dígitos.
  const checarDup = React.useCallback(async (bruto: string) => {
    const dig = bruto.replace(/\D/g, '')
    if (dig.length < 44) { setDupContas([]); return }
    // canônico: linha digitável (47) vira os 44 do banco ANTES de consultar — senão nunca bate
    // com os 44 já salvos e a duplicidade passa batido (risco de pagar 2×). RD-26: mesma conversão do salvar.
    const cbConsulta = codigoBarrasParaConsulta(bruto) ?? dig
    setChecandoDup(true)
    try {
      const { data } = await supabase.rpc('fn_pagar_checar_duplicidade', {
        p_company_id: companyId, p_codigo_barras: cbConsulta, p_excluir_id: editarId ?? null,
      })
      setDupContas((data as DupConta[]) ?? [])
      setDupIgnorado(false)
    } finally {
      setChecandoDup(false)
    }
  }, [companyId, editarId])

  const onCodigoBarrasChange = (v: string) => {
    setCodigoBarras(v); setDupContas([]); setDupIgnorado(false)
    if (dupTimer.current) clearTimeout(dupTimer.current)
    dupTimer.current = setTimeout(() => { checarDup(v); autoPreencher(v) }, 400)
  }
  const checarDupAgora = () => {
    if (dupTimer.current) clearTimeout(dupTimer.current)
    checarDup(codigoBarras); autoPreencher(codigoBarras)
  }

  // AUTO-PREENCHIMENTO (Fase 1): valor + vencimento do BOLETO. Só campos VAZIOS,
  // nunca sobrescreve o que a pessoa digitou (RD-46: não fabrica dado ausente).
  const [vencimentoManual, setVencimentoManual] = useState(false)
  const [autoMsg, setAutoMsg] = useState<string | null>(null)
  const valorRef = React.useRef(valor)
  const vencManualRef = React.useRef(vencimentoManual)
  useEffect(() => { valorRef.current = valor }, [valor])
  useEffect(() => { vencManualRef.current = vencimentoManual }, [vencimentoManual])
  const autoPreencher = (bruto: string) => {
    const lido = parseBoletoBarras(bruto)
    if (!lido) return
    const feitos: string[] = []
    if (lido.valor != null && !(valorRef.current && valorRef.current.trim() !== '')) {
      setValor(String(lido.valor)); feitos.push('valor')
    }
    if (lido.vencimento && !vencManualRef.current) {
      setDataVencimento(lido.vencimento); feitos.push('vencimento')
    }
    setAutoMsg(feitos.length ? `Preenchemos ${feitos.join(' e ')} a partir do código de barras.` : null)
  }
  // CORREÇÃO 1: "Ver a conta existente" abre AQUELA conta num modal (não a lista genérica),
  // preservando o formulário em preenchimento.
  const [dupVer, setDupVer] = useState<ContaExistente | null>(null)
  const verConta = async (id: string) => {
    const { data } = await supabase
      .from('erp_pagar')
      .select('id, descricao, fornecedor_nome, valor, data_vencimento, data_pagamento, status, numero_documento, categoria, forma_pagamento, codigo_barras, created_at')
      .eq('id', id)
      .maybeSingle()
    if (data) setDupVer(data as ContaExistente)
  }

  // FASE F · chave lógica (fornecedor cadastrado + valor + vencimento EXATO). 🟡 leve, não bloqueia.
  const [dupLogica, setDupLogica] = useState<DupLogica[]>([])
  const [dupLogicaIgnorado, setDupLogicaIgnorado] = useState(false)
  // FASE E · log da decisão (reusa audit_log via RPC SECURITY DEFINER).
  const logDup = (tipo: 'codigo' | 'logico', decisao: 'cancelou' | 'continuou', detalhe: string) => {
    void supabase.rpc('fn_pagar_log_duplicidade', { p_tipo: tipo, p_decisao: decisao, p_detalhe: detalhe }).then(() => undefined)
  }
  // dispara quando fornecedor(existente) + valor + vencimento estão preenchidos (qualquer ordem).
  // 🔒 sem fornecedor_id → sem alerta. Suprimido quando o 🔴 (código idêntico) já aparece.
  useEffect(() => {
    if (dupContas.length > 0) { setDupLogica([]); return }
    const v = parseFloat(valor)
    if (!fornecedorId || !(v > 0) || !dataVencimento) { setDupLogica([]); return }
    let alive = true
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('fn_pagar_checar_duplicidade_logica', {
        p_company_id: companyId, p_fornecedor_id: fornecedorId, p_valor: v,
        p_vencimento: dataVencimento, p_codigo_barras: codigoBarrasParaConsulta(codigoBarras), p_excluir_id: editarId ?? null,
      })
      if (!alive) return
      setDupLogica((data as DupLogica[]) ?? []); setDupLogicaIgnorado(false)
    }, 500)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fornecedorId, valor, dataVencimento, codigoBarras, dupContas.length, companyId])

  // Semeia a prévia de parcelas quando N ≥ 2. Reseeda ao mudar N/valor/venc/
  // intervalo/modo (edições manuais valem enquanto esses inputs não mudam).
  useEffect(() => {
    if (parcelas < 2) { setParcelasEdit([]); return }
    const total = parseFloat(valor) || 0
    // Dia fixo só vale mensal (30) / bimestral (60) / trimestral (90); nos demais usa dias corridos.
    const usaDiaFixo = diaFixo !== '' && (intervaloDias === 30 || intervaloDias === 60 || intervaloDias === 90)
    const passoMeses = intervaloDias === 90 ? 3 : intervaloDias === 60 ? 2 : 1
    const rows: { vencimento: string; valor: number }[] = []
    for (let i = 0; i < parcelas; i++) {
      const venc = usaDiaFixo
        ? vencDiaFixo(dataVencimento, i, passoMeses, Number(diaFixo))
        : addDaysISO(dataVencimento, i * intervaloDias)
      const v = modoValor === 'total' ? round2(total / parcelas) : round2(total)
      rows.push({ vencimento: venc, valor: v })
    }
    if (modoValor === 'total' && parcelas > 0) {
      // última absorve o resto do arredondamento (mesma regra da v1)
      const somaAntes = round2(round2(total / parcelas) * (parcelas - 1))
      rows[parcelas - 1].valor = round2(total - somaAntes)
    }
    setParcelasEdit(rows)
  }, [parcelas, valor, dataVencimento, intervaloDias, modoValor, diaFixo])

  const editParcela = (idx: number, campo: 'vencimento' | 'valor', valorNovo: string) => {
    setParcelasEdit((prev) => prev.map((p, i) => i === idx
      ? { ...p, [campo]: campo === 'valor' ? (parseFloat(valorNovo) || 0) : valorNovo }
      : p))
  }
  const somaParcelas = parcelasEdit.reduce((s, p) => s + (Number(p.valor) || 0), 0)

  // Prefill via query (?valor=&data=&descricao=) — usado pelo fluxo Conciliacao
  // "Incluir nova conta" que envia os dados do movimento.
  useEffect(() => {
    if (!searchParams) return
    const v = searchParams.get('valor')
    const d = searchParams.get('data')
    const desc = searchParams.get('descricao')
    const cc = searchParams.get('centro_custo_id')
    if (cc && /^[0-9a-f-]{36}$/i.test(cc)) setCentroCustoId(cc)
    if (v && !valor) setValor(v)
    if (d && d.match(/^\d{4}-\d{2}-\d{2}$/)) setDataVencimento(d)
    if (desc && !descricao) setDescricao(desc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    if (!companyId) return
    let alive = true
    ;(async () => {
      const [forn, cats, bcs, prov, ccs] = await Promise.all([
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
          .select('id, nome, banco, tipo_conta, dia_fechamento_fatura, dia_vencimento_fatura')
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
        supabase
          .from('erp_centros_custo')
          .select('id, nome')
          .eq('company_id', companyId)
          .eq('ativo', true)
          .order('nome'),
      ])
      if (!alive) return
      setFornecedores((forn.data as Fornecedor[] | null) ?? [])
      setCategorias((cats.data as Categoria[] | null) ?? [])
      setContas((bcs.data as ContaBancaria[] | null) ?? [])
      setContasAuto(new Set(((prov.data as { banco_conta_id: string | null }[] | null) ?? [])
        .map((p) => p.banco_conta_id).filter((x): x is string => !!x)))
      setCentros((ccs.data as { id: string; nome: string }[] | null) ?? [])
    })()
    return () => {
      alive = false
    }
  }, [companyId])

  // [→GE] Conta selecionada (o select guarda o NOME) → se for cartão com ciclo definido,
  // a data de vencimento vira o vencimento da fatura do ciclo certo (editável).
  const contaSelecionada = contas.find((c) => c.nome === contaBancaria)
  const ehCartaoComFatura =
    contaSelecionada?.tipo_conta === 'cartao' &&
    contaSelecionada?.dia_fechamento_fatura != null &&
    contaSelecionada?.dia_vencimento_fatura != null
  const vencimentoFatura = ehCartaoComFatura
    ? calcularVencimentoFatura(dataCompra, contaSelecionada!.dia_fechamento_fatura!, contaSelecionada!.dia_vencimento_fatura!)
    : null

  useEffect(() => {
    // Só cartão de parcela única: preenche o vencimento com o da fatura (o usuário pode editar depois).
    if (vencimentoFatura && parcelas <= 1 && !editando) {
      setDataVencimento(vencimentoFatura)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vencimentoFatura, parcelas])

  // #71 · EDIÇÃO: preenche a tela com o título existente (mesmos campos da inclusão).
  const valoresDaLinha = (l: Record<string, unknown>) => ({
    fornecedorId: String(l.fornecedor_id ?? ''), fornecedorNome: String(l.fornecedor_nome ?? ''),
    descricao: String(l.descricao ?? ''), valor: l.valor == null ? '' : String(l.valor),
    dataVencimento: String(l.data_vencimento ?? ''), dataCompetencia: String(l.data_competencia ?? ''),
    categoriaCodigo: String(l.categoria ?? ''), centroCustoId: String(l.centro_custo_id ?? ''),
    numeroDocumento: String(l.numero_documento ?? ''),
    formaPagamento: String(l.forma_pagamento ?? ''), tipoChavePix: String(l.tipo_chave_pix ?? 'cpf_cnpj'),
    chavePix: String(l.chave_pix ?? ''), contaBancaria: String(l.conta_bancaria ?? ''),
    observacao: String(l.observacoes ?? ''), codigoBarras: String(l.codigo_barras ?? ''),
    juros: l.juros == null ? '' : String(l.juros), multa: l.multa == null ? '' : String(l.multa),
    desconto: l.desconto == null ? '' : String(l.desconto),
  })
  type ValoresDespesa = ReturnType<typeof valoresDaLinha>
  // Mesma função monta a BASE (linha carregada) e o ATUAL (tela) → o diff só pega o que a pessoa mudou.
  const camposEdicao = (v: ValoresDespesa): Campos => {
    const pix = ehPix(v.formaPagamento) && v.chavePix.trim()
    return {
      fornecedor_id: v.fornecedorId || null, fornecedor_nome: v.fornecedorNome || null,
      descricao: v.descricao, valor: v.valor, data_vencimento: v.dataVencimento,
      data_competencia: v.dataCompetencia || null, categoria: v.categoriaCodigo || null,
      centro_custo_id: v.centroCustoId || null,
      numero_documento: v.numeroDocumento || null, forma_pagamento: v.formaPagamento || null,
      tipo_chave_pix: pix ? v.tipoChavePix : null, chave_pix: pix ? normalizarChavePix(v.tipoChavePix, v.chavePix) : null,
      conta_bancaria: v.contaBancaria || null, observacoes: v.observacao || null, codigo_barras: v.codigoBarras.trim() || null,
      juros: v.juros || null, multa: v.multa || null, desconto: v.desconto || null,
    }
  }
  useEffect(() => {
    if (!ed.linha) return
    const v = valoresDaLinha(ed.linha)
    setFornecedorId(v.fornecedorId); setFornecedorNome(v.fornecedorNome); setDescricao(v.descricao)
    setValor(v.valor); setDataVencimento(v.dataVencimento); setDataCompetencia(v.dataCompetencia)
    setCategoriaCodigo(v.categoriaCodigo); setCentroCustoId(v.centroCustoId); setNumeroDocumento(v.numeroDocumento); setFormaPagamento(v.formaPagamento)
    setTipoChavePix(v.tipoChavePix); setChavePix(v.chavePix); setContaBancaria(v.contaBancaria)
    setObservacao(v.observacao); setCodigoBarras(v.codigoBarras); setJuros(v.juros); setMulta(v.multa); setDesconto(v.desconto)
    setVencimentoManual(true)   // código de barras não sobrescreve o vencimento do título
  }, [ed.linha])

  async function salvarEdicao() {
    if (!ed.linha || !editarId) return
    setToast(null); limparFeedback()
    if (!valor || parseFloat(valor) <= 0) { setErroCampo('valor'); setFeedback({ tipo: 'erro', texto: 'Faltou preencher: Valor' }); return }
    if (!dataVencimento) { setErroCampo('dataVencimento'); setFeedback({ tipo: 'erro', texto: 'Faltou preencher: Vencimento' }); return }
    const cbInput = codigoBarras.trim()
    if (cbInput && cbInput !== String(ed.linha.codigo_barras ?? '').trim()) {
      const vb = validarCodigoBarrasEntrada(cbInput)
      if (!vb.ok) { setErroCampo('codigoBarras'); setFeedback({ tipo: 'erro', texto: vb.motivo! }); return }
      if (vb.tipo === 'boleto' && vb.valorBoleto != null && Math.abs(vb.valorBoleto - (parseFloat(valor) || 0)) > 0.005) {
        setErroCampo('codigoBarras')
        setFeedback({ tipo: 'erro', texto: `O valor do boleto (${fmtBRL(vb.valorBoleto)}) diverge do valor informado (${fmtBRL(parseFloat(valor) || 0)}). Confira o código de barras.` })
        return
      }
    }
    if (ehPix(formaPagamento) && chavePix.trim()) {
      const eChave = validarChavePix(tipoChavePix, chavePix)
      if (eChave) { setErroCampo('chavePix'); setFeedback({ tipo: 'erro', texto: `Chave PIX: ${eChave}` }); return }
    }
    const fornecedorIdFinal = await garantirFornecedorId()
    const atual: ValoresDespesa = {
      fornecedorId: fornecedorIdFinal, fornecedorNome, descricao: descricao.trim() || montarDescricao(), valor, dataVencimento, dataCompetencia,
      categoriaCodigo, centroCustoId, numeroDocumento, formaPagamento, tipoChavePix, chavePix, contaBancaria, observacao, codigoBarras,
      juros, multa, desconto,
    }
    setSalvandoEdicao(true)
    const r = await ed.salvarEdicao(camposEdicao(valoresDaLinha(ed.linha)), camposEdicao(atual))
    setSalvandoEdicao(false)
    if (!r.ok) { setFeedback({ tipo: 'erro', texto: r.erro }); return }
    setEdicaoSalva(true)
  }
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)
  const [edicaoSalva, setEdicaoSalva] = useState(false)
  // Fecha a edição quando salvou e não há (mais) pergunta de réplica pendente.
  useEffect(() => {
    if (!edicaoSalva || ed.replica) return
    setEdicaoSalva(false)
    if (onSucesso && editarId) { onSucesso(editarId); return }
    setToast('ALTEROU a despesa')
    router.push('/dashboard/financeiro/pagar?area=gestao_empresarial')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edicaoSalva, ed.replica])

  // #43 · fornecedor DIGITADO ("Outro") vira cadastro de verdade: acha (CNPJ/nome) ou cria e devolve o id,
  // para aparecer na lista no próximo lançamento. Se o cadastro falhar, a despesa segue só com o nome (como antes).
  async function garantirFornecedorId(): Promise<string> {
    const nome = fornecedorNome.trim()
    if (fornecedorId || !nome) return fornecedorId
    const { data, error } = await supabase.rpc('fn_fornecedor_criar_inline', { p_company_id: companyId, p_nome: nome, p_cpf_cnpj: null })
    if (error || typeof data !== 'string') return ''
    setFornecedorId(data)
    setFornecedores((lista) => lista.some((f) => f.id === data) ? lista
      : [...lista, { id: data, nome_fantasia: nome, razao_social: nome, cpf_cnpj: null }]
        .sort((x, y) => exibirNomeFornecedor(x).localeCompare(exibirNomeFornecedor(y), 'pt-BR')))
    return data
  }

  // Descrição OPCIONAL (pedido Jordana/BPO): se vazia, geramos a partir de
  // fornecedor + categoria do DRE — a descrição identifica a conta na lista, nos
  // relatórios e no alerta anti-duplicidade ("[descrição]"), então nunca fica vazia.
  function montarDescricao(): string {
    const cat = categorias.find((c) => c.codigo === categoriaCodigo)?.descricao?.trim() || ''
    const partes = [fornecedorNome.trim(), cat].filter(Boolean)
    return (partes.join(' — ') || 'Despesa').slice(0, 200)
  }

  // Validação client-side no padrão RD-41: banner "Faltou preencher: X" +
  // destaque vermelho no campo. Retorna o campo a destacar + o texto do banner.
  function validarCampos(): { campo: string; banner: string } | null {
    if (!valor || parseFloat(valor) <= 0) return { campo: 'valor', banner: 'Faltou preencher: Valor' }
    if (!dataVencimento) return { campo: 'dataVencimento', banner: 'Faltou preencher: Vencimento' }
    if (parcelas < 1 || parcelas > 60) return { campo: 'parcelas', banner: 'Parcelas devem ficar entre 1 e 60' }
    return null
  }

  function limparForm() {
    setFornecedorId(''); setFornecedorNome(''); setDescricao(''); setValor('')
    setDataVencimento(new Date().toISOString().split('T')[0]); setDataCompetencia('')
    setParcelas(1); setIntervaloDias(30); setCategoriaCodigo(''); setCentroCustoId(''); setNumeroDocumento('')
    setObservacao(''); setJaPago(false); setContaBancaria('')
  }

  // modo: 'fechar' = comportamento padrão (redireciona/onSucesso);
  //       'nova' = salva e limpa o form pra lançar outra; 'duplicar' = salva e MANTÉM os
  //       valores pra lançar uma parecida. (Fatia 3 · "Salvar" dropdown estilo ContaAzul.)
  async function salvar(modo: 'fechar' | 'nova' | 'duplicar' = 'fechar') {
    setSalvarMenu(false)
    setToast(null)
    limparFeedback()

    // Validação client-side no padrão: banner + destaque no campo, antes da RPC.
    const faltou = validarCampos()
    if (faltou) { setErroCampo(faltou.campo); setFeedback({ tipo: 'erro', texto: faltou.banner }); return }

    // #123: "Já paguei" sem conta saía salvo EM ABERTO, em silêncio. Agora trava antes de criar.
    if (jaPago && !origemConciliacao && !editando && !contaSelecionada) {
      setErroCampo('contaBancaria')
      setFeedback({ tipo: 'erro', texto: 'Você marcou "já paguei": escolha em qual conta saiu o dinheiro.' })
      return
    }

    // SAFEGUARD do código de barras (RD-57 · RD-55): antes de criar, confere o DV do boleto informado
    // e, p/ boleto bancário de parcela única, se o valor embutido bate com o informado. Barras torto =
    // pagar errado (dinheiro de terceiro), então BLOQUEIA aqui — vira aviso imediato, não erro silencioso.
    const cbInput = codigoBarras.trim()
    if (cbInput) {
      const vb = validarCodigoBarrasEntrada(cbInput)
      if (!vb.ok) { setErroCampo('codigoBarras'); setFeedback({ tipo: 'erro', texto: vb.motivo! }); return }
      if (vb.tipo === 'boleto' && vb.valorBoleto != null && parcelas === 1 && Math.abs(vb.valorBoleto - (parseFloat(valor) || 0)) > 0.005) {
        setErroCampo('codigoBarras')
        setFeedback({ tipo: 'erro', texto: `O valor do boleto (${fmtBRL(vb.valorBoleto)}) diverge do valor informado (${fmtBRL(parseFloat(valor) || 0)}). Confira o código de barras.` })
        return
      }
    }

    // PIX: se informou a chave, ela precisa ser válida (senão a remessa é rejeitada pelo banco).
    if (ehPix(formaPagamento) && chavePix.trim()) {
      const eChave = validarChavePix(tipoChavePix, chavePix)
      if (eChave) { setErroCampo('chavePix'); setFeedback({ tipo: 'erro', texto: `Chave PIX: ${eChave}` }); return }
    }

    // se a pessoa digitou, respeita; se não, gera de fornecedor + categoria
    const descricaoFinal = descricao.trim() || montarDescricao()
    const hoje = new Date().toISOString().split('T')[0]
    const labelSucesso = parcelas >= 2 ? `${parcelas} parcelas · ${fmtBRL(somaParcelas)}` : fmtBRL(parseFloat(valor) || 0)
    const fornecedorIdFinal = await garantirFornecedorId()

    // useSalvar faz o cast do contrato, mapeia erro→mensagem+campo (banner + input
    // vermelho) e devolve o texto pronto de sucesso pro toast (CRIOU …).
    const ret = await rpcSalvar(
      async () => parcelas >= 2
        ? supabase.rpc('fn_pagar_criar_com_parcelas_v2', {
            p_company_id: companyId,
            p_fornecedor_id: fornecedorIdFinal || null,
            p_fornecedor_nome: fornecedorNome || null,
            p_descricao: descricaoFinal,
            p_data_emissao: hoje,
            p_categoria: categoriaCodigo || null,
            p_numero_documento: numeroDocumento || null,
            p_forma_pagamento: formaPagamento || null,
            p_observacao: observacao || null,
            p_conta_bancaria: contaBancaria || null,
            p_parcelas: parcelasEdit.map((p, idx) => ({
              n: idx + 1, data_vencimento: p.vencimento, valor: p.valor, data_competencia: null,
            })),
          })
        : supabase.rpc('fn_pagar_criar_com_parcelas', {
            p_company_id: companyId,
            p_fornecedor_id: fornecedorIdFinal || null,
            p_fornecedor_nome: fornecedorNome || null,
            p_descricao: descricaoFinal,
            p_valor_total: parseFloat(valor),
            p_data_emissao: hoje,
            p_data_primeiro_vencimento: dataVencimento,
            p_total_parcelas: parcelas,
            p_categoria: categoriaCodigo || null,
            p_numero_documento: numeroDocumento || null,
            p_forma_pagamento: formaPagamento || null,
            p_observacao: observacao || null,
            p_intervalo_dias: intervaloDias,
            p_conta_bancaria: contaBancaria || null,
          }),
      { acao: 'criar', label: labelSucesso },
    )
    if (!ret.sucesso) return // hook já exibiu banner + destaque de campo

    const ids = (ret as { ids?: string[] }).ids ?? []
    const dataCompFinal = dataCompetencia || dataVencimento
    if (ids.length > 0 && dataCompFinal) {
      await supabase.from('erp_pagar').update({ data_competencia: dataCompFinal }).in('id', ids)
    }

    // PIX: grava tipo+chave (normalizada) no título → flui pro item da remessa. Outras formas limpam o lixo.
    if (ids.length > 0) {
      const pix = ehPix(formaPagamento) && chavePix.trim()
      await supabase.from('erp_pagar').update({
        tipo_chave_pix: pix ? tipoChavePix : null,
        chave_pix: pix ? normalizarChavePix(tipoChavePix, chavePix) : null,
      }).in('id', ids)
    }

    // 01/10 · centro de custo / obra em todas as parcelas (o trigger confere a empresa e espelha o nome no texto)
    if (ids.length > 0 && centroCustoId) {
      const { error: eCc } = await supabase.from('erp_pagar').update({ centro_custo_id: centroCustoId }).in('id', ids)
      if (eCc) {
        setFeedback({ tipo: 'erro', texto: `Despesa CRIOU, mas o centro de custo NÃO foi gravado: ${eCc.message}. Edite a despesa e escolha de novo.` })
        return
      }
    }

    // VERBATIM (RD-57 · RD-55): grava o código de barras EXATAMENTE como o usuário informou, na 1ª
    // parcela — paridade total com o Editar. NUNCA converte/normaliza o campo gravado: fazer isso
    // reescrevia os dígitos digitados ("não mantinha o que a Jordana digita"). A forma canônica (44) é
    // derivada on-the-fly na GERAÇÃO da remessa (mapearRemessa*) e na CONSULTA anti-dup — sem tocar aqui.
    if (ids.length > 0 && cbInput) {
      await supabase.from('erp_pagar').update({ codigo_barras: cbInput }).eq('id', ids[0])
    }

    // Fluxo atomico (RD-38): quando vem da Conciliacao, a baixa e feita pelo
    // trigger trg_baixa_por_conciliacao — NUNCA chamar fn_pagar_baixar_pagamento
    // aqui, mesmo se o usuario tiver marcado "ja pago". Fonte unica da baixa.
    if (!origemConciliacao && jaPago && ids.length > 0 && contaSelecionada) {
      // Baixa apenas a 1a parcela · as demais ficam 'aberto'.
      // ids[0] eh a parcela 1/N (fn_pagar_criar_com_parcelas retorna na ordem).
      // #123: o select guarda o NOME da conta; a RPC quer o ID (uuid). Mandar o nome falhava
      // o cast em silêncio e a despesa ficava em aberto. Agora manda o id e confere o retorno.
      const primeiroId = ids[0]
      const { data: baixa, error: baixaErr } = await supabase.rpc('fn_pagar_baixar_pagamento', {
        p_pagar_id: primeiroId,
        p_data_pagamento: dataPagamento,
        p_conta_bancaria_id: contaSelecionada.id,
        p_forma_pagamento: (formaPagamento || 'PIX').toUpperCase(),
        p_valor_pago: null,
      })
      const baixaRet = baixa as { sucesso?: boolean; erro?: string } | null
      if (baixaErr || baixaRet?.sucesso === false) {
        setFeedback({
          tipo: 'erro',
          texto: `Despesa CRIOU, mas o pagamento NÃO foi registrado: ${baixaErr?.message || baixaRet?.erro || 'erro desconhecido'}. Marque como paga na lista.`,
        })
        return
      }
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
        setFeedback({ tipo: 'erro', texto: 'Despesa CRIOU, mas não CONCILIOU. Concilie manualmente no inbox de conciliação.' })
        return
      }
    }

    const primeiroId = ids[0]
    const msg = ret.mensagem ?? 'CRIOU a despesa'
    if (origemConciliacao) {
      // Volta pra Conciliacao (o movimento agora esta CONCILIADO) — fluxo sempre fecha.
      router.push('/dashboard/financeiro/conciliacao/inbox')
      return
    }
    // Fatia 3: "Salvar e nova" / "Salvar e duplicar" NÃO navegam — ficam no form.
    if (modo === 'nova') {
      limparForm()
      setToast(`${msg} · form limpo pra lançar outra`)
      return
    }
    if (modo === 'duplicar') {
      setToast(`${msg} · valores mantidos, ajuste e salve outra`)
      return
    }
    if (primeiroId && onSucesso) {
      onSucesso(primeiroId)
    } else {
      setToast(msg)
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
        <h1 style={{ fontSize: 24, color: '#3D2314', margin: 0, fontWeight: 500 }}>{editando ? 'Editar despesa' : 'Nova despesa'}</h1>
        <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>
          {editando ? 'Mesma tela da inclusão · as alterações ficam no histórico do lançamento' : 'Cadastre uma despesa nova · simples como uma nota fiscal'}
        </div>

        {!editando && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ ...atalhoBtn(true), pointerEvents: 'none' }}>🆕 Despesa nova</span>
          <button type="button" onClick={() => setCopiarAberto(true)} style={atalhoBtn(false)}>
            📋 Copiar de outra
          </button>
          <span title="Em breve: modelos de despesa" style={{ ...atalhoBtn(false), opacity: 0.45, cursor: 'not-allowed' }}>
            📌 Usar modelo
          </span>
        </div>
        )}
      </div>

      {editando && (ed.carregando || ed.erroCarga) ? (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '24px 28px', maxWidth: 720, fontSize: 13, color: ed.erroCarga ? PSGC_COLORS.alta : 'rgba(61,35,20,0.65)' }}>
          {ed.erroCarga ?? 'Carregando a despesa…'}
        </div>
      ) : (

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
          <Campo label="O que é essa despesa? (opcional)" fullWidth>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder='ex: "Aluguel sala maio" · vazio = geramos automático'
              style={inputStyle}
              maxLength={200}
            />
            <small style={helperStyle}>Deixe em branco pra usar o nome automático (fornecedor — categoria).</small>
          </Campo>

          <Campo label="Quanto custa?" obrigatorio erro={erroCampo === 'valor' ? 'Informe o valor' : null}>
            <input
              type="number"
              step="0.01"
              min="0"
              value={valor}
              onChange={(e) => { setValor(e.target.value); if (erroCampo === 'valor') limparFeedback() }}
              placeholder="0,00"
              data-testid="despesa-valor"
              disabled={editando && ed.baixado}
              style={{ ...inputStyle, ...estiloBordaInput(erroCampo === 'valor' ? 'x' : null), ...(editando && ed.baixado ? travadoStyle : {}) }}
            />
            <small style={helperStyle}>Em reais (R$)</small>
          </Campo>

          <Campo label="Quando vence?" obrigatorio erro={erroCampo === 'dataVencimento' ? 'Informe o vencimento' : null}>
            <input
              type="date"
              value={dataVencimento}
              onChange={(e) => { setDataVencimento(e.target.value); setVencimentoManual(true); if (erroCampo === 'dataVencimento') limparFeedback() }}
              disabled={editando && ed.baixado}
              style={{ ...inputStyle, ...estiloBordaInput(erroCampo === 'dataVencimento' ? 'x' : null), ...(editando && ed.baixado ? travadoStyle : {}) }}
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
                  data-testid="despesa-fornecedor-select"
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
                    data-testid="despesa-fornecedor-nome"
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                )}
                {!fornecedorId && fornecedorNome && (
                  <small style={helperStyle}>
                    Ao salvar, esse fornecedor fica cadastrado e aparece na lista nos próximos lançamentos.
                  </small>
                )}
              </>
            ) : (
              <>
                <input
                  value={fornecedorNome}
                  onChange={(e) => { setFornecedorNome(e.target.value); setFornecedorId('') }}
                  placeholder="Digite o nome do fornecedor"
                  data-testid="despesa-fornecedor-nome"
                  style={inputStyle}
                />
                <small style={helperStyle}>
                  Não está na lista? Digite o nome: ao salvar, o fornecedor fica cadastrado para os próximos lançamentos.
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

          <Campo label="Centro de custo / obra">
            <select
              data-testid="despesa-centro-custo"
              value={centroCustoId}
              onChange={(e) => setCentroCustoId(e.target.value)}
              style={inputStyle}
            >
              <option value="">— sem centro de custo —</option>
              {centroCustoId && !centros.some((c) => c.id === centroCustoId) && <option value={centroCustoId}>(centro atual)</option>}
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <small style={helperStyle}>
              Despesa de obra? Escolha a obra: o custo aparece na ficha da obra no Hub.
              {editando && !centroCustoId && String(ed.linha?.centro_custo ?? '').trim() !== '' && <> Hoje está só como texto: “{String(ed.linha?.centro_custo)}”.</>}
            </small>
          </Campo>

          {!editando && (
          <Campo label="Quantas parcelas?" erro={erroCampo === 'parcelas' ? 'Revise as parcelas' : null}>
            <input
              type="number"
              min="1"
              max="60"
              value={parcelas}
              onChange={(e) => { setParcelas(parseInt(e.target.value) || 1); if (erroCampo === 'parcelas') limparFeedback() }}
              style={{ ...inputStyle, ...estiloBordaInput(erroCampo === 'parcelas' ? 'x' : null) }}
            />
            <small style={helperStyle}>1 = pagamento à vista</small>
          </Campo>
          )}

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
                <option value="90">Trimestral (90 dias)</option>
              </select>
            </Campo>
          )}

          {parcelas > 1 && (intervaloDias === 30 || intervaloDias === 60 || intervaloDias === 90) && (
            <Campo label="Dia do vencimento (opcional)">
              <input
                type="number" min="1" max="31" inputMode="numeric"
                value={diaFixo}
                onChange={(e) => {
                  const n = e.target.value.replace(/\D/g, '')
                  if (n === '') { setDiaFixo(''); return }
                  const d = Math.min(31, Math.max(1, parseInt(n, 10)))
                  setDiaFixo(String(d))
                }}
                placeholder="ex.: 10"
                style={inputStyle}
              />
              <small style={helperStyle}>
                Fixa o dia (ex.: todo dia 10). Vazio = espaça por {intervaloDias} dias corridos. Mês sem o dia (31 em fev) → último dia do mês.
              </small>
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
                  <b style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(somaParcelas)}</b>
                </div>
              </div>

              {modoValor === 'total' && Math.abs(somaParcelas - (parseFloat(valor) || 0)) > 0.01 && (
                <div style={{ marginTop: 8, background: PSGC_COLORS.amareloSoft, border: `1px solid ${PSGC_COLORS.dourado}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#854F0B' }}>
                  A soma das parcelas difere do total informado ({fmtBRL(parseFloat(valor) || 0)}) — variação permitida.
                </div>
              )}
              <small style={helperStyle}>Ajuste vencimento e valor de cada parcela livremente (permite parcelas de valor/data variável).</small>
            </div>
          )}

          <Campo label="Como você vai pagar?">
            <select
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
              style={inputStyle}
            >
              {editando && formaPagamento && !FORMAS_PAGAMENTO.some((f) => f.v === formaPagamento) && (
                <option value={formaPagamento}>{formaPagamento} (atual)</option>
              )}
              {FORMAS_PAGAMENTO.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
            </select>
          </Campo>

          {ehPix(formaPagamento) && (
            <CamposPix tipoChave={tipoChavePix} chave={chavePix} setTipoChave={setTipoChavePix} setChave={setChavePix} inputStyle={inputStyle} />
          )}

          <Campo label="Em qual conta sai o dinheiro?" erro={erroCampo === 'contaBancaria' ? 'Escolha a conta do pagamento' : null}>
            <select
              data-testid="despesa-conta"
              value={contaBancaria}
              onChange={(e) => { setContaBancaria(e.target.value); if (erroCampo === 'contaBancaria') limparFeedback() }}
              disabled={editando && ed.comExtrato}
              style={{ ...inputStyle, ...estiloBordaInput(erroCampo === 'contaBancaria' ? 'x' : null), ...(editando && ed.comExtrato ? travadoStyle : {}) }}
            >
              <option value="">— escolher depois —</option>
              {editando && contaBancaria && !contas.some((c) => c.nome === contaBancaria) && (
                <option value={contaBancaria}>{contaBancaria} (atual)</option>
              )}
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

          {ehCartaoComFatura && parcelas <= 1 && !editando && (
            <Campo label="Data da compra (cartão)">
              <input
                type="date"
                value={dataCompra}
                onChange={(e) => setDataCompra(e.target.value)}
                style={inputStyle}
              />
              {vencimentoFatura && (
                <small style={{ ...helperStyle, color: '#3B6D11' }}>
                  💳 Entra na fatura que vence em <b>{fmtDataBr(vencimentoFatura)}</b> — já preenchemos o vencimento acima (editável).
                </small>
              )}
            </Campo>
          )}

          <Campo label="Número do documento (opcional)">
            <input
              value={numeroDocumento}
              onChange={(e) => setNumeroDocumento(e.target.value)}
              placeholder='ex: "NF 12345" · "Boleto 987"'
              style={inputStyle}
              maxLength={50}
            />
          </Campo>

          <Campo label="Código de barras (boleto ou guia)" fullWidth>
            <input
              value={codigoBarras}
              onChange={(e) => onCodigoBarrasChange(e.target.value)}
              onPaste={(e) => { const t = e.clipboardData.getData('text') || ''; setTimeout(() => { checarDup(t); autoPreencher(t) }, 0) }}
              onBlur={checarDupAgora}
              placeholder="Cole ou passe o leitor · boleto ou guia de imposto"
              style={inputStyle}
              inputMode="numeric"
            />
            <small style={helperStyle}>
              Opcional. Se preenchido, avisamos na hora se essa conta já foi lançada (não bloqueia){checandoDup ? ' · verificando…' : ''}.
            </small>
            {autoMsg && <small style={{ ...helperStyle, color: '#3B6D11' }}>⚡ {autoMsg} Tudo editável.</small>}
            {(() => {
              // Pilar 3 · transparência: confirma o que reconhecemos e mostra o formato CANÔNICO
              // (o mesmo que gravamos e que a checagem de duplicidade usa). Não inventa nada.
              const rb = reconhecerBoleto(codigoBarras)
              if (!rb.reconhecido) return null
              const rotulo = rb.tipo === 'boleto' ? 'Boleto bancário reconhecido' : 'Guia de arrecadação reconhecida'
              return (
                <div style={{ marginTop: 6, background: '#F1F6EC', border: '0.5px solid rgba(59,109,17,0.25)', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#3B6D11' }}>✓ {rotulo}</div>
                  {rb.linhaDigitavel && (
                    <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.7)', marginTop: 4 }}>
                      Linha digitável: <span style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: 0.3 }}>{rb.linhaDigitavel}</span>
                    </div>
                  )}
                  {rb.codigoBarras && (
                    <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.7)', marginTop: 2 }}>
                      Código de barras (44 díg): <span style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: 0.3 }}>{rb.codigoBarras}</span>
                    </div>
                  )}
                </div>
              )
            })()}
          </Campo>

          {dupContas.length > 0 && !dupIgnorado && (
            <div style={{ gridColumn: '1 / -1', background: PSGC_COLORS.vermelhoSoft, border: `1px solid ${PSGC_COLORS.alta}`, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: PSGC_COLORS.alta, marginBottom: 6 }}>
                🔴 Este código de barras já foi lançado
              </div>
              {dupContas.slice(0, 3).map((c) => (
                <div key={c.id} style={{ fontSize: 12, color: '#3D2314', marginBottom: 4 }}>
                  Em <b>{fmtDataBr(c.criado_em)}</b> como “<b>{c.descricao || 'sem descrição'}</b>”, <b>{fmtBRL(c.valor)}</b>, situação <b>{situacaoLabel(c.status)}</b>.
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => { const c0 = dupContas[0]; if (c0) void verConta(c0.id) }} style={dupBtnStyle('ver')}>Ver a conta existente</button>
                <button type="button" onClick={() => { logDup('codigo', 'cancelou', `existente=${dupContas[0]?.id ?? ''}`); setCodigoBarras(''); setDupContas([]); setDupIgnorado(false) }} style={dupBtnStyle('mesma')}>É a mesma — cancelar</button>
                <button type="button" onClick={() => { logDup('codigo', 'continuou', `existente=${dupContas[0]?.id ?? ''}`); setDupIgnorado(true) }} style={dupBtnStyle('diferente')}>É diferente — continuar</button>
              </div>
            </div>
          )}

          {dupLogica.length > 0 && !dupLogicaIgnorado && dupContas.length === 0 && (
            <div style={{ gridColumn: '1 / -1', background: PSGC_COLORS.amareloSoft, border: `1px solid ${PSGC_COLORS.dourado}`, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#854F0B', marginBottom: 6 }}>
                🟡 Já existe uma despesa parecida (mesmo fornecedor, valor e mês). É a mesma?
              </div>
              {dupLogica.slice(0, 3).map((c) => (
                <div key={c.id} style={{ fontSize: 12, color: '#3D2314', marginBottom: 4 }}>
                  “<b>{c.descricao || 'sem descrição'}</b>”, vence em <b>{c.vencimento ? fmtDataBr(c.vencimento) : '—'}</b>, doc <b>{c.numero_documento || '—'}</b>{c.codigo_barras ? ` · cód …${c.codigo_barras.slice(-6)}` : ''}, situação <b>{situacaoLabel(c.status)}</b> (lançada em {fmtDataBr(c.criado_em)}).
                </div>
              ))}
              <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.7)', marginTop: 2 }}>
                Esta: doc <b>{numeroDocumento || '—'}</b>{codigoBarras.replace(/\D/g, '').length >= 20 ? ` · cód …${codigoBarras.replace(/\D/g, '').slice(-6)}` : ''}.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => { const c0 = dupLogica[0]; if (c0) void verConta(c0.id) }} style={dupBtnStyle('ver')}>Ver a conta existente</button>
                <button type="button" onClick={() => { logDup('logico', 'cancelou', `existente=${dupLogica[0]?.id ?? ''}`); setDupLogica([]); setDupLogicaIgnorado(true) }} style={dupBtnStyle('mesma')}>É a mesma — cancelar</button>
                <button type="button" onClick={() => { logDup('logico', 'continuou', `existente=${dupLogica[0]?.id ?? ''}`); setDupLogicaIgnorado(true) }} style={dupBtnStyle('diferente')}>É diferente — continuar</button>
              </div>
            </div>
          )}

          <Campo label="Observação (opcional)" fullWidth>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Qualquer detalhe importante..."
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              maxLength={500}
            />
          </Campo>

          {editando && (
            <>
              <Campo label="Juros (R$)">
                <input type="number" step="0.01" min="0" value={juros} onChange={(e) => setJuros(e.target.value)} placeholder="0,00" style={inputStyle} />
              </Campo>
              <Campo label="Multa (R$)">
                <input type="number" step="0.01" min="0" value={multa} onChange={(e) => setMulta(e.target.value)} placeholder="0,00" style={inputStyle} />
              </Campo>
              <Campo label="Desconto (R$)">
                <input type="number" step="0.01" min="0" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" style={inputStyle} />
              </Campo>
            </>
          )}

          <div style={{ gridColumn: '1 / -1', borderTop: '0.5px solid rgba(61,35,20,0.12)', paddingTop: 12, marginTop: 4 }}>
            {editando && ed.linha ? (
              <SituacaoEdicao tipo="pagar" linha={ed.linha} baixado={ed.baixado} />
            ) : origemConciliacao ? (
              <div style={{ background: '#DCFCE7', color: '#166534', padding: '10px 12px', borderRadius: 8, fontSize: 12, border: '0.5px solid rgba(22,163,74,0.35)' }}>
                🔗 Esta despesa CRIOU a partir de um movimento do extrato bancário.
                Ao salvar, ela CONCILIA automaticamente com o movimento — a baixa é feita
                pelo sistema (não precisa marcar &quot;já paguei&quot;).
              </div>
            ) : (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#3D2314', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    data-testid="despesa-ja-paguei"
                    checked={jaPago}
                    onChange={(e) => setJaPago(e.target.checked)}
                  />
                  {parcelas > 1 ? 'Já paguei a 1ª parcela' : 'Já paguei essa despesa'}
                </label>
              </>
            )}
            {jaPago && !origemConciliacao && !editando && (
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
                  <small style={{ ...helperStyle, color: PSGC_COLORS.alta, gridColumn: '1 / -1' }}>
                    Selecione uma conta bancária acima pra registrar o pagamento.
                  </small>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Padrão RD-41 · erro de salvamento em banner fixo, mesmo ponto em toda tela.
            Sucesso não vem aqui — vira toast (ver fim do componente). */}
        <div style={{ marginTop: 18 }}>
          <FeedbackSalvar estado={feedback} />
        </div>

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
          {editando ? (
            <button
              type="button"
              data-testid="salvar-edicao"
              onClick={() => void salvarEdicao()}
              disabled={salvandoEdicao || !ed.linha}
              style={{
                background: PSGC_COLORS.dourado, color: '#3D2314', border: 'none',
                padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                cursor: salvandoEdicao ? 'wait' : 'pointer', opacity: salvandoEdicao ? 0.6 : 1,
              }}
            >
              {salvandoEdicao ? 'Salvando...' : 'Salvar alterações'}
            </button>
          ) : (
          /* Fatia 3: dropdown Salvar (Salvar / Salvar e nova / Salvar e duplicar) */
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              onClick={() => void salvar('fechar')}
              disabled={loading}
              style={{
                background: PSGC_COLORS.dourado, color: '#3D2314', border: 'none',
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
                background: PSGC_COLORS.dourado, color: '#3D2314', border: 'none',
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
          )}
        </div>
      </div>
      )}

      {ed.replica && (
        <ReplicaParcelasDialog
          replica={ed.replica}
          replicando={ed.replicando}
          erro={erroReplica}
          onEscolher={async (escopo) => { setErroReplica(await ed.aplicarReplica(escopo)) }}
          onSoEsta={() => { setErroReplica(null); ed.descartarReplica() }}
        />
      )}

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

      {dupVer && (
        <div onClick={() => setDupVer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFFFFF', borderRadius: 12, maxWidth: 480, width: '100%', border: `1px solid ${PSGC_COLORS.alta}`, overflow: 'hidden' }}>
            <div style={{ background: PSGC_COLORS.alta, color: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 14 }}>Conta já lançada com este código</b>
              <button onClick={() => setDupVer(null)} aria-label="Fechar" style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 8, fontSize: 13, color: '#3D2314' }}>
              <LinhaDet rotulo="Descrição" valor={dupVer.descricao || '—'} />
              <LinhaDet rotulo="Fornecedor" valor={dupVer.fornecedor_nome || '—'} />
              <LinhaDet rotulo="Valor" valor={fmtBRL(dupVer.valor)} />
              <LinhaDet rotulo="Vencimento" valor={fmtDataBr(dupVer.data_vencimento)} />
              <LinhaDet rotulo="Situação" valor={dupVer.status === 'pago' ? `paga em ${fmtDataBr(dupVer.data_pagamento)}` : 'em aberto'} />
              <LinhaDet rotulo="Categoria" valor={dupVer.categoria || '—'} />
              <LinhaDet rotulo="Nº documento" valor={dupVer.numero_documento || '—'} />
              <LinhaDet rotulo="Lançada em" valor={fmtDataBr(dupVer.created_at)} />
            </div>
            <div style={{ padding: '12px 16px', borderTop: '0.5px solid rgba(61,35,20,0.12)', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setDupVer(null)} style={{ background: PSGC_COLORS.dourado, color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Padrão RD-41 · sucesso vira toast (CRIOU/ALTEROU/EXCLUIU), some em ~4s. */}
      {toast && (
        <div
          role="status"
          onClick={() => setToast(null)}
          style={{
            position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
            background: PSGC_COLORS.espresso, color: PSGC_COLORS.offWhite,
            padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 1200,
            boxShadow: '0 8px 24px rgba(61,35,20,0.25)', cursor: 'pointer', maxWidth: '90vw',
            borderLeft: `3px solid ${PSGC_COLORS.dourado}`,
          }}
        >
          ✓ {toast}
        </div>
      )}
    </div>
  )
}

function LinhaDet({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '0.5px solid rgba(61,35,20,0.08)', paddingBottom: 4 }}>
      <span style={{ color: 'rgba(61,35,20,0.55)' }}>{rotulo}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{valor}</span>
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
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FAF7F2', borderRadius: 12, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto', border: `1px solid ${PSGC_COLORS.dourado}` }}>
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: PSGC_COLORS.alta, fontVariantNumeric: 'tabular-nums' }}>
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

// #71 · campo travado na edição de título já baixado (valor/vencimento/conta)
const travadoStyle: React.CSSProperties = { background: '#F3ECE0', color: 'rgba(61,35,20,0.6)', cursor: 'not-allowed' }
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

// Prévia de parcelas (RD-41)
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
function addDaysISO(iso: string, days: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date().toISOString().slice(0, 10)
  const d = new Date(base + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
// Vencimento no DIA FIXO: i-ésima parcela no dia `dia` do mês, a cada `passoMeses` meses a partir do
// mês da data base. 1ª parcela no mês corrente se `dia` >= dia da base; senão rola pro próximo mês.
// RD-51: mês sem o dia (31 em fev/abr…) → ÚLTIMO dia do mês (nunca gera data inválida).
function vencDiaFixo(iso: string, i: number, passoMeses: number, dia: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date().toISOString().slice(0, 10)
  const [by, bm, bd] = base.split('-').map(Number)
  let offset = i * passoMeses
  if (dia < bd) offset += 1
  const alvo = new Date(Date.UTC(by, (bm - 1) + offset, 1))          // 1º dia do mês alvo (normaliza ano)
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  const d = Math.min(Math.max(1, dia), ultimoDia)                    // clamp no último dia do mês
  return new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), d)).toISOString().slice(0, 10)
}
const cellHead: React.CSSProperties = { padding: '7px 10px', fontSize: 11, fontWeight: 600, color: 'rgba(61,35,20,0.6)' }
const cellBody: React.CSSProperties = { padding: '6px 10px', fontSize: 13, color: '#3D2314' }
const inputMini: React.CSSProperties = { width: '100%', padding: '6px 8px', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 5, fontSize: 13, background: '#FFFFFF', color: '#3D2314', fontFamily: 'inherit', boxSizing: 'border-box' }

// ANTI-DUPLICIDADE — helpers do alerta (linguagem do usuário, não "duplicate/SELECT").
function fmtDataBr(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('pt-BR') } catch { return '—' }
}
function fmtBRL(v: number | null): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function situacaoLabel(status: string | null): string {
  return status === 'pago' ? 'paga' : 'em aberto'
}
function dupBtnStyle(tipo: 'ver' | 'mesma' | 'diferente'): React.CSSProperties {
  const base: React.CSSProperties = { padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '0.5px solid rgba(61,35,20,0.25)' }
  if (tipo === 'mesma') return { ...base, background: PSGC_COLORS.alta, color: '#fff', border: 'none' }
  if (tipo === 'diferente') return { ...base, background: 'transparent', color: '#3D2314' }
  return { ...base, background: '#fff', color: '#3D2314' }
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

