'use client'

// ONDA-A-INBOX-SELO-v1
// Blinda "Aplicar todos OURO" contra duplo-vinculo (via fn_conciliacao_rodar_lote),
// adiciona toggle de auto-conciliacao por empresa, selo de precisao em pendentes
// e aba "Conciliados". Linguagem CONCILIOU/CONCILIADO.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import ArquivarMovimentoModal from '@/components/conciliacao/ArquivarMovimentoModal'
import VincularVariosModal from '@/components/conciliacao/VincularVariosModal'
import AjustarValoresModal from '@/components/conciliacao/AjustarValoresModal'
import PickerTituloExistenteModal from '@/components/conciliacao/PickerTituloExistenteModal'
import EditarLancamentoModal from '@/components/financeiro/EditarLancamentoModal'

interface Item {
  movimento_id: string
  lote_nome: string | null
  tipo_lote: string | null
  data_transacao: string
  valor: number
  descricao: string | null
  natureza: string | null
  status: string
  sugestao_lancamento_tabela: string | null
  sugestao_lancamento_id: string | null
  sugestao_data: string | null
  sugestao_valor: number | null
  sugestao_contraparte: string | null
  sugestao_score: number | null
  sugestao_categoria: string | null
  // dupla-identificacao-v1: exato | ambiguo | revisar | quase_la | fraco
  sugestao_qualidade: string | null
  sugestao_qtd_candidatos: number | null
}

interface Conciliado {
  movimento_id: string
  lote_id: string | null
  lote_nome: string | null
  data_transacao: string
  valor: number
  descricao: string | null
  natureza: string | null
  lancamento_tabela: string | null
  lancamento_id: string | null
  contraparte: string | null
  valor_lancamento: number | null
  data_lancamento: string | null
  precisao: number | null
  match_origem: string | null
  conciliado_em: string | null
}

// conciliacao-reorg-tela-v1
interface Lote {
  id: string
  nome: string | null
  tipo: string | null
  periodo_inicio: string | null
  periodo_fim: string | null
  total_movimentos: number | null
  total_conciliados: number | null
  total_pendentes: number | null
  created_at: string | null
}

