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
}

interface Conciliado {
  movimento_id: string
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

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

// conciliacao-busca-faixa-valor-v1
interface BuscaLancamento {
  lancamento_tabela: 'erp_pagar' | 'erp_receber' | string
  lancamento_id: string
  data_lancamento: string | null
  valor_lancamento: number | null
  contraparte: string | null
  descricao_lancamento: string | null
  status: string | null
  ja_conciliado: boolean
}

interface BuscaState {
  valor_min: string
  valor_max: string
  termo: string
  resultados: BuscaLancamento[]
  loading: boolean
  aberta: boolean
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
  const [autoGlobal, setAutoGlobal] = useState(false)
  const [aplicandoIds, setAplicandoIds] = useState<Set<string>>(new Set())
  const [conciliandoLote, setConciliandoLote] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [arquivando, setArquivando] = useState<Item | null>(null)
  // conciliacao-tela-sugestoes-acoes-v1: top-N sugestoes via fn_conciliacao_sugerir_match
  const [sugestoesPorMov, setSugestoesPorMov] = useState<Record<string, SugestaoMatch[]>>({})
  const [carregandoSug, setCarregandoSug] = useState<Set<string>>(new Set())
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  // conciliacao-busca-faixa-valor-v1: busca por faixa de valor
  const [buscaPorMov, setBuscaPorMov] = useState<Record<string, BuscaState>>({})
  // ONDA-A-IMPORTADOR-OFX-v1
  const [showImport, setShowImport] = useState(false)
  const [contas, setContas] = useState<{ id: string; nome: string | null; banco: string | null }[]>([])
  const [contaImportId, setContaImportId] = useState<string>('')
  const [arquivoOFX, setArquivoOFX] = useState<File | null>(null)
  const [importando, setImportando] = useState(false)

