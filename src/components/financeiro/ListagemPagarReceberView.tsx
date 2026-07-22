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
import ConciliarTituloModal from './ConciliarTituloModal'
import EditarLancamentoModal from './EditarLancamentoModal'
import HistoricoLancamentoModal from './HistoricoLancamentoModal'
import HistoricoGlobalModal from './HistoricoGlobalModal'

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
  const [loteAberto, setLoteAberto] = useState(false)
  const [periodoChoice, setPeriodoChoice] = useState<PeriodoChoice>('mes_atual')
  const [statusFiltro, setStatusFiltro] = useState<'todos' | 'avencer' | 'vencidos' | 'pagos' | 'hoje'>('todos')
  const [categoria, setCategoria] = useState('')
  const [busca, setBusca] = useState('')
  const [page, setPage] = useState(1)

  const [data, setData] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(false)
  const [sincLiqBusy, setSincLiqBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [nfseMap, setNfseMap] = useState<Record<string, 'autorizada' | 'processando' | 'rejeitada' | 'cancelada'>>({})
  const [nfseDocMap, setNfseDocMap] = useState<Record<string, { pdf?: string | null; xml?: string | null }>>({})
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
        .select('erp_receber_id, status, pdf_url, xml_url')
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
      const nfseDocMapNew: Record<string, { pdf?: string | null; xml?: string | null }> = {}
      for (const row of nfseRes.data ?? []) {
        if (!row.erp_receber_id) continue
        if (nfseMapNew[row.erp_receber_id] === 'autorizada') continue
        nfseMapNew[row.erp_receber_id] = row.status
        if (row.status === 'autorizada') nfseDocMapNew[row.erp_receber_id] = { pdf: row.pdf_url, xml: row.xml_url }
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
    const filtrado = base.filter((r) => {
      if (categoria && r.categoria !== categoria) return false
      if (contasSel.size > 0 && !contasSel.has(contaMap[r.id] ?? '')) return false   // item 3
      if (q) {
        const hay = `${r.descricao} ${r.nome_pessoa ?? ''} ${r.numero_documento ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
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
  }, [data, busca, categoria, contasSel, contaMap, pagSort])

  const idsSelecionaveis = useMemo(
    () => resultadosFiltrados.filter((r) => r.situacao !== 'pago').map((r) => r.id),
    [resultadosFiltrados],
  )
  const valorTotalSelecionados = useMemo(() => {
    return resultadosFiltrados
      .filter((r) => selecionados.has(r.id))
      .reduce((s, r) => s + (r.valor_documento - (r.valor_pago ?? 0)), 0)
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

  const contasDistinct = useMemo(
    () => Array.from(new Set(Object.values(contaMap))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [contaMap],
  )

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


  // Excluir despesa/receita — via RPC fn_pagar_excluir/fn_receber_excluir
  // (guard-rail conciliado/pago no backend + auditoria em erp_lancamento_log).
  const excluir = async (r: Resultado) => {
    if (!confirm(`EXCLUIR "${r.descricao}"?\nR$ ${(r.valor_documento).toFixed(2)} · venc ${fmtData(r.data_vencimento)}\n\nEsta ação fica registrada no histórico (imutável) e NÃO pode ser desfeita.`)) return
    const rpc = tipo === 'pagar' ? 'fn_pagar_excluir' : 'fn_receber_excluir'
    const { data, error } = await supabase.rpc(rpc, { p_id: r.id })
    if (error) { alert('Erro ao excluir: ' + error.message); return }
    const j = data as { sucesso?: boolean; erro?: string; orientacao?: string } | null
    if (!j?.sucesso) {
      if (j?.erro === 'bloqueado_conciliado_ou_pago') {
        alert(
          `Este lançamento está CONCILIADO ou PAGO.\n\n` +
          `Excluir agora geraria um movimento bancário órfão.\n` +
          `${j.orientacao ?? 'Desvincule no inbox de conciliação, depois volte aqui.'}`,
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
      <Header labels={labels} onHistorico={() => setHistoricoGlobalAberto(true)} />

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
            placeholder="descrição, quem, documento..."
            style={inputStyle}
          />
        </Campo>
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
                <div style={{ fontSize: 13 }}>
                  ✅ <strong>{selecionados.size}</strong> selecionado{selecionados.size !== 1 ? 's' : ''} · R$ <strong>{fmtBRL(valorTotalSelecionados)}</strong> total
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                          </div>
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
        valorTotal={valorTotalSelecionados}
      />
    </Wrapper>
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

function Header({ labels, onHistorico }: {
  labels: ReturnType<typeof labelsPorTipo>
  onHistorico?: () => void
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