interface PendenciaSistema {
  tabela: 'erp_pagar' | 'erp_receber' | string
  id: string
  natureza: 'debito' | 'credito' | string
  nome: string | null
  descricao: string | null
  categoria: string | null
  valor: number | null
  data_vencimento: string | null
  status: string | null
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// fix-conciliacao-exibicao-sinal-cor-por-natureza-v1
// Sinal/cor SEMPRE seguem `natureza` (debito = vermelho-, credito = verde+).
// valor positivo no banco; o sinal vem 100% da natureza.
function formatarValorMovimento(valor: number | null | undefined, natureza: string | null | undefined): { texto: string; cor: string } {
  const ehDebito = natureza === 'debito'
  const sinal = ehDebito ? '−' : '+'
  const cor = ehDebito ? '#A32D2D' : '#3B6D11'
  return { texto: `${sinal} R$ ${fmt(Math.abs(Number(valor) || 0))}`, cor }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = s.split('T')[0]
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

function fmtBR(d?: string | null): string {
  return d ? new Date(d).toLocaleDateString('pt-BR') : ''
}

// ONDA-A-INBOX-SELO-v1: selo de precisao (escala 0-100, vinda de psgc_confianca/match_score)
function seloPrecisao(score?: number | null) {
  const s = Number(score ?? 0)
  if (s >= 90) return { emoji: '🟢', label: 'OURO',   cor: '#1B873F', bg: '#E7F4EC' }
  if (s >= 70) return { emoji: '🟡', label: 'PRATA',  cor: '#B7791F', bg: '#FBF3E0' }
  if (s >= 50) return { emoji: '🟠', label: 'BRONZE', cor: '#C05621', bg: '#FBEAE0' }
  return         { emoji: '🔴', label: 'BAIXA',  cor: '#C53030', bg: '#FCE8E8' }
}

function iconeOrigem(o?: string | null): string {
  return o === 'auto' ? '🤖 automático' : '👤 manual'
}

// dupla-identificacao-v1: selo de QUALIDADE do match (dupla identificação · RD-51).
// 'exato' auto-concilia; 'ambiguo' (empate) e 'revisar' (sem identificação) exigem humano.
function badgeQualidade(q?: string | null, qtd?: number | null): { label: string; cor: string; bg: string; forcaEscolha: boolean } | null {
  switch (q) {
    case 'ambiguo':
      return { label: `⚖️ EM DISPUTA · ${qtd ?? 2} candidatos`, cor: '#B23A00', bg: '#FBE9DE', forcaEscolha: true }
    case 'revisar':
      return { label: '🔎 REVISAR · confirme a identidade', cor: '#8A5A00', bg: '#FBEED2', forcaEscolha: false }
    case 'exato':
      return { label: '✅ IDENTIFICADO · único', cor: '#1B873F', bg: '#E7F4EC', forcaEscolha: false }
    default:
      return null
  }
}

// Sugestao_score do fn_conciliacao_inbox vem como 0-1 (legado). Normaliza para 0-100.
function scoreParaPercent(s: number | null | undefined): number {
  const v = Number(s ?? 0)
  if (v <= 1) return Math.round(v * 100)
  return Math.round(v)
}

// ONDA-A-IMPORTADOR-OFX-v1: parser OFX simples (regex sobre STMTTRN)
interface MovimentoOFX {
  data_transacao: string
  valor: number
  natureza: 'debito' | 'credito'
  descricao: string
  id_externo: string | null
}

// conciliacao-tela-sugestoes-acoes-v1
interface SugestaoMatch {
  lancamento_tabela: 'erp_pagar' | 'erp_receber' | string
  lancamento_id: string
  data_lancamento: string | null
  valor_lancamento: number | null
  descricao_lancamento: string | null
  contraparte: string | null
  match_score: number
  match_categoria: 'perfeito' | 'quase' | 'fraco' | string
  motivo: string | null
}

function parseOFX(text: string): MovimentoOFX[] {
  const movimentos: MovimentoOFX[] = []
  const blocos = text.split(/<STMTTRN>/i).slice(1)
  for (const b of blocos) {
    const tx = b.split(/<\/STMTTRN>/i)[0]
    const get = (tag: string) => {
      const m = tx.match(new RegExp('<' + tag + '>([^<\\r\\n]+)', 'i'))
      return m ? m[1].trim() : ''
    }
    const dt = get('DTPOSTED').slice(0, 8)
    if (dt.length < 8) continue
    const data_transacao = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`
    const amt = parseFloat(get('TRNAMT').replace(',', '.'))
    if (isNaN(amt)) continue
    movimentos.push({
      data_transacao,
      valor: Math.abs(amt),
      natureza: amt < 0 ? 'debito' : 'credito',
      descricao: (get('MEMO') || get('NAME') || 'Movimento').slice(0, 200),
      id_externo: get('FITID') || null,
    })
  }
  return movimentos
}

export default function InboxPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [items, setItems] = useState<Item[]>([])
  const [conciliados, setConciliados] = useState<Conciliado[]>([])
  const [loading, setLoading] = useState(true)
  const [soOuro, setSoOuro] = useState(false)
  const [aba, setAba] = useState<'pendentes' | 'conciliados'>('pendentes')
  // Camada1/Fatia1 estabilizacao conciliacao (08/07): busca, contador por natureza, editar linha sistema
  const [busca, setBusca] = useState('')
  const [filtroNatExtrato, setFiltroNatExtrato] = useState<'todos' | 'credito' | 'debito'>('todos')
  const [editando, setEditando] = useState<{ tipo: 'pagar' | 'receber'; itemId: string } | null>(null)
  // conciliacao-reorg-tela-v1: ancorar inbox no extrato (por lote) + aba "Sistema"
  const [modo, setModo] = useState<'extrato' | 'sistema'>('extrato')
  const [lotes, setLotes] = useState<Lote[]>([])
  const [tipoExtrato, setTipoExtrato] = useState<'bancario' | 'cartao_despesa'>('bancario')
  const [loteSelId, setLoteSelId] = useState<string | null>(null)
  const [filtroNat, setFiltroNat] = useState<'todos' | 'debito' | 'credito'>('todos')
  const [pendenciasSistema, setPendenciasSistema] = useState<PendenciaSistema[]>([])
  const [loadingSistema, setLoadingSistema] = useState(false)
  const [autoGlobal, setAutoGlobal] = useState(false)
  const [aplicandoIds, setAplicandoIds] = useState<Set<string>>(new Set())
  const [conciliandoLote, setConciliandoLote] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [arquivando, setArquivando] = useState<Item | null>(null)
  const [vinculandoVarios, setVinculandoVarios] = useState<Item | null>(null)
  const [pesquisandoConta, setPesquisandoConta] = useState<Item | null>(null)
  // conciliacao-ajuste-diferenca-no-conciliar-v1
  const [ajuste, setAjuste] = useState<null | {
    lancamentoId: string
    tipo: 'pagar' | 'receber'
    valorOriginal: number
    valorBanco: number
    descricao?: string
    aplicar: () => Promise<void>
  }>(null)
  // conciliacao-tela-sugestoes-acoes-v1: top-N sugestoes via fn_conciliacao_sugerir_match
  const [sugestoesPorMov, setSugestoesPorMov] = useState<Record<string, SugestaoMatch[]>>({})
  const [carregandoSug, setCarregandoSug] = useState<Set<string>>(new Set())
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  // ONDA-A-IMPORTADOR-OFX-v1
  const [showImport, setShowImport] = useState(false)
  // Sincronizar extrato direto do banco (Sicoob-agnostic) — puxa via API
  const [sincExtratoBusy, setSincExtratoBusy] = useState(false)
  const [contas, setContas] = useState<{ id: string; nome: string | null; banco: string | null }[]>([])
  const [contaImportId, setContaImportId] = useState<string>('')
  const [arquivoOFX, setArquivoOFX] = useState<File | null>(null)
  const [importando, setImportando] = useState(false)

  async function carregar() {
    if (!empresaUnica) return
    if (!loteSelId) { setItems([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_conciliacao_inbox', {
      p_lote_id: loteSelId,
      p_company_id: empresaUnica,
      p_status: 'pendente',
      p_limite: 200,
    })
    if (error) setErro(error.message)
    setItems((data ?? []) as Item[])
    setLoading(false)
  }

  // fix-conciliacao-pendentes-filtro-lote-v1: trocar tipo Banco/Cartao reseta lote
  function trocarTipo(t: 'bancario' | 'cartao_despesa') {
    setTipoExtrato(t)
    setLoteSelId(lotes.find((l) => l.tipo === t)?.id ?? null)
  }

  async function carregarLotes(seletor?: (lst: Lote[]) => Lote | undefined) {
    if (!empresaUnica) return
    const { data } = await supabase
      .from('conciliacao_lote')
      .select('id,nome,tipo,periodo_inicio,periodo_fim,total_movimentos,total_conciliados,total_pendentes,created_at')
      .eq('company_id', empresaUnica)
      .order('created_at', { ascending: false })
    const lst = (data ?? []) as Lote[]
    setLotes(lst)
    if (seletor) {
      const escolhido = seletor(lst)
      if (escolhido) setLoteSelId(escolhido.id)
    } else if (loteSelId == null || !lst.some((l) => l.id === loteSelId)) {
      const primeiroDoTipo = lst.find((l) => l.tipo === tipoExtrato)
      setLoteSelId(primeiroDoTipo?.id ?? lst[0]?.id ?? null)
    }
  }

  async function carregarPendenciasSistema() {
    if (!empresaUnica) return
    setLoadingSistema(true)
    const loteSel = lotes.find((l) => l.id === loteSelId)
    const ini = loteSel?.periodo_inicio ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
    const fim = loteSel?.periodo_fim ?? null
    const { data, error } = await supabase.rpc('fn_conciliacao_pendencias_sistema', {
      p_company_id: empresaUnica,
      p_natureza: filtroNat === 'todos' ? null : filtroNat,
      p_data_ini: ini,
      p_data_fim: fim,
      p_limite: 200,
    })
    if (!error) setPendenciasSistema((data ?? []) as PendenciaSistema[])
    setLoadingSistema(false)
  }

  async function carregarConciliados() {
    if (!empresaUnica) return
    const { data, error } = await supabase.rpc('fn_conciliacao_conciliados', {
      p_company_id: empresaUnica,
      p_limite: 500,
    })
    if (!error) setConciliados((data ?? []) as Conciliado[])
  }

  async function carregarConfig() {
    if (!empresaUnica) return
    const { data } = await supabase
      .from('erp_conciliacao_config')
      .select('auto_conciliar_global')
      .eq('company_id', empresaUnica)
      .maybeSingle()
    setAutoGlobal(data?.auto_conciliar_global ?? false)
  }

  async function carregarContas() {
    if (!empresaUnica) return
    const { data } = await supabase
      .from('erp_banco_contas')
      .select('id,nome,banco')
      .eq('company_id', empresaUnica)
      .eq('ativo', true)
      .order('nome')
    setContas(data ?? [])
  }

  async function sincronizarExtratoAgora() {
    if (!empresaUnica || sincExtratoBusy) return
    setSincExtratoBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/banco/extrato/sync', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          authorization: session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ company_id: empresaUnica }),
      })
      const j = await r.json()
      if (!j.ok) { alert(j.erro || 'Nao foi possivel sincronizar o extrato.'); return }
      const ins = Number(j.inseridos ?? 0)
      const ign = Number(j.ignorados ?? 0)
      const sug = Number(j.sugestoes ?? 0)
      alert(`Extrato SINCRONIZOU. ${ins} novo(s) movimento(s), ${ign} ignorado(s) (ja existiam). ${sug} sugestao(oes) geradas.`)
      // Recarregar lista de lotes/movimentos
      window.location.reload()
    } catch (e) {
      alert(`Falha ao sincronizar: ${(e as Error).message || 'erro de rede'}`)
    } finally {
      setSincExtratoBusy(false)
    }
  }

  async function importarOFX() {
    if (!empresaUnica || !contaImportId || !arquivoOFX) {
      alert('Escolha a conta e o arquivo OFX.')
      return
    }
    setImportando(true)
    try {
      const text = await arquivoOFX.text()
      const movimentos = parseOFX(text)
      if (movimentos.length === 0) {
        alert('Nenhuma transação encontrada no arquivo OFX.')
        setImportando(false)
        return
      }
      const hash = `${text.length}-${movimentos[0]?.id_externo ?? ''}-${movimentos[movimentos.length - 1]?.id_externo ?? ''}`
      const { data, error } = await supabase.rpc('fn_conciliacao_criar_lote', {
        p_company_id: empresaUnica,
        p_tipo: 'bancario',
        p_origem: 'ofx',
        p_nome: arquivoOFX.name,
        p_arquivo_nome: arquivoOFX.name,
        p_arquivo_hash: hash,
        p_storage_path: null,
        p_movimentos: movimentos,
        p_conta_bancaria_id: contaImportId,
      })
      if (error) throw error
      const r = (data ?? {}) as { sucesso?: boolean; erro?: string; total_movimentos?: number; lote_id?: string }
      if (r.sucesso === false) throw new Error(r.erro ?? 'Falha ao criar lote')
      alert(`IMPORTOU ${r.total_movimentos ?? movimentos.length} movimento(s) do extrato. Já estão na conciliação.`)
      setShowImport(false)
      setArquivoOFX(null)
      setContaImportId('')
      // re-carrega lotes e seleciona o novo
      await carregarLotes((lst) =>
        r.lote_id ? lst.find((l) => l.id === r.lote_id) : lst[0],
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      alert('Erro ao importar OFX: ' + msg)
    } finally {
      setImportando(false)
    }
  }

  async function toggleAutoGlobal(v: boolean) {
    if (!empresaUnica) return
    setAutoGlobal(v)
    const { error } = await supabase.from('erp_conciliacao_config').upsert({
      company_id: empresaUnica,
      auto_conciliar_global: v,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      setErro('Erro ao salvar preferência: ' + error.message)
      setAutoGlobal(!v)
    }
  }

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void carregarLotes()
    void carregarConfig()
    void carregarContas()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [empresaUnica])

  useEffect(() => {
    // quando troca o tipo de extrato, escolher o 1o lote daquele tipo
    if (lotes.length === 0) return
    const sel = lotes.find((l) => l.tipo === tipoExtrato)
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setLoteSelId(sel?.id ?? null)
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tipoExtrato])

  useEffect(() => {
    if (modo !== 'extrato') return
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void carregar()
    void carregarConciliados()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [loteSelId, modo])

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    if (modo === 'sistema') void carregarPendenciasSistema()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [modo, filtroNat, loteSelId])

  const filtrados = useMemo(() => {
    let base = soOuro ? items.filter((i) => (i.sugestao_score ?? 0) >= 0.8) : items
    if (filtroNatExtrato !== 'todos') base = base.filter((i) => i.natureza === filtroNatExtrato)
    const q = busca.trim().toLowerCase()
    if (q) base = base.filter((i) =>
      (i.descricao ?? '').toLowerCase().includes(q) ||
      fmt(i.valor).includes(q) || String(i.valor ?? '').includes(q))
    return base
  }, [items, soOuro, filtroNatExtrato, busca])

  // conciliacao-ajuste-diferenca-no-conciliar-v1: tolerancia 1 centavo
  const TOL_DIF = 0.01
  function conciliarComAjuste(p: {
    valorBanco: number
    valorLancamento: number
    lancamentoId: string
    lancamentoTabela: string
    descricao?: string
    aplicar: () => Promise<void>
  }) {
    if (Math.abs(p.valorBanco - p.valorLancamento) <= TOL_DIF) {
      void p.aplicar()
      return
    }
    setAjuste({
      lancamentoId: p.lancamentoId,
      tipo: p.lancamentoTabela === 'erp_receber' ? 'receber' : 'pagar',
      valorOriginal: p.valorLancamento,
      valorBanco: p.valorBanco,
      descricao: p.descricao,
      aplicar: p.aplicar,
    })
  }

  async function aplicarMatch(it: Item) {
    if (!it.sugestao_lancamento_tabela || !it.sugestao_lancamento_id) return
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }
    const lancTabela = it.sugestao_lancamento_tabela
    const lancId = it.sugestao_lancamento_id

    conciliarComAjuste({
      valorBanco: Math.abs(Number(it.valor) || 0),
      valorLancamento: Number(it.sugestao_valor ?? 0),
      lancamentoId: lancId,
      lancamentoTabela: lancTabela,
      descricao: it.descricao ?? undefined,
      aplicar: async () => {
        setAplicandoIds(new Set([...aplicandoIds, it.movimento_id]))
        const { error } = await supabase.rpc('fn_conciliacao_aplicar_match', {
          p_movimento_id: it.movimento_id,
          p_lancamento_tabela: lancTabela,
          p_lancamento_id: lancId,
          p_operador_id: operadorId,
          p_origem: 'manual',
        })
        if (error) setErro(error.message)
        await carregar()
        const ns = new Set(aplicandoIds); ns.delete(it.movimento_id); setAplicandoIds(ns)
      },
    })
  }

  async function rejeitar(it: Item) {
    if (!it.sugestao_lancamento_tabela || !it.sugestao_lancamento_id) return
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }

    setAplicandoIds(new Set([...aplicandoIds, it.movimento_id]))
    const { error } = await supabase.rpc('fn_conciliacao_rejeitar_sugestao', {
      p_movimento_id: it.movimento_id,
      p_lancamento_tabela: it.sugestao_lancamento_tabela,
      p_lancamento_id: it.sugestao_lancamento_id,
      p_operador_id: operadorId,
    })
    if (error) setErro(error.message)
    await carregar()
    const ns = new Set(aplicandoIds); ns.delete(it.movimento_id); setAplicandoIds(ns)
  }

  // conciliacao-tela-sugestoes-acoes-v1: top-N sugestoes (cached por mov)
  async function carregarSugestoes(movId: string) {
    if (sugestoesPorMov[movId] !== undefined) return
    setCarregandoSug(new Set([...carregandoSug, movId]))
    const { data, error } = await supabase.rpc('fn_conciliacao_sugerir_match', {
      p_movimento_id: movId,
      p_max_sugestoes: 5,
    })
    if (error) {
      setErro('Erro ao carregar sugestões: ' + error.message)
      setSugestoesPorMov({ ...sugestoesPorMov, [movId]: [] })
    } else {
      setSugestoesPorMov({ ...sugestoesPorMov, [movId]: (data ?? []) as SugestaoMatch[] })
    }
    const ns = new Set(carregandoSug); ns.delete(movId); setCarregandoSug(ns)
  }

  async function toggleExpandir(it: Item) {
    const ns = new Set(expandidos)
    if (ns.has(it.movimento_id)) {
      ns.delete(it.movimento_id)
    } else {
      ns.add(it.movimento_id)
      await carregarSugestoes(it.movimento_id)
    }
    setExpandidos(ns)
  }

  async function aplicarSugestao(it: Item, sug: SugestaoMatch) {
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }
    const movId = it.movimento_id

    conciliarComAjuste({
      valorBanco: Math.abs(Number(it.valor) || 0),
      valorLancamento: Number(sug.valor_lancamento ?? 0),
      lancamentoId: sug.lancamento_id,
      lancamentoTabela: sug.lancamento_tabela,
      descricao: it.descricao ?? undefined,
      aplicar: async () => {
        setAplicandoIds(new Set([...aplicandoIds, movId]))
        const { error } = await supabase.rpc('fn_conciliacao_aplicar_match', {
          p_movimento_id: movId,
          p_lancamento_tabela: sug.lancamento_tabela,
          p_lancamento_id: sug.lancamento_id,
          p_operador_id: operadorId,
          p_origem: 'manual',
        })
        if (error) { setErro(error.message) }
        else {
          // limpa cache e fecha expand
          const novo = { ...sugestoesPorMov }; delete novo[movId]; setSugestoesPorMov(novo)
          const ne = new Set(expandidos); ne.delete(movId); setExpandidos(ne)
        }
        await carregar()
        await carregarConciliados()
        const ns = new Set(aplicandoIds); ns.delete(movId); setAplicandoIds(ns)
      },
    })
  }

  async function rejeitarSugestao(movId: string, sug: SugestaoMatch) {
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }
    const { error } = await supabase.rpc('fn_conciliacao_rejeitar_sugestao', {
      p_movimento_id: movId,
      p_lancamento_tabela: sug.lancamento_tabela,
      p_lancamento_id: sug.lancamento_id,
      p_operador_id: operadorId,
    })
    if (error) { setErro(error.message); return }
    // remove a sugestao da lista local
    setSugestoesPorMov({
      ...sugestoesPorMov,
      [movId]: (sugestoesPorMov[movId] ?? []).filter((s) => !(s.lancamento_id === sug.lancamento_id && s.lancamento_tabela === sug.lancamento_tabela)),
    })
  }

  function abrirNovaConta(it: Item) {
    // natureza credito => receita (a receber) · debito => despesa (a pagar)
    const tipo = it.natureza === 'credito' ? 'receita' : 'despesa'
    const params = new URLSearchParams({
      valor: String(Math.abs(Number(it.valor) || 0)),
      data: it.data_transacao,
      descricao: it.descricao ?? '',
      origem_conciliacao: it.movimento_id,
    })
    router.push(`/dashboard/financeiro/nova-${tipo}?${params.toString()}`)
  }

  function pesquisarConta(it: Item) {
    // fix-picker-reverso-v1: abre modal inline com titulos compativeis
    // (fluxo REVERSO — movimento -> titulo). Ao selecionar, chama
    // fn_conciliacao_aplicar_match; trigger dispara a baixa.
    setPesquisandoConta(it)
  }

  // ONDA-A-INBOX-SELO-v1: agora usa fn_conciliacao_rodar_lote (blindado anti-colisao)
  // em vez de loop client-side. Override manual: auto=true, score>=80 (cobre OURO).
  async function aplicarTodosOuro() {
    const companyId = empresaUnica
    if (!companyId) return
    if (!confirm('AUTO: conciliar automaticamente os matches perfeitos (score ≥ 90)? Movimentos em disputa ficam pra revisão manual.')) return
    setConciliandoLote(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_conciliacao_rodar_lote', {
        p_company_id: companyId,
        p_lote_id: loteSelId,
        p_auto_aplicar: true,
        p_score_auto: 90,
      })
      if (error) throw error
      const r = (data ?? {}) as {
        auto_conciliados?: number
        colisao_pulada?: number
      }
      alert(`CONCILIOU ${r.auto_conciliados ?? 0} movimento(s) automaticamente. ${r.colisao_pulada ?? 0} em disputa ficaram pra revisão manual.`)
      await carregar()
      await carregarConciliados()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErro('Erro ao conciliar em lote: ' + msg)
    } finally {
      setConciliandoLote(false)
    }
  }

  async function desvincularConciliado(c: Conciliado) {
    // Antes retornava em silêncio quando não havia vínculo de título (ex.: movimento
    // conciliado com lancamento_tabela NULL) — o botão "não fazia nada" e parecia bug.
    // Agora avisa em vez de virar no-op silencioso.
    if (!c.lancamento_id || !c.lancamento_tabela) {
      setErro('Este movimento não tem vínculo de título para desfazer. Use "Arquivar" na aba Pendentes se precisar removê-lo.')
      return
    }
    if (!confirm(`Desvincular este lançamento conciliado? O movimento volta para pendente.`)) return
    // fn_conciliacao_desvincular(p_lancamento_id uuid, p_tipo text)
    // p_tipo espera 'pagar'/'receber' — c.lancamento_tabela vem como 'erp_pagar'/'erp_receber',
    // então tira o prefixo (antes ia "erp_pagar" e a RPC devolvia tipo_invalido em silêncio).
    const { data, error } = await supabase.rpc('fn_conciliacao_desvincular', {
      p_lancamento_id: c.lancamento_id,
      p_tipo: c.lancamento_tabela.replace(/^erp_/, ''),
    })
    if (error) { setErro('Erro ao desvincular: ' + error.message); return }
    // a RPC retorna {sucesso:false, erro} sem erro SQL — antes era engolido
    const r = (data ?? {}) as { sucesso?: boolean; erro?: string }
    if (r.sucesso === false) { setErro('Não desvinculou: ' + (r.erro ?? 'erro desconhecido')); return }
    await carregarConciliados()
    await carregar()
  }

  if (!empresaUnica) {
    return <div style={infoBox}>Selecione uma empresa para ver a inbox.</div>
  }

  const qtdOuro = items.filter((i) => (i.sugestao_score ?? 0) >= 0.8).length
  const lotesDoTipo = lotes.filter((l) => l.tipo === tipoExtrato)
  const loteSel = lotes.find((l) => l.id === loteSelId) ?? null
  const conciliadosLote = loteSelId
    ? conciliados.filter((c) => c.lote_id === loteSelId)
    : conciliados
  const pctFech = loteSel && loteSel.total_movimentos
    ? Math.round(100 * (loteSel.total_conciliados ?? 0) / loteSel.total_movimentos)
    : 0
  // fix-conciliacao-pendentes-filtro-lote-v1: contadores por lote, nao global
  const totPend = loteSel?.total_pendentes ?? items.length
  const totConc = loteSel?.total_conciliados ?? conciliadosLote.length
  // Camada1/Fatia1 (08/07): indicadores aditivos da conciliacao
  const valorPendente = items.reduce((s, i) => s + Math.abs(Number(i.valor) || 0), 0)      // item 1
  const qtdReceb = items.filter((i) => i.natureza === 'credito').length                     // item 4
  const qtdPag = items.filter((i) => i.natureza === 'debito').length
  const ultimoLancamento = [...items.map((i) => i.data_transacao), ...conciliadosLote.map((c) => c.data_transacao)]
    .filter(Boolean).sort().slice(-1)[0] ?? null                                            // item 3
  const ultimaAtualizacao = conciliadosLote.map((c) => c.conciliado_em).filter(Boolean).sort().slice(-1)[0] ?? null
  const qBusca = busca.trim().toLowerCase()                                                  // item 2 (conciliados)
  const conciliadosView = qBusca
    ? conciliadosLote.filter((c) =>
        (c.descricao ?? '').toLowerCase().includes(qBusca) ||
        (c.contraparte ?? '').toLowerCase().includes(qBusca) ||
        fmt(c.valor).includes(qBusca))
    : conciliadosLote

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/financeiro/conciliacao')} style={backLink}>
          ← Conciliação
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
              Conciliação
            </h1>
            <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>
              {modo === 'extrato'
                ? `${totPend} pendentes · ${qtdOuro} com match OURO (score ≥ 0.8)`
                : `${pendenciasSistema.length} pendências no sistema (não vinculadas ao extrato)`}
            </p>
          </div>
          {modo === 'extrato' && qtdOuro > 0 && aba === 'pendentes' && (
            <button onClick={aplicarTodosOuro} disabled={conciliandoLote} style={primaryBtnLoad(conciliandoLote)}>
              {conciliandoLote ? 'Conciliando…' : `⚡ AUTO (${qtdOuro})`}
            </button>
          )}
        </div>

        {/* conciliacao-reorg-tela-v1: tabs de modo (Extrato | Sistema) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setModo('extrato')} style={modo === 'extrato' ? tabActive : tabInactive}>
            🧾 Conciliação do Extrato
          </button>
          <button onClick={() => setModo('sistema')} style={modo === 'sistema' ? tabActive : tabInactive}>
            📥 Pendências do Sistema
          </button>
        </div>

        {modo === 'extrato' && (
          <>
            {/* tipo de extrato + seletor de lote + placar */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => trocarTipo('bancario')}
                style={{
                  background: tipoExtrato === 'bancario' ? '#3D2314' : '#FAF7F2',
                  color: tipoExtrato === 'bancario' ? '#FAF7F2' : '#3D2314',
                  border: '0.5px solid rgba(61,35,20,0.2)', padding: '6px 14px', borderRadius: 20,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >🏦 Banco</button>
              <button
                onClick={() => trocarTipo('cartao_despesa')}
                style={{
                  background: tipoExtrato === 'cartao_despesa' ? '#3D2314' : '#FAF7F2',
                  color: tipoExtrato === 'cartao_despesa' ? '#FAF7F2' : '#3D2314',
                  border: '0.5px solid rgba(61,35,20,0.2)', padding: '6px 14px', borderRadius: 20,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >💳 Cartão</button>
            </div>
            <select
              value={loteSelId ?? ''}
              onChange={(e) => setLoteSelId(e.target.value || null)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E7DED3', fontSize: 13, background: '#FFF', color: '#3D2314', marginBottom: 12, fontFamily: 'inherit' }}
            >
              {lotesDoTipo.length === 0 && <option value="">Nenhum lote {tipoExtrato === 'bancario' ? 'bancário' : 'de cartão'} importado</option>}
              {lotesDoTipo.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome ?? '(sem nome)'} — {l.total_conciliados ?? 0}/{l.total_movimentos ?? 0} ok
                </option>
              ))}
            </select>

            {loteSel && (
              <div style={{ background: '#FAF7F2', border: '0.5px solid #E7DED3', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>
                  Extrato {loteSel.nome ?? '—'}
                  {loteSel.periodo_inicio && <> · {fmtDate(loteSel.periodo_inicio)} a {fmtDate(loteSel.periodo_fim)}</>}
                </div>
                <div style={{ fontSize: 12, color: '#3D2314', marginTop: 4 }}>
                  <b style={{ color: '#C8941A' }}>{loteSel.total_conciliados ?? 0}</b> de {loteSel.total_movimentos ?? 0} conciliados
                  {(loteSel.total_pendentes ?? 0) > 0
                    ? <> · faltam <b>{loteSel.total_pendentes}</b></>
                    : <> · ✅ extrato fechado</>}
                </div>
                <div style={{ height: 8, borderRadius: 4, marginTop: 8, background: '#E7DED3', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pctFech}%`, background: '#C8941A', transition: 'width 0.2s' }} />
                </div>
              </div>
            )}
          </>
        )}

        {modo === 'extrato' && (<>
        {/* Toggles agrupados, alinhados a direita */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', marginBottom: 16, fontSize: 13, color: '#3D2314' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoGlobal} onChange={(e) => void toggleAutoGlobal(e.target.checked)} />
            Auto-conciliar OURO desta empresa (perfeitos 1:1 entram sozinhos)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', cursor: 'pointer' }}>
            <input type="checkbox" checked={soOuro} onChange={(e) => setSoOuro(e.target.checked)} />
            Mostrar só matches OURO
          </label>
        </div>

        {/* Abas + botao Importar OFX */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setAba('pendentes')}
            style={aba === 'pendentes' ? tabActive : tabInactive}
          >Pendentes ({totPend})</button>
          <button
            onClick={() => setAba('conciliados')}
            style={aba === 'conciliados' ? tabActive : tabInactive}
          >Conciliados ({totConc})</button>
          <button
            onClick={sincronizarExtratoAgora}
            disabled={sincExtratoBusy || !empresaUnica}
            style={{
              marginLeft: 'auto', padding: '6px 12px',
              background: sincExtratoBusy || !empresaUnica ? 'rgba(200,148,26,0.4)' : '#C8941A',
              color: '#3D2314', border: 'none', borderRadius: 6,
              fontSize: 12, fontWeight: 700,
              cursor: sincExtratoBusy ? 'wait' : !empresaUnica ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={empresaUnica ? 'Puxa o extrato direto do banco (Sicoob)' : 'Selecione uma empresa'}
            data-testid="inbox-sincronizar-extrato"
          >{sincExtratoBusy ? 'Sincronizando…' : '↻ Sincronizar extrato agora'}</button>
          <button
            onClick={() => setShowImport((v) => !v)}
            style={{ ...tabInactive, borderStyle: 'dashed' }}
            data-testid="inbox-importar-ofx"
          >+ Importar extrato (OFX)</button>
        </div>

        {/* Camada1/Fatia1: barra de indicadores (item 1 valor pendente + item 3 datas) */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Valor pendente de conciliação</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: valorPendente > 0 ? '#C8941A' : '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>
              R$ {fmt(valorPendente)} <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(61,35,20,0.55)' }}>· {totPend} movimento(s)</span>
            </div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 11, color: 'rgba(61,35,20,0.6)' }}>
            <div>Última atualização: <b>{ultimaAtualizacao ? fmtBR(ultimaAtualizacao) : '—'}</b></div>
            <div>Último lançamento: <b>{ultimoLancamento ? fmtDate(ultimoLancamento) : '—'}</b></div>
          </div>
        </div>

        {/* Camada1/Fatia1: busca (item 2) */}
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Pesquise descrição ou valor…"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E7DED3', fontSize: 13, background: '#FFF', color: '#3D2314', marginBottom: 12, fontFamily: 'inherit' }}
          data-testid="inbox-busca"
        />

        {/* Camada1/Fatia1: contadores por natureza (item 4) — filtram a aba Pendentes */}
        {aba === 'pendentes' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {([
              ['todos', `Todos (${items.length})`],
              ['credito', `Recebimentos (${qtdReceb})`],
              ['debito', `Pagamentos (${qtdPag})`],
            ] as const).map(([n, label]) => (
              <button
                key={n}
                onClick={() => setFiltroNatExtrato(n)}
                style={{
                  background: filtroNatExtrato === n ? '#3D2314' : '#FAF7F2',
                  color: filtroNatExtrato === n ? '#FAF7F2' : '#3D2314',
                  border: '0.5px solid rgba(61,35,20,0.2)', padding: '6px 14px', borderRadius: 20,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >{label}</button>
            ))}
          </div>
        )}

        {/* Painel: Importar OFX */}
        {showImport && (
          <div style={{ border: '1px solid #E3D9CC', borderRadius: 8, padding: 16, marginBottom: 16, background: '#FAF7F2' }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#3D2314' }}>Importar extrato bancário (.ofx)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select
                value={contaImportId}
                onChange={(e) => setContaImportId(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid #E3D9CC', borderRadius: 6, fontSize: 13, background: '#FFF', color: '#3D2314' }}
              >
                <option value="">Selecione a conta bancária…</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome ?? '(sem nome)'}{c.banco ? ` · ${c.banco}` : ''}
                  </option>
                ))}
              </select>
              <input
                type="file"
                accept=".ofx,application/x-ofx,text/plain"
                onChange={(e) => setArquivoOFX(e.target.files?.[0] ?? null)}
                style={{ fontSize: 13 }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  disabled={importando}
                  onClick={() => void importarOFX()}
                  style={primaryBtnLoad(importando)}
                  data-testid="inbox-importar-confirmar"
                >
                  {importando ? 'Importando…' : 'Importar e conciliar'}
                </button>
                <button
                  onClick={() => { setShowImport(false); setArquivoOFX(null) }}
                  style={secondaryBtn(false)}
                >Cancelar</button>
              </div>
              <div style={{ fontSize: 12, color: '#7A6B5A', marginTop: 2 }}>
                Baixe o extrato em .OFX no internet banking do seu banco e suba aqui. Funciona com qualquer banco.
              </div>
            </div>
          </div>
        )}

        {erro && (
          <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
            {erro}
          </div>
        )}

        {aba === 'pendentes' ? (
          loading ? (
            <div style={emptyBox}>Carregando…</div>
          ) : filtrados.length === 0 ? (
            <div style={emptyBox}>
              <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 600, marginBottom: 6 }}>
                {items.length === 0 ? 'Inbox vazia · todos movimentos conciliados' : 'Nenhum match OURO no momento'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
                {items.length === 0 ? 'Importe um novo lote para começar.' : 'Desmarque o filtro pra ver outros.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtrados.map((it) => {
                const aplicando = aplicandoIds.has(it.movimento_id)
                const temSugestao = !!it.sugestao_lancamento_id
                const selo = seloPrecisao(scoreParaPercent(it.sugestao_score))
                return (
                  <div key={it.movimento_id} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginBottom: 4 }}>
                          {fmtDate(it.data_transacao)} · {it.lote_nome ?? '—'} · {it.natureza ?? '—'}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', marginBottom: 6, wordBreak: 'break-word' }}>
                          {it.descricao ?? '(sem descrição)'}
                        </div>
                        {(() => {
                          const v = formatarValorMovimento(it.valor, it.natureza)
                          return (
                            <div style={{ fontSize: 18, fontWeight: 600, color: v.cor, fontVariantNumeric: 'tabular-nums' }}>
                              {v.texto}
                            </div>
                          )
                        })()}
                      </div>

                      <div style={{ flex: 1, minWidth: 200, borderLeft: '1px solid rgba(61,35,20,0.08)', paddingLeft: 16 }}>
                        {temSugestao && (
                          <span style={{ display: 'inline-block', background: selo.bg, color: selo.cor, padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                            {selo.emoji} {selo.label} · {scoreParaPercent(it.sugestao_score)}%
                          </span>
                        )}
                        {/* dupla-identificacao-v1: selo de qualidade (dupla identificação) */}
                        {(() => {
                          const bq = badgeQualidade(it.sugestao_qualidade, it.sugestao_qtd_candidatos)
                          return bq ? (
                            <span style={{ display: 'inline-block', marginLeft: 6, background: bq.bg, color: bq.cor, padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                              {bq.label}
                            </span>
                          ) : null
                        })()}
                        {temSugestao ? (
                          <>
                            <div style={{ fontSize: 13, color: '#3D2314', marginBottom: 2 }}>
                              {it.sugestao_contraparte ?? '(sem contraparte)'}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                              {it.sugestao_categoria ?? '—'} · {fmtDate(it.sugestao_data)} · R$ {fmt(it.sugestao_valor)}
                            </div>
                            <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.45)', marginTop: 4 }}>
                              origem: {it.sugestao_lancamento_tabela}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
                            Sem sugestão automática. Conciliar manualmente.
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button onClick={() => setArquivando(it)} disabled={aplicando} style={secondaryBtn(aplicando)}>
                        ✕ Arquivar
                      </button>
                      <button onClick={() => void toggleExpandir(it)} disabled={aplicando} style={secondaryBtn(aplicando)} data-testid="conc-toggle-expand">
                        {expandidos.has(it.movimento_id) ? '▲ Recolher' : '▼ Ver opções'}
                      </button>
                      {temSugestao && (
                        it.sugestao_qualidade === 'ambiguo' ? (
                          // Empate: nunca concilia no escuro. Só permite ESCOLHER entre os candidatos.
                          <button
                            onClick={() => void toggleExpandir(it)}
                            disabled={aplicando}
                            style={primaryBtnLoad(aplicando)}
                            data-testid="conc-escolher-ambiguo"
                            title="Há mais de um título com este mesmo valor e data. Escolha o correto."
                          >
                            ⚖️ Escolher entre {it.sugestao_qtd_candidatos ?? 2}
                          </button>
                        ) : (
                          <>
                            <button onClick={() => rejeitar(it)} disabled={aplicando} style={secondaryBtn(aplicando)}>
                              Não é essa
                            </button>
                            <button onClick={() => aplicarMatch(it)} disabled={aplicando} style={primaryBtnLoad(aplicando)}>
                              {aplicando ? 'Conciliando…' : (it.sugestao_qualidade === 'revisar' ? 'Confirmar e conciliar' : 'Conciliar')}
                            </button>
                          </>
                        )
                      )}
                    </div>

                    {/* conciliacao-tela-sugestoes-acoes-v1: painel expand · top-N sugestoes + acoes */}
                    {expandidos.has(it.movimento_id) && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed rgba(61,35,20,0.15)' }}>
                        {carregandoSug.has(it.movimento_id) ? (
                          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', padding: 8 }}>Buscando sugestões…</div>
                        ) : (
                          <>
                            {(sugestoesPorMov[it.movimento_id] ?? []).length > 0 && (
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(61,35,20,0.65)', marginBottom: 8 }}>
                                Opções rankeadas:
                              </div>
                            )}
                            {(sugestoesPorMov[it.movimento_id] ?? []).map((sug) => {
                              const seloSug = seloPrecisao(sug.match_score)
                              return (
                                <div key={`${sug.lancamento_tabela}:${sug.lancamento_id}`} style={{
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  gap: 10, padding: '8px 10px', background: '#FAF7F2', borderRadius: 6, marginBottom: 6, flexWrap: 'wrap',
                                }}>
                                  <div style={{ flex: 1, minWidth: 200 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                      <span style={{ background: seloSug.bg, color: seloSug.cor, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                        {seloSug.emoji} {seloSug.label} · {Math.round(Number(sug.match_score ?? 0))}
                                      </span>
                                      <span style={{ fontSize: 13, fontWeight: 600, color: '#3D2314' }}>
                                        {sug.contraparte ?? sug.descricao_lancamento ?? '(sem nome)'}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                                      {sug.lancamento_tabela} · venc {fmtDate(sug.data_lancamento)} · R$ {fmt(sug.valor_lancamento)}
                                    </div>
                                    {sug.descricao_lancamento && (
                                      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.5)', marginTop: 2, wordBreak: 'break-word' }}>
                                        {sug.descricao_lancamento}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => void rejeitarSugestao(it.movimento_id, sug)} disabled={aplicando} style={secondaryBtn(aplicando)}>Não é essa</button>
                                    <button onClick={() => void aplicarSugestao(it, sug)} disabled={aplicando} style={primaryBtnLoad(aplicando)}>Conciliar</button>
                                  </div>
                                </div>
                              )
                            })}
                            {(sugestoesPorMov[it.movimento_id] ?? []).length === 0 && (
                              <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', padding: 8 }}>
                                Sem sugestões automáticas pra este movimento. Use os botões abaixo:
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                              <button onClick={() => abrirNovaConta(it)} disabled={aplicando} style={primaryBtnLoad(aplicando)} data-testid="conc-nova-conta">
                                ➕ Incluir nova conta a {it.natureza === 'credito' ? 'receber' : 'pagar'}
                              </button>
                              <button onClick={() => pesquisarConta(it)} disabled={aplicando} style={secondaryBtn(aplicando)} data-testid="conc-pesquisar">
                                🔍 Pesquisar conta existente
                              </button>
                              <button onClick={() => setVinculandoVarios(it)} disabled={aplicando} style={secondaryBtn(aplicando)} data-testid="conc-vincular-varios">
                                🔗 Vincular vários (fatura)
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : (
          /* Aba CONCILIADOS */
          conciliadosView.length === 0 ? (
            <div style={emptyBox}>
              <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 600, marginBottom: 6 }}>
                {qBusca ? 'Nenhum conciliado bate com a busca' : 'Nenhum movimento conciliado ainda'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
                {qBusca ? 'Ajuste o termo pesquisado.' : 'Concilie pendentes da aba anterior para popular aqui.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {conciliadosView.map((c) => {
                const selo = seloPrecisao(c.precisao)
                const v = formatarValorMovimento(c.valor, c.natureza)
                return (
                  <div key={c.movimento_id} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginBottom: 4 }}>
                          {fmtBR(c.data_transacao)} · {c.lote_nome ?? '—'}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', marginBottom: 6, wordBreak: 'break-word' }}>
                          {c.descricao ?? '(sem descrição)'}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 600, color: v.cor, fontVariantNumeric: 'tabular-nums' }}>
                          {v.texto}
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 200, borderLeft: '1px solid rgba(61,35,20,0.08)', paddingLeft: 16 }}>
                        <span style={{ display: 'inline-block', background: selo.bg, color: selo.cor, padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                          {selo.emoji} {selo.label} · {Math.round(Number(c.precisao ?? 0))}%
                        </span>
                        <div style={{ fontSize: 13, color: '#3D2314', marginBottom: 2 }}>
                          {c.contraparte ?? '(sem contraparte)'}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                          {c.lancamento_tabela ?? '—'} · {fmtBR(c.data_lancamento)} · R$ {fmt(c.valor_lancamento)}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.45)', marginTop: 4 }}>
                          {iconeOrigem(c.match_origem)} · conciliado em {fmtBR(c.conciliado_em)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                      <button onClick={() => void desvincularConciliado(c)} style={secondaryBtn(false)}>
                        Desvincular
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
        </>)}

        {modo === 'sistema' && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {(['todos', 'debito', 'credito'] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setFiltroNat(n)}
                  style={{
                    background: filtroNat === n ? '#3D2314' : '#FAF7F2',
                    color: filtroNat === n ? '#FAF7F2' : '#3D2314',
                    border: '0.5px solid rgba(61,35,20,0.2)', padding: '6px 14px', borderRadius: 20,
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >{n === 'todos' ? 'Todos' : n === 'debito' ? 'A pagar' : 'A receber'}</button>
              ))}
            </div>

            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginBottom: 12 }}>
              {loteSel?.periodo_inicio
                ? <>Período do lote selecionado: <b>{fmtDate(loteSel.periodo_inicio)}</b> a <b>{fmtDate(loteSel.periodo_fim)}</b></>
                : <>Últimos 90 dias · selecione um lote no modo Extrato para fixar o período.</>}
            </div>

            {loadingSistema ? (
              <div style={emptyBox}>Carregando…</div>
            ) : pendenciasSistema.length === 0 ? (
              <div style={emptyBox}>
                <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 600, marginBottom: 6 }}>
                  Nenhuma pendência no período
                </div>
                <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
                  Todas as contas a {filtroNat === 'credito' ? 'receber' : filtroNat === 'debito' ? 'pagar' : 'pagar/receber'} foram conciliadas ou vinculadas.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendenciasSistema.map((p) => {
                  const v = formatarValorMovimento(p.valor, p.natureza)
                  const ehReceber = p.natureza === 'credito'
                  return (
                    <div key={`${p.tabela}:${p.id}`} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: '14px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{
                              display: 'inline-block',
                              background: ehReceber ? '#EAF3DE' : '#FCEBEB',
                              color: ehReceber ? '#3B6D11' : '#A32D2D',
                              padding: '1px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                            }}>{ehReceber ? 'A receber' : 'A pagar'}</span>
                            {p.data_vencimento && <span>venc {fmtDate(p.data_vencimento)}</span>}
                            {p.categoria && <span>· {p.categoria}</span>}
                            {p.status && <span>· {p.status}</span>}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', marginBottom: 2, wordBreak: 'break-word' }}>
                            {p.nome ?? '(sem contraparte)'}
                          </div>
                          {p.descricao && (
                            <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', wordBreak: 'break-word' }}>
                              {p.descricao}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 600, color: v.cor, fontVariantNumeric: 'tabular-nums' }}>
                          {v.texto}
                        </div>
                      </div>
                      {/* Camada1/Fatia1 item 5: editar o lançamento (linha do sistema) direto */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setEditando({ tipo: p.tabela === 'erp_receber' ? 'receber' : 'pagar', itemId: p.id })}
                          style={secondaryBtn(false)}
                          data-testid="conc-sistema-editar"
                        >✏️ Editar</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      <ArquivarMovimentoModal
        open={!!arquivando}
        onClose={() => setArquivando(null)}
        onSucesso={() => { setArquivando(null); void carregar() }}
        movimentoId={arquivando?.movimento_id ?? ''}
        descricao={arquivando ? `${arquivando.descricao ?? '(sem descrição)'} · R$ ${Math.abs(arquivando.valor).toFixed(2)}` : undefined}
      />

      {editando && empresaUnica && (
        <EditarLancamentoModal
          open
          tipo={editando.tipo}
          itemId={editando.itemId}
          companyId={empresaUnica}
          onClose={() => setEditando(null)}
          onSucesso={() => { setEditando(null); void carregarPendenciasSistema() }}
        />
      )}

      {vinculandoVarios && empresaUnica && (
        <VincularVariosModal
          movimentoId={vinculandoVarios.movimento_id}
          companyId={empresaUnica}
          valorMovimento={Number(vinculandoVarios.valor)}
          natureza={(vinculandoVarios.natureza === 'credito' ? 'credito' : 'debito')}
          descricao={vinculandoVarios.descricao}
          onClose={() => setVinculandoVarios(null)}
          onConciliado={() => { setVinculandoVarios(null); void carregar() }}
        />
      )}

      {ajuste && (
        <AjustarValoresModal
          open
          onClose={() => setAjuste(null)}
          onSucesso={() => { const a = ajuste; setAjuste(null); void a.aplicar() }}
          lancamentoId={ajuste.lancamentoId}
          tipo={ajuste.tipo}
          valorOriginal={ajuste.valorOriginal}
          valorBanco={ajuste.valorBanco}
          descricao={ajuste.descricao}
        />
      )}

      {pesquisandoConta && empresaUnica && (
        <PickerTituloExistenteModal
          open
          onClose={() => setPesquisandoConta(null)}
          onSucesso={() => { setPesquisandoConta(null); void carregar(); void carregarConciliados() }}
          companyId={empresaUnica}
          movimentoId={pesquisandoConta.movimento_id}
          movimentoDescricao={pesquisandoConta.descricao ?? '(sem descrição)'}
          movimentoValor={Math.abs(Number(pesquisandoConta.valor) || 0)}
          movimentoData={pesquisandoConta.data_transacao}
          movimentoNatureza={pesquisandoConta.natureza ?? 'debito'}
        />
      )}
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  background: '#C8941A', color: '#3D2314', border: 'none',
  padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

function primaryBtnLoad(loading: boolean): React.CSSProperties {
  return {
    ...primaryBtn,
    background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A',
    cursor: loading ? 'wait' : 'pointer',
  }
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: disabled ? 'rgba(61,35,20,0.3)' : '#3D2314',
    border: '0.5px solid rgba(61,35,20,0.2)',
    padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

const tabActive: React.CSSProperties = {
  background: '#3D2314', color: '#FAF7F2', border: 'none',
  padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

const tabInactive: React.CSSProperties = {
  background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)',
  padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 400, cursor: 'pointer',
}

const backLink: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)',
  fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16,
}

const infoBox: React.CSSProperties = {
  padding: 40, background: '#FAF7F2', minHeight: '100vh', color: '#3D2314', textAlign: 'center',
}

const emptyBox: React.CSSProperties = {
  background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8,
  padding: 48, textAlign: 'center', color: 'rgba(61,35,20,0.65)',
}