  async function carregar() {
    if (!empresaUnica) return
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_conciliacao_inbox', {
      p_lote_id: null,
      p_company_id: empresaUnica,
      p_status: 'pendente',
      p_limite: 200,
    })
    if (error) setErro(error.message)
    setItems((data ?? []) as Item[])
    setLoading(false)
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
      const r = (data ?? {}) as { sucesso?: boolean; erro?: string; total_movimentos?: number }
      if (r.sucesso === false) throw new Error(r.erro ?? 'Falha ao criar lote')
      alert(`IMPORTOU ${r.total_movimentos ?? movimentos.length} movimento(s) do extrato. Já estão na conciliação.`)
      setShowImport(false)
      setArquivoOFX(null)
      setContaImportId('')
      await carregar()
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
    void carregar()
    void carregarConciliados()
    void carregarConfig()
    void carregarContas()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [empresaUnica])

  useEffect(() => {
    if (aba === 'conciliados') void carregarConciliados()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [aba])

  const filtrados = useMemo(() => {
    if (soOuro) return items.filter((i) => (i.sugestao_score ?? 0) >= 0.8)
    return items
  }, [items, soOuro])

  async function aplicarMatch(it: Item) {
    if (!it.sugestao_lancamento_tabela || !it.sugestao_lancamento_id) return
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }

    setAplicandoIds(new Set([...aplicandoIds, it.movimento_id]))
    const { error } = await supabase.rpc('fn_conciliacao_aplicar_match', {
      p_movimento_id: it.movimento_id,
      p_lancamento_tabela: it.sugestao_lancamento_tabela,
      p_lancamento_id: it.sugestao_lancamento_id,
      p_operador_id: operadorId,
      p_origem: 'manual',
    })
    if (error) setErro(error.message)
    await carregar()
    const ns = new Set(aplicandoIds); ns.delete(it.movimento_id); setAplicandoIds(ns)
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

  async function aplicarSugestao(movId: string, sug: SugestaoMatch) {
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }
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

  // conciliacao-busca-faixa-valor-v1
  function abrirBusca(it: Item, preset: 'todas' | 'manual' = 'manual') {
    const valor = Math.abs(Number(it.valor) || 0)
    const min = preset === 'todas' ? (valor * 0.85).toFixed(2) : (valor * 0.85).toFixed(2)
    const max = preset === 'todas' ? (valor * 1.15).toFixed(2) : (valor * 1.15).toFixed(2)
    const estadoAtual = buscaPorMov[it.movimento_id]
    setBuscaPorMov({
      ...buscaPorMov,
      [it.movimento_id]: {
        valor_min: estadoAtual?.valor_min ?? min,
        valor_max: estadoAtual?.valor_max ?? max,
        termo: estadoAtual?.termo ?? '',
        resultados: estadoAtual?.resultados ?? [],
        loading: false,
        aberta: true,
      },
    })
    if (preset === 'todas') {
      void rodarBusca(it, min, max, '')
    }
  }

  function fecharBusca(movId: string) {
    const estado = buscaPorMov[movId]
    if (!estado) return
    setBuscaPorMov({ ...buscaPorMov, [movId]: { ...estado, aberta: false } })
  }

  function atualizarBuscaCampo(movId: string, campo: 'valor_min' | 'valor_max' | 'termo', valor: string) {
    const estado = buscaPorMov[movId]
    if (!estado) return
    setBuscaPorMov({ ...buscaPorMov, [movId]: { ...estado, [campo]: valor } })
  }

  async function rodarBusca(it: Item, valorMinInput?: string, valorMaxInput?: string, termoInput?: string) {
    if (!empresaUnica) return
    const natureza = it.natureza === 'credito' ? 'credito' : 'debito'
    const valorRef = Math.abs(Number(it.valor) || 0)
    const estado = buscaPorMov[it.movimento_id]
    const vMin = valorMinInput ?? estado?.valor_min ?? ''
    const vMax = valorMaxInput ?? estado?.valor_max ?? ''
    const termo = termoInput ?? estado?.termo ?? ''
    setBuscaPorMov({
      ...buscaPorMov,
      [it.movimento_id]: {
        valor_min: vMin, valor_max: vMax, termo,
        resultados: estado?.resultados ?? [],
        loading: true, aberta: true,
      },
    })
    const { data, error } = await supabase.rpc('fn_conciliacao_buscar_lancamentos', {
      p_company_id: empresaUnica,
      p_natureza: natureza,
      p_valor_min: vMin ? Number(vMin) : null,
      p_valor_max: vMax ? Number(vMax) : null,
      p_termo: termo.trim() || null,
      p_valor_ref: valorRef,
      p_limite: 50,
    })
    if (error) {
      setErro('Erro na busca: ' + error.message)
      setBuscaPorMov({
        ...buscaPorMov,
        [it.movimento_id]: {
          valor_min: vMin, valor_max: vMax, termo,
          resultados: [],
          loading: false, aberta: true,
        },
      })
    } else {
      setBuscaPorMov({
        ...buscaPorMov,
        [it.movimento_id]: {
          valor_min: vMin, valor_max: vMax, termo,
          resultados: (data ?? []) as BuscaLancamento[],
          loading: false, aberta: true,
        },
      })
    }
  }

  async function vincularBuscado(movId: string, b: BuscaLancamento) {
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }
    setAplicandoIds(new Set([...aplicandoIds, movId]))
    const { error } = await supabase.rpc('fn_conciliacao_aplicar_match', {
      p_movimento_id: movId,
      p_lancamento_tabela: b.lancamento_tabela,
      p_lancamento_id: b.lancamento_id,
      p_operador_id: operadorId,
      p_origem: 'manual',
    })
    if (error) { setErro(error.message) }
    else {
      // limpa busca e expand
      const novoBusca = { ...buscaPorMov }; delete novoBusca[movId]; setBuscaPorMov(novoBusca)
      const ne = new Set(expandidos); ne.delete(movId); setExpandidos(ne)
    }
    await carregar()
    await carregarConciliados()
    const ns = new Set(aplicandoIds); ns.delete(movId); setAplicandoIds(ns)
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
        p_lote_id: null,
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
    if (!c.lancamento_id || !c.lancamento_tabela) return
    if (!confirm(`Desvincular este lançamento conciliado? O movimento volta para pendente.`)) return
    // fn_conciliacao_desvincular(p_lancamento_id uuid, p_tipo text)
    const { error } = await supabase.rpc('fn_conciliacao_desvincular', {
      p_lancamento_id: c.lancamento_id,
      p_tipo: c.lancamento_tabela,
    })
    if (error) { setErro('Erro ao desvincular: ' + error.message); return }
    await carregarConciliados()
    await carregar()
  }

  if (!empresaUnica) {
    return <div style={infoBox}>Selecione uma empresa para ver a inbox.</div>
  }

  const qtdOuro = items.filter((i) => (i.sugestao_score ?? 0) >= 0.8).length

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/financeiro/conciliacao')} style={backLink}>
          ← Conciliação
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
              Inbox · Movimentos pendentes
            </h1>
            <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>
              {items.length} pendentes · {qtdOuro} com match OURO (score ≥ 0.8)
            </p>
          </div>
          {qtdOuro > 0 && aba === 'pendentes' && (
            <button onClick={aplicarTodosOuro} disabled={conciliandoLote} style={primaryBtnLoad(conciliandoLote)}>
              {conciliandoLote ? 'Conciliando…' : `⚡ AUTO (${qtdOuro})`}
            </button>
          )}
        </div>

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
          >Pendentes ({items.length})</button>
          <button
            onClick={() => setAba('conciliados')}
            style={aba === 'conciliados' ? tabActive : tabInactive}
          >Conciliados ({conciliados.length})</button>
          <button
            onClick={() => setShowImport((v) => !v)}
            style={{ ...tabInactive, marginLeft: 'auto', borderStyle: 'dashed' }}
            data-testid="inbox-importar-ofx"
          >+ Importar extrato (OFX)</button>
        </div>

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
                        <div style={{ fontSize: 18, fontWeight: 600, color: Number(it.valor) < 0 ? '#A32D2D' : '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>
                          {Number(it.valor) < 0 ? '−' : '+'} R$ {fmt(Math.abs(it.valor))}
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 200, borderLeft: '1px solid rgba(61,35,20,0.08)', paddingLeft: 16 }}>
                        {temSugestao && (
                          <span style={{ display: 'inline-block', background: selo.bg, color: selo.cor, padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                            {selo.emoji} {selo.label} · {scoreParaPercent(it.sugestao_score)}%
                          </span>
                        )}
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
                        <>
                          <button onClick={() => rejeitar(it)} disabled={aplicando} style={secondaryBtn(aplicando)}>
                            Não é essa
                          </button>
                          <button onClick={() => aplicarMatch(it)} disabled={aplicando} style={primaryBtnLoad(aplicando)}>
                            {aplicando ? 'Conciliando…' : 'Conciliar'}
                          </button>
                        </>
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
                                      {sug.lancamento_tabela} · {fmtDate(sug.data_lancamento)} · R$ {fmt(sug.valor_lancamento)}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => void rejeitarSugestao(it.movimento_id, sug)} disabled={aplicando} style={secondaryBtn(aplicando)}>Não é essa</button>
                                    <button onClick={() => void aplicarSugestao(it.movimento_id, sug)} disabled={aplicando} style={primaryBtnLoad(aplicando)}>Conciliar</button>
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
                              <button onClick={() => abrirBusca(it, 'todas')} disabled={aplicando} style={secondaryBtn(aplicando)} data-testid="conc-ver-todas">
                                🔎 Ver todas as opções (±15%)
                              </button>
                              <button onClick={() => abrirBusca(it, 'manual')} disabled={aplicando} style={secondaryBtn(aplicando)} data-testid="conc-pesquisar">
                                🔍 Pesquisar conta existente
                              </button>
                            </div>

                            {/* conciliacao-busca-faixa-valor-v1: painel de busca por faixa */}
                            {buscaPorMov[it.movimento_id]?.aberta && (
                              <div style={{ marginTop: 10, padding: 10, background: '#FFFFFF', border: '1px solid rgba(61,35,20,0.15)', borderRadius: 6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: '#3D2314' }}>
                                    Pesquisar conta existente · {it.natureza === 'credito' ? 'A receber' : 'A pagar'}
                                  </div>
                                  <button onClick={() => fecharBusca(it.movimento_id)} style={secondaryBtn(false)} data-testid="conc-busca-voltar">
                                    ‹ Voltar
                                  </button>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                                  <label style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                                    De R$
                                    <input
                                      type="number" step="0.01" min="0"
                                      value={buscaPorMov[it.movimento_id]?.valor_min ?? ''}
                                      onChange={(e) => atualizarBuscaCampo(it.movimento_id, 'valor_min', e.target.value)}
                                      style={{ marginLeft: 4, width: 100, padding: '4px 6px', fontSize: 12, border: '1px solid rgba(61,35,20,0.2)', borderRadius: 4 }}
                                    />
                                  </label>
                                  <label style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                                    até R$
                                    <input
                                      type="number" step="0.01" min="0"
                                      value={buscaPorMov[it.movimento_id]?.valor_max ?? ''}
                                      onChange={(e) => atualizarBuscaCampo(it.movimento_id, 'valor_max', e.target.value)}
                                      style={{ marginLeft: 4, width: 100, padding: '4px 6px', fontSize: 12, border: '1px solid rgba(61,35,20,0.2)', borderRadius: 4 }}
                                    />
                                  </label>
                                  <input
                                    placeholder="Nome (opcional)"
                                    value={buscaPorMov[it.movimento_id]?.termo ?? ''}
                                    onChange={(e) => atualizarBuscaCampo(it.movimento_id, 'termo', e.target.value)}
                                    style={{ flex: 1, minWidth: 140, padding: '4px 6px', fontSize: 12, border: '1px solid rgba(61,35,20,0.2)', borderRadius: 4 }}
                                  />
                                  <button onClick={() => void rodarBusca(it)} disabled={buscaPorMov[it.movimento_id]?.loading} style={primaryBtnLoad(buscaPorMov[it.movimento_id]?.loading ?? false)}>
                                    🔎 Buscar
                                  </button>
                                </div>

                                {buscaPorMov[it.movimento_id]?.loading ? (
                                  <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', padding: 6 }}>Buscando…</div>
                                ) : (buscaPorMov[it.movimento_id]?.resultados ?? []).length === 0 ? (
                                  <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', padding: 6 }}>
                                    Nenhuma conta encontrada nessa faixa.
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
                                    {(buscaPorMov[it.movimento_id]?.resultados ?? []).map((b) => (
                                      <div key={`${b.lancamento_tabela}:${b.lancamento_id}`} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        gap: 8, padding: '6px 8px', background: '#FAF7F2', borderRadius: 4,
                                        opacity: b.ja_conciliado ? 0.55 : 1,
                                      }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#3D2314' }}>
                                            {b.contraparte ?? b.descricao_lancamento ?? '(sem nome)'}
                                            {b.ja_conciliado && (
                                              <span style={{ background: '#FBF3E0', color: '#B7791F', padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700 }}>já conciliado</span>
                                            )}
                                          </div>
                                          <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.65)' }}>
                                            {b.lancamento_tabela} · {fmtDate(b.data_lancamento)} · R$ {fmt(b.valor_lancamento)} · {b.status ?? '—'}
                                          </div>
                                        </div>
                                        <button
                                          onClick={() => void vincularBuscado(it.movimento_id, b)}
                                          disabled={aplicando || b.ja_conciliado}
                                          style={b.ja_conciliado ? secondaryBtn(true) : primaryBtnLoad(aplicando)}
                                        >
                                          Vincular
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
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
          conciliados.length === 0 ? (
            <div style={emptyBox}>
              <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 600, marginBottom: 6 }}>
                Nenhum movimento conciliado ainda
              </div>
              <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
                Concilie pendentes da aba anterior para popular aqui.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {conciliados.map((c) => {
                const selo = seloPrecisao(c.precisao)
                const valNeg = Number(c.valor) < 0 || c.natureza === 'debito'
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
                        <div style={{ fontSize: 18, fontWeight: 600, color: valNeg ? '#A32D2D' : '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>
                          {valNeg ? '−' : '+'} R$ {fmt(Math.abs(Number(c.valor)))}
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
      </div>

      <ArquivarMovimentoModal
        open={!!arquivando}
        onClose={() => setArquivando(null)}
        onSucesso={() => { setArquivando(null); void carregar() }}
        movimentoId={arquivando?.movimento_id ?? ''}
        descricao={arquivando ? `${arquivando.descricao ?? '(sem descrição)'} · R$ ${Math.abs(arquivando.valor).toFixed(2)}` : undefined}
      />
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
