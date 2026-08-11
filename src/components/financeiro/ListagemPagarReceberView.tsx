'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import MarcarPagoModal from './MarcarPagoModal'
import MarcarPagoLoteModal from './MarcarPagoLoteModal'
import EmitirNFSeButton from './EmitirNFSeButton'
import EmitirNFeButton from './EmitirNFeButton'
import GerarBoletoButton from './GerarBoletoButton'
import BoletoActions, { type ClienteContato, type BoletoEstado } from './BoletoActions'

const SEM_CONTA = '— sem conta informada —' // 3b: chip de filtro p/ lançamentos sem conta bancária
import ConciliarTituloModal from './ConciliarTituloModal'
import EditarLancamentoModal from './EditarLancamentoModal'
import HistoricoLancamentoModal from './HistoricoLancamentoModal'
import HistoricoGlobalModal from './HistoricoGlobalModal'
import ExportarListaButton from './ExportarListaButton'
import { FORMAS_PAGAMENTO } from '@/lib/financeiro/formasPagamento'

// Campos liberados na edição em massa (Jordana #6) — todos na whitelist do fn_*_editar_completo.
const CAMPOS_MASSA = [
  { v: 'valor', l: 'Valor (R$)', tipo: 'num' as const },
  { v: 'data_vencimento', l: 'Vencimento', tipo: 'date' as const },
  { v: 'categoria', l: 'Categoria / Conta DRE', tipo: 'text' as const },
  { v: 'linha_negocio', l: 'Linha de negócio', tipo: 'text' as const },
  { v: 'data_competencia', l: 'Competência', tipo: 'date' as const },
  { v: 'forma_pagamento', l: 'Forma de pagamento', tipo: 'select' as const },
]

type Tipo = 'pagar' | 'receber'

type Situacao = 'pago' | 'vencido' | 'hoje' | 'a_vencer'

type Resultado = {
  id: string
  descricao: string
  nome_pessoa: string | null
  categoria: string | null
  valor_documento: number
  valor_pago: number | null
  data_vencimento: string
  data_pagamento: string | null
  status: string
  situacao: Situacao
  numero_documento: string | null
  forma_pagamento: string | null
  parcela: string | null
  observacoes: string | null
  documento: string | null   // RD-41 · CPF/CNPJ do cliente/fornecedor (do cadastro) p/ busca
}

type KpiBlock = { valor: number; qtd: number }

type Resposta = {
  sem_plano?: boolean
  tipo: Tipo
  periodo: { data_inicio: string; data_fim: string }
  kpis: {
    vencidos: KpiBlock
    hoje: KpiBlock
    avencer: KpiBlock
    pagos: KpiBlock
    total: number
  }
  resultados: Resultado[]
}

const PAGE_SIZE = 20

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

// RD-41 · busca ampla: normaliza acento + caixa p/ match acento-insensitive.
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
// aceita "1.234,56" ou "1234.56" ou "1234" → número (null se vazio/inválido).
const parseValorBR = (s: string): number | null => {
  const t = s.trim(); if (!t) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const fmtData = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const CORES_SITUACAO: Record<Situacao, string> = {
  vencido: '#DC2626',
  hoje: '#C8941A',
  a_vencer: '#3D2314',
  pago: '#16A34A',
}

type PeriodoChoice = 'mes_atual' | 'mes_passado' | 'ano_atual' | 'personalizado'

interface Props {
  companyId: string
  tipo: Tipo
}

export default function ListagemPagarReceberView({ companyId, tipo }: Props) {
  const labels = useMemo(() => labelsPorTipo(tipo), [tipo])

  const hoje = new Date()
  const toISO = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const inicioMesAtual = () => toISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const fimMesAtual = () => toISO(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0))
  const [dataInicio, setDataInicio] = useState<string>(inicioMesAtual())
  const [dataFim, setDataFim] = useState<string>(fimMesAtual())
  const [pagandoItem, setPagandoItem] = useState<Resultado | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  // Ações em massa (RD-41 · só despesas): alterar valor / excluir em lote.
  const [massaValorAberto, setMassaValorAberto] = useState(false)
  const [massaExcluirAberto, setMassaExcluirAberto] = useState(false)
  const [massaNovoValor, setMassaNovoValor] = useState('')
  const [massaCampo, setMassaCampo] = useState('valor')
  const [massaBusy, setMassaBusy] = useState(false)
  const [massaMsg, setMassaMsg] = useState<string | null>(null)
  const [loteAberto, setLoteAberto] = useState(false)
  const [periodoChoice, setPeriodoChoice] = useState<PeriodoChoice>('mes_atual')
  const [statusFiltro, setStatusFiltro] = useState<'todos' | 'avencer' | 'vencidos' | 'pagos' | 'hoje'>('todos')
  const [categoria, setCategoria] = useState('')
  const [busca, setBusca] = useState('')
  // RD-41 · filtros por coluna (client-side, sobre as linhas já carregadas do período)
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [fPessoa, setFPessoa] = useState('')
  const [fValorMin, setFValorMin] = useState('')
  const [fValorMax, setFValorMax] = useState('')
  const [fForma, setFForma] = useState('')
  const [page, setPage] = useState(1)

  const [data, setData] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(false)
  const [sincLiqBusy, setSincLiqBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [nfseMap, setNfseMap] = useState<Record<string, 'autorizada' | 'processando' | 'rejeitada' | 'cancelada'>>({})
  const [nfseDocMap, setNfseDocMap] = useState<Record<string, { pdf?: string | null; xml?: string | null; notaId?: string }>>({})
  const [nfeMap, setNfeMap] = useState<Record<string, 'autorizada' | 'processando' | 'rejeitada' | 'cancelada' | 'denegada'>>({})
  const [boletoMap, setBoletoMap] = useState<Record<string, BoletoEstado>>({})
  const [clientesMap, setClientesMap] = useState<Record<string, ClienteContato>>({})
  const [provider, setProvider] = useState<'sicoob' | 'sicredi' | 'bradesco' | null>(null)
  const [empresaCnpj, setEmpresaCnpj] = useState<string | null>(null)
  const [capExtrato, setCapExtrato] = useState(false)
  const [conciliandoItem, setConciliandoItem] = useState<Resultado | null>(null)
  const [editandoItem, setEditandoItem] = useState<Resultado | null>(null)
  const [historicoItem, setHistoricoItem] = useState<Resultado | null>(null)
  const [historicoGlobalAberto, setHistoricoGlobalAberto] = useState(false)
  // Camada1/Fatia2 estabilizacao contas a pagar (08/07):
  const [pagSort, setPagSort] = useState<'off' | 'asc' | 'desc'>('off')   // item 1: coluna Pagamento ordenavel
  const [contaMap, setContaMap] = useState<Record<string, string>>({})     // item 3: id -> conta bancaria (texto)
  const [contasSel, setContasSel] = useState<Set<string>>(new Set())

  // cap_extrato: sabe se a empresa tem integracao de extrato bancario ativa.
  // Habilita o botao "Conciliar" tanto em Contas a Pagar quanto Receber.
  useEffect(() => {
    if (!companyId) { setCapExtrato(false); return }
    let alive = true
    supabase
      .from('erp_banco_provider_config')
      .select('id')
      .eq('company_id', companyId)
      .eq('ativo', true)
      .eq('cap_extrato', true)
      .limit(1)
      .then(({ data }) => {
        if (!alive) return
        setCapExtrato((data ?? []).length > 0)
      })
    return () => { alive = false }
  }, [companyId, reloadKey])

  useEffect(() => {
    if (!companyId || tipo !== 'receber') {
      setNfseMap({})
      setNfeMap({})
      setBoletoMap({})
      setClientesMap({})
      setProvider(null)
      setEmpresaCnpj(null)
      return
    }
    let alive = true
    Promise.all([
      supabase
        .from('erp_nfse_emitidas')
        .select('id, erp_receber_id, status, pdf_url, xml_url')
        .eq('company_id', companyId)
        .not('erp_receber_id', 'is', null),
      supabase
        .from('erp_nfe_emitidas')
        .select('erp_receber_id, status')
        .eq('company_id', companyId)
        .not('erp_receber_id', 'is', null),
      supabase
        .from('erp_receber')
        .select('id, cliente_id, boleto_status, boleto_nosso_numero, boleto_linha_digitavel, boleto_qr_code, boleto_url')
        .eq('company_id', companyId),
      supabase
        .from('erp_banco_provider_config')
        .select('provider')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .eq('cap_boleto', true)
        .limit(1),
      supabase
        .from('companies')
        .select('cnpj')
        .eq('id', companyId)
        .maybeSingle(),
    ]).then(async ([nfseRes, nfeRes, boletoRes, provRes, compRes]) => {
      if (!alive) return
      const nfseMapNew: Record<string, 'autorizada' | 'processando' | 'rejeitada' | 'cancelada'> = {}
      const nfseDocMapNew: Record<string, { pdf?: string | null; xml?: string | null; notaId?: string }> = {}
      for (const row of nfseRes.data ?? []) {
        if (!row.erp_receber_id) continue
        if (nfseMapNew[row.erp_receber_id] === 'autorizada') continue
        nfseMapNew[row.erp_receber_id] = row.status
        if (row.status === 'autorizada') nfseDocMapNew[row.erp_receber_id] = { pdf: row.pdf_url, xml: row.xml_url, notaId: row.id }
      }
      setNfseMap(nfseMapNew)
      setNfseDocMap(nfseDocMapNew)

      const nfeMapNew: Record<string, 'autorizada' | 'processando' | 'rejeitada' | 'cancelada' | 'denegada'> = {}
      for (const row of nfeRes.data ?? []) {
        if (!row.erp_receber_id) continue
        if (nfeMapNew[row.erp_receber_id] === 'autorizada') continue
        nfeMapNew[row.erp_receber_id] = row.status
      }
      setNfeMap(nfeMapNew)

      const boletoMapNew: Record<string, BoletoEstado> = {}
      const clienteIds = new Set<string>()
      type BoletoRow = {
        id: string; cliente_id: string | null
        boleto_status: string | null; boleto_nosso_numero: string | null
        boleto_linha_digitavel: string | null; boleto_qr_code: string | null
        boleto_url: string | null
      }
      const recebMap: Record<string, BoletoRow> = {}
      for (const row of (boletoRes.data ?? []) as BoletoRow[]) {
        recebMap[row.id] = row
        if (row.cliente_id) clienteIds.add(row.cliente_id)
        boletoMapNew[row.id] = {
          status: row.boleto_status,
          nossoNumero: row.boleto_nosso_numero,
          linhaDigitavel: row.boleto_linha_digitavel,
          qrCode: row.boleto_qr_code,
          url: row.boleto_url,
        }
      }
      setBoletoMap(boletoMapNew)

      const provNorm = ((provRes.data?.[0]?.provider ?? '').toLowerCase()) as string
      if (alive) setProvider(provNorm === 'sicoob' || provNorm === 'sicredi' || provNorm === 'bradesco' ? (provNorm as 'sicoob' | 'sicredi' | 'bradesco') : null)
      if (alive) setEmpresaCnpj((compRes.data as { cnpj?: string | null } | null)?.cnpj ?? null)

      if (clienteIds.size > 0) {
        const { data: clis } = await supabase
          .from('erp_clientes')
          .select('id, cpf_cnpj, cnpj_cpf, razao_social, nome_fantasia, cep, logradouro, bairro, cidade, uf, whatsapp, celular, telefone')
          .in('id', Array.from(clienteIds))
        if (alive) {
          const ciMap: Record<string, ClienteContato> = {}
          for (const c of (clis ?? []) as Array<{
            id: string; cpf_cnpj: string | null; cnpj_cpf: string | null
            razao_social: string | null; nome_fantasia: string | null
            cep: string | null; logradouro: string | null; bairro: string | null
            cidade: string | null; uf: string | null
            whatsapp: string | null; celular: string | null; telefone: string | null
          }>) {
            ciMap[c.id] = {
              cpfCnpj: c.cpf_cnpj ?? c.cnpj_cpf ?? null,
              cep: c.cep, logradouro: c.logradouro, bairro: c.bairro,
              cidade: c.cidade, uf: c.uf,
              whatsapp: c.whatsapp, celular: c.celular, telefone: c.telefone,
              nome: c.razao_social ?? c.nome_fantasia,
            }
          }
          // monta por receber_id
          const porReceber: Record<string, ClienteContato> = {}
          for (const [recId, row] of Object.entries(recebMap)) {
            if (row.cliente_id && ciMap[row.cliente_id]) porReceber[recId] = ciMap[row.cliente_id]
          }
          setClientesMap(porReceber)
        }
      } else if (alive) {
        setClientesMap({})
      }
    })
    return () => { alive = false }
  }, [companyId, tipo, reloadKey])

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setLoading(true)
    setErro(null)
    supabase
      .rpc('fn_ge_listagem_v2', {
        p_company_id: companyId,
        p_tipo: tipo,
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
        p_status_filtro: statusFiltro,
      })
      .then(({ data, error }) => {
        if (!alive) return
        setLoading(false)
        if (error) {
          setErro(error.message)
          return
        }
        setData(data as Resposta)
        setPage(1)
      })
    return () => {
      alive = false
    }
  }, [companyId, tipo, dataInicio, dataFim, statusFiltro, reloadKey])

  const resultadosFiltrados = useMemo(() => {
    const base = data?.resultados ?? []
    const q = busca.trim().toLowerCase()
    const qn = norm(busca.trim())
    // RD-41 · busca por CPF/CNPJ: normaliza (só dígitos) p/ achar com ou sem pontuação.
    const qDigitos = busca.replace(/\D/g, '')
    const vMin = parseValorBR(fValorMin)
    const vMax = parseValorBR(fValorMax)
    const filtrado = base.filter((r) => {
      if (categoria && r.categoria !== categoria) return false
      // item 3 + 3b: filtro Conta (sentinel "— sem conta informada —" = linha sem conta bancária)
      if (contasSel.size > 0) {
        const ck = contaMap[r.id]?.trim() ? contaMap[r.id] : SEM_CONTA
        if (!contasSel.has(ck)) return false
      }
      // RD-41 · filtros por coluna (client-side)
      if (fPessoa.trim() && !norm(r.nome_pessoa ?? '').includes(norm(fPessoa.trim()))) return false
      if (fForma && r.forma_pagamento !== fForma) return false
      if (vMin != null && (r.valor_documento ?? 0) < vMin) return false
      if (vMax != null && (r.valor_documento ?? 0) > vMax) return false
      if (q) {
        // busca AMPLA (acento-insensitive): nome, descrição, nº do título, forma, categoria e valor;
        // + CPF/CNPJ do cadastro normalizado (só dígitos, ≥3) — acha com OU sem pontuação.
        const hay = norm(`${r.descricao} ${r.nome_pessoa ?? ''} ${r.numero_documento ?? ''} ${r.forma_pagamento ?? ''} ${r.categoria ?? ''} ${fmtBRL(r.valor_documento)} ${r.valor_documento}`)
        const docDigitos = (r.documento ?? '').replace(/\D/g, '')
        const achouDoc = qDigitos.length >= 3 && docDigitos.includes(qDigitos)
        if (!hay.includes(qn) && !achouDoc) return false
      }
      return true
    })
    if (pagSort !== 'off') {   // item 1: ordena por data de pagamento (nulos por último)
      const dir = pagSort === 'asc' ? 1 : -1
      return [...filtrado].sort((a, b) => {
        const da = a.data_pagamento ?? ''
        const db = b.data_pagamento ?? ''
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return da < db ? -dir : da > db ? dir : 0
      })
    }
    return filtrado
  }, [data, busca, categoria, contasSel, contaMap, pagSort, fPessoa, fForma, fValorMin, fValorMax])

  const idsSelecionaveis = useMemo(
    () => resultadosFiltrados.filter((r) => r.situacao !== 'pago').map((r) => r.id),
    [resultadosFiltrados],
  )

  // Export (Pendência Jordana #3): descrição dos filtros ativos + KPIs do topo (ASCII-safe p/ PDF).
  const filtrosDesc = useMemo(() => {
    const statusMap: Record<string, string> = { todos: 'Todos', avencer: 'A vencer', vencidos: 'Vencidos', hoje: 'Hoje', pagos: labels.pagosLabel }
    const partes = [`Periodo ${fmtData(dataInicio)} a ${fmtData(dataFim)}`, `Status: ${statusMap[statusFiltro] ?? statusFiltro}`]
    if (categoria) partes.push(`Categoria: ${categoria}`)
    if (busca.trim()) partes.push(`Busca: "${busca.trim()}"`)
    if (fPessoa.trim()) partes.push(`${tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}: ${fPessoa.trim()}`)
    if (fForma) partes.push(`Forma: ${fForma}`)
    if (fValorMin.trim()) partes.push(`Valor >= R$ ${fValorMin.trim()}`)
    if (fValorMax.trim()) partes.push(`Valor <= R$ ${fValorMax.trim()}`)
    if (contasSel.size > 0) partes.push(`Conta: ${Array.from(contasSel).join(', ')}`)
    return partes.join(' · ')
  }, [dataInicio, dataFim, statusFiltro, categoria, busca, fPessoa, fForma, fValorMin, fValorMax, contasSel, labels, tipo])

  const kpisExport = useMemo(() => data ? [
    { label: labels.vencidosLabel, valor: data.kpis.vencidos.valor, qtd: data.kpis.vencidos.qtd },
    { label: labels.hojeLabel, valor: data.kpis.hoje.valor, qtd: data.kpis.hoje.qtd },
    { label: 'A vencer', valor: data.kpis.avencer.valor, qtd: data.kpis.avencer.qtd },
    { label: labels.pagosLabel, valor: data.kpis.pagos.valor, qtd: data.kpis.pagos.qtd },
    { label: 'Total', valor: data.kpis.total, qtd: (data.resultados ?? []).length },
  ] : [], [data, labels])
  // Dois somatórios (Jordana/CEO): Total = Σ valor cheio ("quanto tem nas contas");
  // Pendente = Σ (valor − valor_pago) ("quanto ainda falta"), nunca negativo (clamp em 0).
  const { valorTotalSelecionados, valorPendenteSelecionados } = useMemo(() => {
    const sel = resultadosFiltrados.filter((r) => selecionados.has(r.id))
    const total = sel.reduce((s, r) => s + (r.valor_documento ?? 0), 0)
    const pendente = sel.reduce((s, r) => s + Math.max(0, (r.valor_documento ?? 0) - (r.valor_pago ?? 0)), 0)
    return { valorTotalSelecionados: total, valorPendenteSelecionados: pendente }
  }, [resultadosFiltrados, selecionados])

  function toggleSelecionado(id: string) {
    const ns = new Set(selecionados)
    if (ns.has(id)) ns.delete(id); else ns.add(id)
    setSelecionados(ns)
  }
  function toggleTodos() {
    if (selecionados.size === idsSelecionaveis.length && idsSelecionaveis.length > 0) {
      setSelecionados(new Set())
    } else {
      setSelecionados(new Set(idsSelecionaveis))
    }
  }
  function limparSelecao() { setSelecionados(new Set()) }

  useEffect(() => { setSelecionados(new Set()) }, [companyId, tipo, dataInicio, dataFim, statusFiltro, reloadKey])

  const totalPages = Math.max(1, Math.ceil(resultadosFiltrados.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const pageStart = (pageSafe - 1) * PAGE_SIZE
  const pageItems = resultadosFiltrados.slice(pageStart, pageStart + PAGE_SIZE)

  const categoriasDistinct = useMemo(() => {
    const set = new Set<string>()
    ;(data?.resultados ?? []).forEach((r) => {
      if (r.categoria) set.add(r.categoria)
    })
    return Array.from(set).sort()
  }, [data])

  // RD-41 · formas de pagamento distintas (p/ o filtro por coluna)
  const formasDistinct = useMemo(() => {
    const set = new Set<string>()
    ;(data?.resultados ?? []).forEach((r) => { if (r.forma_pagamento) set.add(r.forma_pagamento) })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [data])

  const filtrosColunaAtivos = (fPessoa.trim() ? 1 : 0) + (fValorMin.trim() ? 1 : 0) + (fValorMax.trim() ? 1 : 0) + (fForma ? 1 : 0)
  const limparFiltrosColuna = () => { setFPessoa(''); setFValorMin(''); setFValorMax(''); setFForma(''); setPage(1) }

  // Camada1/Fatia2 item 3: busca a conta bancaria (texto) de cada linha carregada,
  // padrao aditivo (mesmo dos maps de nfse/boleto). Se a coluna nao existir (ex.
  // erp_receber), o erro e ignorado e o filtro simplesmente nao aparece.
  useEffect(() => {
    const ids = (data?.resultados ?? []).map((r) => r.id)
    if (ids.length === 0) { setContaMap({}); return }
    let alive = true
    ;(async () => {
      const tabela = tipo === 'pagar' ? 'erp_pagar' : 'erp_receber'
      const { data: rows, error } = await supabase.from(tabela).select('id, conta_bancaria').in('id', ids)
      if (!alive || error || !rows) { if (alive && error) setContaMap({}); return }
      const map: Record<string, string> = {}
      ;(rows as { id: string; conta_bancaria: string | null }[]).forEach((x) => {
        if (x.conta_bancaria && x.conta_bancaria.trim()) map[x.id] = x.conta_bancaria.trim()
      })
      setContaMap(map)
    })()
    return () => { alive = false }
  }, [data, tipo])

  const contasDistinct = useMemo(() => {
    const reais = Array.from(new Set(Object.values(contaMap))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    // 3b: linhas sem conta informada? (resultados que não estão no contaMap) → oferece o chip sentinel
    const temSemConta = (data?.resultados ?? []).some((r) => !contaMap[r.id]?.trim())
    return temSemConta ? [...reais, SEM_CONTA] : reais
  }, [contaMap, data])

  function aplicarPeriodo(choice: PeriodoChoice) {
    setPeriodoChoice(choice)
    const ref = new Date()
    if (choice === 'mes_atual') {
      setDataInicio(toISO(new Date(ref.getFullYear(), ref.getMonth(), 1)))
      setDataFim(toISO(new Date(ref.getFullYear(), ref.getMonth() + 1, 0)))
    } else if (choice === 'mes_passado') {
      setDataInicio(toISO(new Date(ref.getFullYear(), ref.getMonth() - 1, 1)))
      setDataFim(toISO(new Date(ref.getFullYear(), ref.getMonth(), 0)))
    } else if (choice === 'ano_atual') {
      setDataInicio(toISO(new Date(ref.getFullYear(), 0, 1)))
      setDataFim(toISO(new Date(ref.getFullYear(), 11, 31)))
    }
  }


  // Excluir despesa/receita — via RPC fn_pagar_excluir/fn_receber_excluir. O backend só exige desconciliar se
  // há conciliação REAL (vínculo no banco); se o título só está baixado (pago), oferece cancelar a baixa e
  // excluir. Mensagem honesta do motivo real (RD-51). Auditoria em erp_lancamento_log.
  const excluir = async (r: Resultado) => {
    if (!confirm(`EXCLUIR "${r.descricao}"?\nR$ ${(r.valor_documento).toFixed(2)} · venc ${fmtData(r.data_vencimento)}\n\nEsta ação fica registrada no histórico (imutável).`)) return
    const rpc = tipo === 'pagar' ? 'fn_pagar_excluir' : 'fn_receber_excluir'

    const chamar = async (cancelarBaixa: boolean) => {
      const { data, error } = await supabase.rpc(rpc, { p_id: r.id, p_cancelar_baixa: cancelarBaixa })
      if (error) { alert('Erro ao excluir: ' + error.message); return null }
      return data as { sucesso?: boolean; erro?: string; orientacao?: string } | null
    }

    let j = await chamar(false)
    if (j === null) return
    // Só baixado (pago), sem conciliação: pergunta se cancela a baixa e exclui.
    if (!j?.sucesso && j?.erro === 'requer_cancelar_baixa') {
      if (!confirm(`${j.orientacao ?? 'Este lançamento está baixado (pago). Cancelar a baixa e excluir?'}\n\nA baixa será cancelada e o lançamento excluído (fica registrado no histórico).`)) return
      j = await chamar(true)
      if (j === null) return
    }
    if (!j?.sucesso) {
      if (j?.erro === 'bloqueado_conciliado') {
        alert(
          `Este lançamento está CONCILIADO com o banco.\n\n` +
          `Excluir agora deixaria um movimento bancário órfão.\n` +
          `${j.orientacao ?? 'Cancele a conciliação no inbox, depois volte aqui.'}`,
        )
      } else if (j?.erro === 'bloqueado_boleto_ativo') {
        alert(
          `Este título tem BOLETO EMITIDO no banco.\n\n` +
          `Se excluir, o banco continua cobrando um boleto de um título que não existe mais.\n` +
          `${j.orientacao ?? 'Cancele o boleto primeiro, depois exclua.'}`,
        )
      } else {
        alert('Não foi possível excluir: ' + (j?.orientacao ?? j?.erro ?? 'desconhecido'))
      }
      return
    }
    setReloadKey((k) => k + 1)
  }

  // Edição em massa (Jordana #6) · aplica o MESMO valor do CAMPO escolhido a N selecionados. Reusa a RPC
  // do domínio (whitelist + pula pagos p/ valor/vencimento + RLS + log — RD-55/RD-57).
  const campoMassaDef = CAMPOS_MASSA.find((c) => c.v === massaCampo) ?? CAMPOS_MASSA[0]
  const massaValorValido = campoMassaDef.tipo === 'num'
    ? parseFloat((massaNovoValor || '').replace(',', '.')) > 0
    : (massaNovoValor || '').trim() !== ''
  const aplicarAlterarValorMassa = async () => {
    if (!massaValorValido) { alert('Informe o novo valor.'); return }
    const raw = (massaNovoValor || '').trim()
    const val = campoMassaDef.tipo === 'num' ? String(parseFloat(raw.replace(',', '.'))) : raw
    setMassaBusy(true)
    const rpc = tipo === 'pagar' ? 'fn_pagar_editar_massa' : 'fn_receber_editar_massa'
    const { data, error } = await supabase.rpc(rpc, {
      p_ids: Array.from(selecionados), p_campos: { [massaCampo]: val },
    })
    setMassaBusy(false)
    if (error) { alert('Erro ao alterar: ' + error.message); return }
    const j = data as { sucesso?: boolean; erro?: string; alterados?: number; pulados_pago?: number; falhas?: number } | null
    if (j?.sucesso === false) { alert('Não foi possível: ' + (j?.erro ?? 'campo não permitido')); return }
    const extra = [
      j?.pulados_pago ? `${j.pulados_pago} paga(s) puladas` : '',
      j?.falhas ? `${j.falhas} falha(s)` : '',
    ].filter(Boolean)
    setMassaMsg(`ALTEROU ${j?.alterados ?? 0} · ${campoMassaDef.l}${extra.length ? ' · ' + extra.join(' · ') : ''}`)
    setMassaValorAberto(false); setMassaNovoValor('')
    limparSelecao(); setReloadKey((k) => k + 1)
    setTimeout(() => setMassaMsg(null), 6000)
  }

  // Exclusão em massa · soft-delete. Reusa a RPC do domínio → bloqueia pago/conciliado
  // (e, no receber, boleto ativo) + log.
  const aplicarExcluirMassa = async () => {
    setMassaBusy(true)
    const rpc = tipo === 'pagar' ? 'fn_pagar_excluir_massa' : 'fn_receber_excluir_massa'
    const { data, error } = await supabase.rpc(rpc, { p_ids: Array.from(selecionados) })
    setMassaBusy(false)
    if (error) { alert('Erro ao excluir: ' + error.message); return }
    const j = data as { excluidos?: number; ignoradas_pago_conciliado?: number; ignoradas_boleto_ativo?: number } | null
    const partes = [
      j?.ignoradas_pago_conciliado ? `${j.ignoradas_pago_conciliado} paga(s)/conciliada(s)` : '',
      j?.ignoradas_boleto_ativo ? `${j.ignoradas_boleto_ativo} com boleto ativo` : '',
    ].filter(Boolean)
    setMassaMsg(`EXCLUIU ${j?.excluidos ?? 0}${partes.length ? ' · ' + partes.join(' · ') + ' ignorada(s)' : ''}`)
    setMassaExcluirAberto(false)
    limparSelecao(); setReloadKey((k) => k + 1)
    setTimeout(() => setMassaMsg(null), 6000)
  }

  // Duplicar via RPC fn_lancamento_duplicar — grava origem + novo em log.
  const duplicar = async (r: Resultado) => {
    const { data, error } = await supabase.rpc('fn_lancamento_duplicar', {
      p_tipo: tipo, p_id: r.id,
    })
    if (error) { alert('Erro ao duplicar: ' + error.message); return }
    const j = data as { sucesso?: boolean; erro?: string } | null
    if (!j?.sucesso) { alert('Erro ao duplicar: ' + (j?.erro ?? 'desconhecido')); return }
    setReloadKey((k) => k + 1)
  }

  const sincronizarLiquidacao = async () => {
    if (sincLiqBusy) return
    setSincLiqBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/boleto/sync-liquidacao', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          authorization: session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ company_id: companyId }),
      })
      const j = await r.json()
      if (!j.ok) { alert(j.erro || 'Nao foi possivel sincronizar.'); return }
      const q = Number(j.liquidados ?? 0)
      const c = Number(j.consultados ?? 0)
      const partes: string[] = []
      partes.push(q === 0 ? 'Nenhum boleto ALTEROU (nada pago desde a ultima sincronizacao).' : `${q} boleto(s) ALTEROU para liquidado.`)
      if (c > 0) partes.push(`${c} consultado(s).`)
      if (Array.isArray(j.erros) && j.erros.length > 0) partes.push(`${j.erros.length} com erro.`)
      alert(partes.join(' '))
      setReloadKey((k) => k + 1)
    } catch (e) {
      alert(`Falha ao sincronizar: ${(e as Error).message || 'erro de rede'}`)
    } finally {
      setSincLiqBusy(false)
    }
  }

  return (
    <Wrapper>
      <Header
        labels={labels}
        onHistorico={() => setHistoricoGlobalAberto(true)}
        acaoExtra={
          <ExportarListaButton
            companyId={companyId}
            tipo={tipo}
            titulo={labels.titulo}
            filtros={filtrosDesc}
            kpis={kpisExport}
            linhas={resultadosFiltrados}
          />
        }
      />

      {tipo === 'receber' && provider === 'sicoob' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            onClick={sincronizarLiquidacao}
            disabled={sincLiqBusy}
            title="Consulta o Sicoob e marca como liquidados os boletos ja pagos"
            style={{
              background: sincLiqBusy ? 'rgba(200,148,26,0.4)' : '#C8941A',
              color: '#3D2314', border: 'none', padding: '6px 12px',
              borderRadius: 6, fontSize: 12, fontWeight: 700,
              cursor: sincLiqBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}>
            {sincLiqBusy ? 'Sincronizando…' : '↻ Sincronizar liquidação'}
          </button>
        </div>
      )}

      {/* KPIs · sticky topo · padrao ContaAzul (Vencidos, Hoje, A vencer, Pagos/Recebidos, Total) */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#FAF7F2',
          padding: '8px 0',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            overflowX: 'auto',
          }}
        >
          <KpiCard
            titulo={labels.vencidosLabel}
            valor={data?.kpis.vencidos.valor ?? 0}
            qtd={data?.kpis.vencidos.qtd ?? 0}
            cor="#DC2626"
            destaque={(data?.kpis.vencidos.qtd ?? 0) > 0}
          />
          <KpiCard
            titulo={labels.hojeLabel}
            valor={data?.kpis.hoje.valor ?? 0}
            qtd={data?.kpis.hoje.qtd ?? 0}
            cor="#C8941A"
          />
          <KpiCard
            titulo="A vencer"
            valor={data?.kpis.avencer.valor ?? 0}
            qtd={data?.kpis.avencer.qtd ?? 0}
            cor="#3D2314"
          />
          <KpiCard
            titulo={labels.pagosLabel}
            valor={data?.kpis.pagos.valor ?? 0}
            qtd={data?.kpis.pagos.qtd ?? 0}
            cor="#16A34A"
          />
          <KpiCard
            titulo="Total"
            valor={data?.kpis.total ?? 0}
            qtd={(data?.resultados ?? []).length}
            cor="#3D2314"
          />
        </div>
      </div>

      {/* Filtros */}
      <div
        style={{
          background: '#FFFFFF',
          border: '0.5px solid rgba(61,35,20,0.12)',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <Campo label="Período">
          <select value={periodoChoice} onChange={(e) => aplicarPeriodo(e.target.value as PeriodoChoice)} style={inputStyle}>
            <option value="mes_atual">Mês atual ({MESES[hoje.getMonth()]})</option>
            <option value="mes_passado">Mês passado</option>
            <option value="ano_atual">Este ano</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </Campo>

        {periodoChoice === 'personalizado' && (
          <>
            <Campo label="Data início">
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                style={inputStyle}
              />
            </Campo>
            <Campo label="Data fim">
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                style={inputStyle}
              />
            </Campo>
          </>
        )}

        <Campo label="Status">
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value as typeof statusFiltro)} style={inputStyle}>
            <option value="todos">Todos</option>
            <option value="avencer">A vencer</option>
            <option value="vencidos">Vencidos</option>
            <option value="hoje">Hoje</option>
            <option value="pagos">{labels.pagosLabel}</option>
          </select>
        </Campo>

        <Campo label="Categoria">
          <select value={categoria} onChange={(e) => { setCategoria(e.target.value); setPage(1) }} style={inputStyle}>
            <option value="">Todas</option>
            {categoriasDistinct.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Campo>

        <Campo label="Buscar">
          <input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setPage(1) }}
            placeholder="Buscar por nome, CPF/CNPJ, descrição, documento ou valor"
            style={inputStyle}
          />
        </Campo>
      </div>

      {/* RD-41 · Filtros por coluna (recolhível · chips do que está ativo · limpar). Mobile-first. */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setFiltrosAbertos((v) => !v)}
            style={{ background: filtrosColunaAtivos ? '#3D2314' : '#FAF7F2', color: filtrosColunaAtivos ? '#FAF7F2' : '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {filtrosAbertos ? '▾' : '▸'} Filtros{filtrosColunaAtivos ? ` · ${filtrosColunaAtivos}` : ''}
          </button>
          {filtrosColunaAtivos > 0 && (
            <>
              {fPessoa.trim() && <FiltroChip label={`${tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}: ${fPessoa.trim()}`} onX={() => { setFPessoa(''); setPage(1) }} />}
              {fForma && <FiltroChip label={`Forma: ${fForma}`} onX={() => { setFForma(''); setPage(1) }} />}
              {fValorMin.trim() && <FiltroChip label={`≥ R$ ${fValorMin.trim()}`} onX={() => { setFValorMin(''); setPage(1) }} />}
              {fValorMax.trim() && <FiltroChip label={`≤ R$ ${fValorMax.trim()}`} onX={() => { setFValorMax(''); setPage(1) }} />}
              <button type="button" onClick={limparFiltrosColuna} style={{ background: 'transparent', color: '#A32D2D', border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>limpar filtros</button>
            </>
          )}
        </div>
        {filtrosAbertos && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10, padding: 12, background: '#FAF7F2', border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 10 }}>
            <Campo label={tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}>
              <input value={fPessoa} onChange={(e) => { setFPessoa(e.target.value); setPage(1) }} placeholder={`Nome do ${tipo === 'pagar' ? 'fornecedor' : 'cliente'}`} style={inputStyle} />
            </Campo>
            <Campo label="Forma de pagamento">
              <select value={fForma} onChange={(e) => { setFForma(e.target.value); setPage(1) }} style={inputStyle}>
                <option value="">Todas</option>
                {formasDistinct.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Campo>
            <Campo label="Valor mín (R$)">
              <input value={fValorMin} onChange={(e) => { setFValorMin(e.target.value); setPage(1) }} inputMode="decimal" placeholder="0,00" style={inputStyle} />
            </Campo>
            <Campo label="Valor máx (R$)">
              <input value={fValorMax} onChange={(e) => { setFValorMax(e.target.value); setPage(1) }} inputMode="decimal" placeholder="0,00" style={inputStyle} />
            </Campo>
          </div>
        )}
      </div>

      {/* Camada1/Fatia2 item 3: filtro Conta = multi-select com chips (só aparece se houver contas) */}
      {contasDistinct.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>Conta:</span>
          {contasDistinct.map((c) => {
            const on = contasSel.has(c)
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  const ns = new Set(contasSel)
                  if (ns.has(c)) ns.delete(c); else ns.add(c)
                  setContasSel(ns); setPage(1)
                }}
                style={{
                  background: on ? '#3D2314' : '#FAF7F2', color: on ? '#FAF7F2' : '#3D2314',
                  border: '0.5px solid rgba(61,35,20,0.2)', padding: '4px 12px', borderRadius: 16,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >{on ? '✓ ' : ''}{c}</button>
            )
          })}
          {contasSel.size > 0 && (
            <button
              type="button"
              onClick={() => { setContasSel(new Set()); setPage(1) }}
              style={{ background: 'transparent', color: '#A32D2D', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >limpar</button>
          )}
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div
          style={{
            background: '#FCEBEB',
            color: '#A32D2D',
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {erro}
        </div>
      )}

      {/* Tabela / Cards */}
      <div
        style={{
          background: '#FFFFFF',
          border: '0.5px solid rgba(61,35,20,0.12)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(61,35,20,0.55)', fontSize: 13 }}>
            Carregando...
          </div>
        ) : pageItems.length === 0 ? (
          <EmptyState labels={labels} />
        ) : (
          <>
            {selecionados.size > 0 && (
              <div style={{
                position: 'sticky', top: 0, zIndex: 5,
                background: '#3D2314', color: '#FAF7F2',
                padding: '12px 16px', borderRadius: '12px 12px 0 0',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, flexWrap: 'wrap', marginBottom: -1,
              }}>
                <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  ✅ <strong>{selecionados.size}</strong> selecionado{selecionados.size !== 1 ? 's' : ''}
                  <span style={{ opacity: 0.5 }}>·</span>
                  <span>Total <strong style={{ fontVariantNumeric: 'tabular-nums' }}>R$ {fmtBRL(valorTotalSelecionados)}</strong></span>
                  <span style={{ opacity: 0.5 }}>·</span>
                  <span title={tipo === 'pagar' ? 'quanto ainda falta pagar' : 'quanto o cliente ainda deve'}>
                    Pendente <strong style={{ color: '#F0C674', fontVariantNumeric: 'tabular-nums' }}>R$ {fmtBRL(valorPendenteSelecionados)}</strong>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(tipo === 'pagar' || tipo === 'receber') && (
                    <>
                      <button
                        type="button"
                        onClick={() => { setMassaNovoValor(''); setMassaCampo('valor'); setMassaValorAberto(true) }}
                        style={{ background: '#FAF7F2', color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Alterar em massa
                      </button>
                      <button
                        type="button"
                        onClick={() => setMassaExcluirAberto(true)}
                        style={{ background: 'transparent', color: '#FAF7F2', border: '0.5px solid rgba(250,247,242,0.3)', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        🗑 Excluir
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setLoteAberto(true)}
                    style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {tipo === 'pagar' ? `Marcar ${selecionados.size} pagas` : `Marcar ${selecionados.size} recebidas`}
                  </button>
                  <button
                    type="button"
                    onClick={limparSelecao}
                    style={{ background: 'transparent', color: '#FAF7F2', border: '0.5px solid rgba(250,247,242,0.3)', padding: '8px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                  >
                    Limpar
                  </button>
                </div>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#FAF7F2', borderBottom: '0.5px solid rgba(61,35,20,0.12)' }}>
                    <Th>
                      <input
                        type="checkbox"
                        checked={idsSelecionaveis.length > 0 && selecionados.size === idsSelecionaveis.length}
                        onChange={toggleTodos}
                        disabled={idsSelecionaveis.length === 0}
                        aria-label="Selecionar todos não pagos"
                      />
                    </Th>
                    <Th>Descrição</Th>
                    <Th>Quem</Th>
                    <Th>Categoria</Th>
                    <Th>Vencimento</Th>
                    <Th>
                      <span
                        onClick={() => setPagSort((s) => (s === 'off' ? 'asc' : s === 'asc' ? 'desc' : 'off'))}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                        title="Ordenar por data de pagamento"
                        data-testid="pagar-sort-pagamento"
                      >
                        Pagamento {pagSort === 'asc' ? '▲' : pagSort === 'desc' ? '▼' : '⇅'}
                      </span>
                    </Th>
                    <Th align="right">Valor</Th>
                    <Th>Status</Th>
                    {tipo === 'receber' && <Th>Fiscal</Th>}
                    <Th align="right">Ação</Th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((r) => {
                    const pago = r.situacao === 'pago'
                    const checked = selecionados.has(r.id)
                    const corLinha = CORES_SITUACAO[r.situacao]
                    const parcelaVisivel = r.parcela && r.parcela.trim() !== '' && r.parcela !== '1/1' && r.parcela !== '001/001'
                    return (
                      <tr key={r.id} style={{ borderBottom: '0.5px solid rgba(61,35,20,0.06)', background: checked ? 'rgba(200,148,26,0.06)' : 'transparent', boxShadow: `inset 4px 0 0 ${corLinha}` }}>
                        <Td>
                          {!pago && (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelecionado(r.id)}
                              aria-label={`Selecionar ${r.descricao}`}
                            />
                          )}
                        </Td>
                        <Td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <strong style={{ color: '#3D2314' }}>{r.descricao}</strong>
                            {parcelaVisivel && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#854F0B', background: 'rgba(200,148,26,0.12)', border: '0.5px solid rgba(200,148,26,0.35)', padding: '2px 6px', borderRadius: 4, fontVariantNumeric: 'tabular-nums' }} title="Parcela atual / total">
                                ⛓ {r.parcela}
                              </span>
                            )}
                            {r.observacoes && r.observacoes.trim() !== '' && (
                              <span style={{ fontSize: 12, cursor: 'help' }} title={r.observacoes}>📝</span>
                            )}
                          </div>
                          {r.observacoes && r.observacoes.trim() !== '' && (
                            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', fontStyle: 'italic', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {r.observacoes}
                            </div>
                          )}
                          {r.numero_documento && (
                            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)' }}>nº {r.numero_documento}</div>
                          )}
                          {/* Camada1/Fatia2 item 4: resumo (categoria · fornecedor) na linha */}
                          {(r.categoria || r.nome_pessoa) && (
                            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)' }}>
                              {[r.categoria, r.nome_pessoa].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </Td>
                        <Td>{r.nome_pessoa || '—'}</Td>
                        <Td><span style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>{r.categoria || '—'}</span></Td>
                        <Td>{fmtData(r.data_vencimento)}</Td>
                        <Td>{r.data_pagamento ? fmtData(r.data_pagamento) : '—'}</Td>
                        <Td align="right">
                          {/* principal = valor do DOCUMENTO (fonte da verdade). valor_pago vira detalhe. */}
                          <strong>{fmtBRL(r.valor_documento)}</strong>
                          {r.status === 'parcial' && (r.valor_pago ?? 0) > 0 && (
                            <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
                              {tipo === 'pagar' ? 'pago' : 'recebido'} {fmtBRL(r.valor_pago ?? 0)} · saldo {fmtBRL(Math.max(0, r.valor_documento - (r.valor_pago ?? 0)))}
                            </div>
                          )}
                          {/* AVISO de divergência: pago ≠ documento (sem juros/multa que justifique) → flag p/ conferir. */}
                          {r.status === 'pago' && r.valor_pago != null && Math.abs((r.valor_pago ?? 0) - r.valor_documento) > 0.01 && (
                            <div style={{ fontSize: 10, marginTop: 2, color: '#B45309', fontWeight: 600 }}>
                              ⚠️ {tipo === 'pagar' ? 'pago' : 'recebido'} {fmtBRL(r.valor_pago ?? 0)} · diverge do documento
                            </div>
                          )}
                        </Td>
                        <Td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <Pill situacao={r.situacao} tipo={tipo} />
                            {r.status === 'parcial' && (
                              <span style={{ fontSize: 9, background: '#FEF3C7', color: '#7A5A0F', padding: '2px 6px', borderRadius: 3, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                                parcial
                              </span>
                            )}
                          </div>
                        </Td>
                        {tipo === 'receber' && (
                          <Td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <EmitirNFSeButton
                                companyId={companyId}
                                erpReceberId={r.id}
                                descricao={r.descricao}
                                valor={r.valor_documento}
                                jaEmitida={nfseMap[r.id] === 'autorizada'}
                                processando={nfseMap[r.id] === 'processando'}
                                pdfUrl={nfseDocMap[r.id]?.pdf ?? undefined}
                                xmlUrl={nfseDocMap[r.id]?.xml ?? undefined}
                                notaId={nfseDocMap[r.id]?.notaId}
                                onSucesso={() => setReloadKey((k) => k + 1)}
                              />
                              <EmitirNFeButton
                                companyId={companyId}
                                erpReceberId={r.id}
                                valor={r.valor_documento}
                                jaEmitida={nfeMap[r.id] === 'autorizada'}
                                onSucesso={() => setReloadKey((k) => k + 1)}
                              />
                              {provider === 'sicoob' || provider === 'sicredi' ? (
                                <BoletoActions
                                  provider={provider}
                                  receberId={r.id}
                                  valor={r.valor_documento}
                                  vencimentoISO={r.data_vencimento}
                                  cliente={clientesMap[r.id] ?? null}
                                  empresaCnpj={empresaCnpj}
                                  boleto={boletoMap[r.id] ?? { status: null, nossoNumero: null, linhaDigitavel: null, qrCode: null, url: null }}
                                  onSucesso={() => setReloadKey((k) => k + 1)}
                                />
                              ) : (
                                <GerarBoletoButton
                                  receberId={r.id}
                                  jaTemBoleto={boletoMap[r.id]?.status === 'registrado'}
                                  linhaDigitavel={boletoMap[r.id]?.linhaDigitavel ?? null}
                                  onSucesso={() => setReloadKey((k) => k + 1)}
                                />
                              )}
                            </div>
                          </Td>
                        )}
                        <Td align="right">
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
                            {!pago && capExtrato && (
                              <button
                                type="button"
                                onClick={() => setConciliandoItem(r)}
                                title="Buscar movimento no extrato bancário e dar baixa automaticamente"
                                style={{ background: '#FFFFFF', color: '#3D2314', border: '0.5px solid #C8941A', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                Conciliar
                              </button>
                            )}
                            {!pago && (
                              <button
                                type="button"
                                onClick={() => setPagandoItem(r)}
                                style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                {tipo === 'pagar' ? 'Marcar pago' : 'Marcar recebido'}
                              </button>
                            )}
                            {pago && <span style={{ fontSize: 10, color: 'rgba(61,35,20,0.4)', marginRight: 6 }}>✓ baixado</span>}
                            <button
                              type="button"
                              onClick={() => setEditandoItem(r)}
                              title="Editar lançamento"
                              aria-label="Editar"
                              style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.15)', width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistoricoItem(r)}
                              title="Ver histórico (quem alterou/excluiu/duplicou)"
                              aria-label="Histórico"
                              style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.15)', width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              🕐
                            </button>
                            <button
                              type="button"
                              onClick={() => void duplicar(r)}
                              title="Duplicar como novo lançamento (aberto)"
                              aria-label="Duplicar"
                              style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.15)', width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              📋
                            </button>
                            <button
                              type="button"
                              onClick={() => void excluir(r)}
                              title="Excluir lançamento (bloqueado se conciliado)"
                              aria-label="Excluir"
                              style={{ background: 'transparent', color: '#B91C1C', border: '0.5px solid rgba(185,28,28,0.25)', width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              🗑️
                            </button>
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '0.5px solid rgba(61,35,20,0.12)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                fontSize: 12,
                color: 'rgba(61,35,20,0.65)',
              }}
            >
              <div>
                Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, resultadosFiltrados.length)} de {resultadosFiltrados.length}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSafe <= 1}
                  style={btnPaginacao(pageSafe <= 1)}
                >
                  Anterior
                </button>
                <span style={{ padding: '6px 4px' }}>
                  Página {pageSafe} de {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageSafe >= totalPages}
                  style={btnPaginacao(pageSafe >= totalPages)}
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <MarcarPagoModal
        open={!!pagandoItem}
        onClose={() => setPagandoItem(null)}
        onSucesso={() => setReloadKey((k) => k + 1)}
        companyId={companyId}
        tipo={tipo}
        itemId={pagandoItem?.id ?? ''}
        descricao={pagandoItem?.descricao ?? ''}
        valorTotal={pagandoItem ? (pagandoItem.valor_documento - (pagandoItem.valor_pago ?? 0)) : 0}
      />

      <ConciliarTituloModal
        open={!!conciliandoItem}
        onClose={() => setConciliandoItem(null)}
        onSucesso={() => setReloadKey((k) => k + 1)}
        tituloTabela={tipo === 'pagar' ? 'erp_pagar' : 'erp_receber'}
        tituloId={conciliandoItem?.id ?? ''}
        tituloDescricao={conciliandoItem?.descricao ?? ''}
        tituloValor={conciliandoItem ? (conciliandoItem.valor_documento - (conciliandoItem.valor_pago ?? 0)) : 0}
        tituloVencimento={conciliandoItem?.data_vencimento ?? ''}
      />

      <EditarLancamentoModal
        open={!!editandoItem}
        onClose={() => setEditandoItem(null)}
        onSucesso={() => { setEditandoItem(null); setReloadKey((k) => k + 1) }}
        tipo={tipo}
        itemId={editandoItem?.id ?? ''}
        companyId={companyId}
      />

      <HistoricoLancamentoModal
        open={!!historicoItem}
        onClose={() => setHistoricoItem(null)}
        itemId={historicoItem?.id ?? ''}
        itemDescricao={historicoItem?.descricao ?? ''}
        tipo={tipo}
      />

      <HistoricoGlobalModal
        open={historicoGlobalAberto}
        onClose={() => setHistoricoGlobalAberto(false)}
        companyId={companyId}
      />

      <MarcarPagoLoteModal
        open={loteAberto}
        onClose={() => setLoteAberto(false)}
        onSucesso={() => { setReloadKey((k) => k + 1); setSelecionados(new Set()); setLoteAberto(false) }}
        companyId={companyId}
        tipo={tipo}
        ids={Array.from(selecionados)}
        valorTotal={valorPendenteSelecionados}
      />

      {/* Jordana #6 · Alterar em massa (campo + valor) */}
      {massaValorAberto && (
        <ModalMassa
          titulo="Alterar em massa"
          onClose={() => setMassaValorAberto(false)}
          confirmar={aplicarAlterarValorMassa}
          confirmarLabel={massaBusy ? 'Aplicando…' : 'Aplicar'}
          confirmarDisabled={massaBusy || !massaValorValido}
        >
          <div style={{ fontSize: 12, marginBottom: 6 }}>Campo a alterar</div>
          <select
            value={massaCampo}
            onChange={(e) => { setMassaCampo(e.target.value); setMassaNovoValor('') }}
            style={{ width: '100%', padding: '10px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 14, background: '#FFFFFF', color: '#3D2314', boxSizing: 'border-box', marginBottom: 12 }}
          >
            {CAMPOS_MASSA.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>

          <div style={{ fontSize: 12, marginBottom: 6 }}>Novo valor · {campoMassaDef.l}</div>
          {campoMassaDef.tipo === 'select' ? (
            <select value={massaNovoValor} onChange={(e) => setMassaNovoValor(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 14, background: '#FFFFFF', color: '#3D2314', boxSizing: 'border-box' }}>
              <option value="">— escolher —</option>
              {FORMAS_PAGAMENTO.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
            </select>
          ) : (
            <input
              type={campoMassaDef.tipo === 'date' ? 'date' : campoMassaDef.tipo === 'num' ? 'number' : 'text'}
              step={campoMassaDef.tipo === 'num' ? '0.01' : undefined}
              min={campoMassaDef.tipo === 'num' ? '0' : undefined}
              autoFocus
              value={massaNovoValor}
              onChange={(e) => setMassaNovoValor(e.target.value)}
              placeholder={campoMassaDef.tipo === 'num' ? '0,00' : ''}
              style={{ width: '100%', padding: '10px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 14, background: '#FFFFFF', color: '#3D2314', boxSizing: 'border-box' }}
            />
          )}

          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.6)', marginTop: 8 }}>
            {selecionados.size} lançamento{selecionados.size !== 1 ? 's' : ''} → <b>{campoMassaDef.l}</b>{massaNovoValor ? <> = <b>{massaNovoValor}</b></> : ''}.
            {(massaCampo === 'valor' || massaCampo === 'data_vencimento') && <> Contas <b>pagas/conciliadas</b> são puladas.</>}
          </div>
        </ModalMassa>
      )}

      {/* RD-41 · Excluir em massa */}
      {massaExcluirAberto && (
        <ModalMassa
          titulo={`Excluir ${selecionados.size} conta${selecionados.size !== 1 ? 's' : ''}?`}
          onClose={() => setMassaExcluirAberto(false)}
          confirmar={aplicarExcluirMassa}
          confirmarLabel={massaBusy ? 'Excluindo…' : `Excluir ${selecionados.size}`}
          confirmarDisabled={massaBusy}
        >
          <div style={{ fontSize: 13, color: '#3D2314' }}>
            Contas <b>pagas</b> ou já <b>conciliadas</b> serão ignoradas. Esta ação registra histórico e pode ser auditada.
          </div>
          {tipo === 'receber' && (
            <div style={{ fontSize: 12, color: '#854F0B', marginTop: 8, background: '#FEF6E0', border: '1px solid #C8941A', borderRadius: 6, padding: '8px 10px' }}>
              Títulos com <b>boleto emitido ativo</b> não serão excluídos — cancele o boleto no banco antes, senão o banco continua cobrando.
            </div>
          )}
        </ModalMassa>
      )}

      {massaMsg && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 2000, background: '#3D2314', color: '#FAF7F2', padding: '12px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(61,35,20,0.25)' }}>
          {massaMsg}
        </div>
      )}
    </Wrapper>
  )
}

// Modal simples reusado pelas ações em massa (RD-41).
function ModalMassa({ titulo, children, onClose, confirmar, confirmarLabel, confirmarDisabled }: {
  titulo: string; children: React.ReactNode; onClose: () => void
  confirmar: () => void; confirmarLabel: string; confirmarDisabled?: boolean
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1500, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFFFFF', borderRadius: 12, maxWidth: 420, width: '100%', overflow: 'hidden', border: '0.5px solid rgba(61,35,20,0.15)' }}>
        <div style={{ background: '#3D2314', color: '#FAF7F2', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 14 }}>{titulo}</b>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'transparent', border: 'none', color: '#FAF7F2', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
        <div style={{ padding: '12px 16px', borderTop: '0.5px solid rgba(61,35,20,0.12)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={confirmar} disabled={confirmarDisabled} style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: confirmarDisabled ? 'not-allowed' : 'pointer', opacity: confirmarDisabled ? 0.55 : 1 }}>{confirmarLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// Subcomponentes & helpers

function labelsPorTipo(tipo: Tipo) {
  if (tipo === 'pagar') {
    return {
      breadcrumb: 'Financeiro · Despesas',
      titulo: 'Despesas a pagar',
      subtitulo: 'Acompanhe tudo que você tem para pagar',
      tipoPlural: 'despesas',
      pagosLabel: 'Pagas',
      vencidosLabel: 'Vencidas',
      hojeLabel: 'Vencem hoje',
      ctaNovo: 'Nova despesa',
      rotaNovo: '/dashboard/financeiro/nova-despesa',
    }
  }
  return {
    breadcrumb: 'Financeiro · Receitas',
    titulo: 'Receitas a receber',
    subtitulo: 'Acompanhe tudo que você tem para receber',
    tipoPlural: 'receitas',
    pagosLabel: 'Recebidas',
    vencidosLabel: 'Vencidas',
    hojeLabel: 'Vencem hoje',
    ctaNovo: 'Nova receita',
    rotaNovo: '/dashboard/financeiro/nova-receita',
  }
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

function Header({ labels, onHistorico, acaoExtra }: {
  labels: ReturnType<typeof labelsPorTipo>
  onHistorico?: () => void
  acaoExtra?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 20,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            color: 'rgba(61,35,20,0.55)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          {labels.breadcrumb}
        </div>
        <h1 style={{ fontSize: 24, color: '#3D2314', margin: 0, fontWeight: 500 }}>{labels.titulo}</h1>
        <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>{labels.subtitulo}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {acaoExtra}
        {onHistorico && (
          <button
            type="button"
            onClick={onHistorico}
            title="Histórico global de alterações, exclusões e duplicações"
            style={{
              background: '#FFFFFF', color: '#3D2314',
              border: '0.5px solid rgba(61,35,20,0.25)',
              padding: '9px 16px', borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
            🕐 Histórico
          </button>
        )}
        <Link
          href={labels.rotaNovo + '?area=gestao_empresarial'}
          style={{
            background: '#C8941A',
            color: '#3D2314',
            padding: '10px 22px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          + {labels.ctaNovo}
        </Link>
      </div>
    </div>
  )
}

function KpiCard({ titulo, valor, qtd, cor, destaque = false }: {
  titulo: string; valor: number; qtd: number; cor: string; destaque?: boolean
}) {
  return (
    <div
      style={{
        background: destaque ? '#FCEBEB' : '#FFFFFF',
        border: `0.5px solid ${destaque ? cor : 'rgba(61,35,20,0.12)'}`,
        borderRadius: 12,
        padding: '16px 18px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'rgba(61,35,20,0.55)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 8,
        }}
      >
        {titulo}
      </div>
      <div style={{ fontSize: 20, color: cor, fontWeight: 600 }}>{fmtBRL(valor)}</div>
      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 4 }}>
        {qtd} {qtd === 1 ? 'lançamento' : 'lançamentos'}
      </div>
    </div>
  )
}

function Pill({ situacao, tipo }: { situacao: Situacao; tipo?: Tipo }) {
  // Pilar 3 (linguagem do usuário): conta a RECEBER quitada = "Recebido" (entrou dinheiro),
  // não "Pago" (que é da conta a PAGAR). O VALOR do status no banco continua 'pago'.
  const map: Record<Situacao, { bg: string; cor: string; label: string }> = {
    pago: { bg: '#DCFCE7', cor: '#16A34A', label: tipo === 'receber' ? 'Recebido' : 'Pago' },
    a_vencer: { bg: '#FEF3C7', cor: '#C8941A', label: 'A vencer' },
    hoje: { bg: '#FEF3C7', cor: '#C8941A', label: 'Hoje' },
    vencido: { bg: '#FEE2E2', cor: '#DC2626', label: 'Vencido' },
  }
  const s = map[situacao] ?? map.a_vencer
  return (
    <span
      style={{
        background: s.bg,
        color: s.cor,
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      {s.label}
    </span>
  )
}

function EmptyState({ labels }: { labels: ReturnType<typeof labelsPorTipo> }) {
  return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: 'rgba(61,35,20,0.7)', marginBottom: 12 }}>
        Nenhuma {labels.tipoPlural === 'despesas' ? 'despesa' : 'receita'} encontrada neste período.
        Que tal cadastrar a primeira?
      </div>
      <Link
        href={labels.rotaNovo + '?area=gestao_empresarial'}
        style={{
          display: 'inline-block',
          background: '#C8941A',
          color: '#3D2314',
          padding: '10px 22px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        + {labels.ctaNovo}
      </Link>
    </div>
  )
}

// RD-41 · chip de filtro ativo (rótulo + × p/ remover)
function FiltroChip({ label, onX }: { label: string; onX: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F0ECE3', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 16, padding: '3px 6px 3px 10px', fontSize: 11, fontWeight: 600, color: '#3D2314' }}>
      {label}
      <button type="button" onClick={onX} aria-label="remover filtro" style={{ background: 'transparent', border: 'none', color: '#A32D2D', fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: '0 2px' }}>×</button>
    </span>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          color: 'rgba(61,35,20,0.65)',
          marginBottom: 4,
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        padding: '10px 14px',
        textAlign: align,
        fontSize: 11,
        color: 'rgba(61,35,20,0.55)',
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td
      style={{
        padding: '12px 14px',
        textAlign: align,
        fontSize: 13,
        color: 'rgba(61,35,20,0.85)',
        verticalAlign: 'top',
      }}
    >
      {children}
    </td>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 13,
  background: '#FFFFFF',
  color: '#3D2314',
  fontFamily: 'inherit',
}

const btnPaginacao = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? '#F3EFE8' : '#FFFFFF',
  color: disabled ? 'rgba(61,35,20,0.35)' : '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.25)',
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 12,
  cursor: disabled ? 'not-allowed' : 'pointer',
})
