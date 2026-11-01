'use client'

// Acervo de plantas analisadas (Takeoff).
// RD-98 p1 (PDCA): antes filtrava aps_status IN ('radiografado','traduzindo') e ESCONDIA as plantas com
// status null (DEMO Construtora tinha 4 plantas, todas null → acervo vazio apesar do dado existir).
// Agora lista TODAS as plantas não excluídas da empresa e deriva o status do dado real; com busca,
// filtro por status, ORDENAÇÃO (recente/antiga/nome/status), contagem, paginação e EXPORTAÇÃO em CSV.
// Cada card traz AÇÕES diretas: reabrir a análise no /takeoff, ver o orçamento vinculado (quando houver),
// BAIXAR o arquivo original da planta (quando há arquivo salvo) e excluir (rastreável). Mostra também QUEM
// enviou e QUEM analisou a planta.
// Click numa planta reabre no /takeoff (bridge por query param).
// Origem do dado (system_screens): erp_obra_planta (+ storage projetos-plantas para o download + public.users
// só para o nome de quem enviou/analisou).
// RD-95: "?" em busca, filtro, ordenação, exportar, contagem, autor, baixar e cada ação.

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, CheckCircle2, Loader2, UploadCloud, Search, Trash2, ArrowDownUp, FileDown, RotateCcw, Receipt, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'
const PAGINA = 12

type Estado = 'analisada' | 'processando' | 'enviada'

type PlantaAcervo = {
  id: string
  nome: string
  aps_status: 'traduzindo' | 'radiografado' | null
  analisado_em: string | null
  aps_traduzido_em: string | null
  created_at: string | null
  updated_at: string
  arquivo_tipo: string | null
  arquivo_path: string | null
  orcamento_id: string | null
  projeto_nome: string | null
  cliente_nome: string | null
  criado_por: string | null
  analisado_por: string | null
  aps_diagnostico: { n_objetos?: number; total_views?: number; layers?: unknown[] } | null
}

type Ordem = 'recente' | 'antiga' | 'nome' | 'status'
const ORDENS: { v: Ordem; l: string }[] = [
  { v: 'recente', l: 'Mais recentes' },
  { v: 'antiga', l: 'Mais antigas' },
  { v: 'nome', l: 'Nome (A–Z)' },
  { v: 'status', l: 'Status' },
]
// prioridade da ordenação por status: o que precisa de atenção primeiro
const RANK_STATUS: Record<Estado, number> = { processando: 0, enviada: 1, analisada: 2 }
const quando = (p: PlantaAcervo) => new Date(p.analisado_em ?? p.aps_traduzido_em ?? p.created_at ?? p.updated_at ?? 0).getTime()

// Estado real da planta, derivado do dado (não só do aps_status, que pode ser null em plantas legadas/seed).
function estadoDe(p: PlantaAcervo): Estado {
  if (p.aps_status === 'radiografado' || p.analisado_em) return 'analisada'
  if (p.aps_status === 'traduzindo') return 'processando'
  return 'enviada'
}
const ROTULO: Record<Estado, string> = { analisada: 'Analisada', processando: 'Processando', enviada: 'Enviada' }
const COR: Record<Estado, { bg: string; fg: string }> = {
  analisada: { bg: '#DCFCE7', fg: '#16A34A' },
  processando: { bg: '#FEF3C7', fg: '#7A5A0F' },
  enviada: { bg: '#E7EEF7', fg: '#1E5AA8' },
}

function useEmpresaSelecionada(): { companyId: string | null } {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setCompanyId(read())
    const t = setInterval(() => {
      const v = read()
      setCompanyId((prev) => (prev === v ? prev : v))
    }, 800)
    return () => clearInterval(t)
  }, [])
  return { companyId }
}

export default function AcervoTakeoffPage() {
  const { companyId } = useEmpresaSelecionada()
  const [plantas, setPlantas] = useState<PlantaAcervo[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'todas' | Estado>('todas')
  const [filtroProjeto, setFiltroProjeto] = useState<string>('todos')
  const [filtroCliente, setFiltroCliente] = useState<string>('todos')
  const [ordem, setOrdem] = useState<Ordem>('recente')
  const [pagina, setPagina] = useState(1)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)
  // nome de quem enviou/analisou (id → nome), resolvido em uma busca extra; vazio se o banco não liberar
  const [autores, setAutores] = useState<Record<string, string>>({})
  const nomeAutor = (id: string | null) => (id ? autores[id] ?? null : null)

  // Excluir planta do acervo: exclusão rastreável (soft-delete + quem + motivo + audit_log) pela RPC
  // fn_takeoff_planta_excluir, que também barra planta já confirmada (virou orçamento). A lista já filtra
  // deleted_at IS NULL, então basta remover o item localmente ao confirmar.
  const excluir = async (p: PlantaAcervo) => {
    const motivo = window.prompt(`Excluir a planta "${p.nome}"? Ela vai para a lixeira e fica auditável (quem, quando e por quê). Informe o motivo da exclusão:`)
    if (motivo === null) return
    if (motivo.trim().length < 3) { setErro('Informe o motivo da exclusão (mínimo 3 letras).'); return }
    setExcluindo(p.id); setErro(null)
    const { error } = await supabase.rpc('fn_takeoff_planta_excluir', { p_planta_id: p.id, p_motivo: motivo.trim() })
    setExcluindo(null)
    if (error) { setErro(error.message); return }
    setPlantas((prev) => prev.filter((x) => x.id !== p.id))
  }

  // Baixar o arquivo ORIGINAL da planta (o que foi enviado) direto do acervo, sem reabrir a análise.
  // Usa o mesmo bucket do Takeoff (projetos-plantas); o download respeita a RLS do storage por empresa.
  // Só aparece quando a planta tem arquivo salvo (arquivo_path). Falha de rede/arquivo → mensagem clara, sem quebrar.
  const baixar = async (p: PlantaAcervo) => {
    if (!p.arquivo_path) return
    setBaixando(p.id); setErro(null)
    const { data, error } = await supabase.storage.from('projetos-plantas').download(p.arquivo_path)
    setBaixando(null)
    if (error || !data) { setErro(error?.message ?? 'Não foi possível baixar o arquivo desta planta.'); return }
    const ext = (p.arquivo_path.split('.').pop() || p.arquivo_tipo || 'dat').toLowerCase()
    const base = (p.nome || 'planta').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'planta'
    const nomeArq = base.toLowerCase().endsWith('.' + ext) ? base : `${base}.${ext}`
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url; a.download = nomeArq; a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setLoading(true); setErro(null)
    supabase
      .from('erp_obra_planta')
      .select('id,nome,aps_status,analisado_em,aps_traduzido_em,created_at,updated_at,arquivo_tipo,arquivo_path,orcamento_id,projeto_nome,cliente_nome,criado_por,analisado_por,aps_diagnostico')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('analisado_em', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .then(({ data, error }) => {
        if (!alive) return
        setLoading(false)
        if (error) { setErro(error.message); return }
        const lista = (data as PlantaAcervo[]) ?? []
        setPlantas(lista)
        // resolve o nome de quem enviou/analisou numa busca à parte; erro/RLS → segue sem nome
        const ids = Array.from(new Set(lista.flatMap((p) => [p.criado_por, p.analisado_por]).filter((x): x is string => !!x)))
        if (ids.length) {
          void supabase.from('users').select('id,full_name').in('id', ids).then(({ data: us }) => {
            if (!alive || !us) return
            const m: Record<string, string> = {}
            for (const u of us as { id: string; full_name: string | null }[]) if (u.full_name) m[u.id] = u.full_name
            setAutores(m)
          })
        }
      })
    return () => { alive = false }
  }, [companyId])

  useEffect(() => { setPagina(1) }, [busca, filtro, filtroProjeto, filtroCliente, ordem])

  // Opções dos filtros por Projeto e por Cliente, derivadas do que o acervo realmente tem.
  const projetos = useMemo(
    () => Array.from(new Set(plantas.map((p) => p.projeto_nome).filter((x): x is string => !!x))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [plantas],
  )
  const clientes = useMemo(
    () => Array.from(new Set(plantas.map((p) => p.cliente_nome).filter((x): x is string => !!x))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [plantas],
  )

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const lista = plantas.filter((p) => {
      if (filtro !== 'todas' && estadoDe(p) !== filtro) return false
      if (filtroProjeto !== 'todos' && p.projeto_nome !== filtroProjeto) return false
      if (filtroCliente !== 'todos' && p.cliente_nome !== filtroCliente) return false
      if (!q) return true
      return [p.nome, p.projeto_nome, p.cliente_nome].some((v) => (v ?? '').toLowerCase().includes(q))
    })
    const ord = [...lista]
    if (ordem === 'nome') ord.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
    else if (ordem === 'antiga') ord.sort((a, b) => quando(a) - quando(b))
    else if (ordem === 'status') ord.sort((a, b) => RANK_STATUS[estadoDe(a)] - RANK_STATUS[estadoDe(b)] || quando(b) - quando(a))
    else ord.sort((a, b) => quando(b) - quando(a))
    return ord
  }, [plantas, busca, filtro, filtroProjeto, filtroCliente, ordem])

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGINA))
  const visiveis = filtradas.slice(0, pagina * PAGINA)
  const contagem = useMemo(() => ({
    analisada: plantas.filter((p) => estadoDe(p) === 'analisada').length,
    processando: plantas.filter((p) => estadoDe(p) === 'processando').length,
    enviada: plantas.filter((p) => estadoDe(p) === 'enviada').length,
  }), [plantas])

  // Exporta a lista FILTRADA/ordenada (o que está na tela) em CSV — abre no Excel/Sheets, sem cobrança.
  const exportarCsv = () => {
    const linhas = filtradas
    if (!linhas.length) { setErro('Nada para exportar com a busca/filtro atuais.'); return }
    const cab = ['Planta', 'Status', 'Data', 'Tipo', 'Projeto', 'Cliente', 'Tem orçamento', 'Enviada por', 'Analisada por']
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const corpo = linhas.map((p) => {
      const dt = p.analisado_em ?? p.aps_traduzido_em ?? p.created_at ?? p.updated_at
      return [
        p.nome ?? '', ROTULO[estadoDe(p)], dt ? new Date(dt).toLocaleString('pt-BR') : '',
        (p.arquivo_tipo ?? '').toUpperCase(), p.projeto_nome ?? '', p.cliente_nome ?? '',
        p.orcamento_id ? 'Sim' : 'Não', nomeAutor(p.criado_por) ?? '', nomeAutor(p.analisado_por) ?? '',
      ].map((c) => esc(String(c))).join(';')
    })
    const csv = '﻿' + [cab.map(esc).join(';'), ...corpo].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = `acervo-plantas-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (!companyId) {
    return (
      <div style={{ minHeight: '100vh', background: BG, padding: 24, color: ESP60, fontSize: 13 }}>
        Selecione uma empresa específica no topo do menu para ver as análises salvas.
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 16px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: GOLD }}>Construção · acervo</div>
            <h1 style={{ fontSize: 24, color: ESP, margin: '4px 0 0', fontFamily: 'ui-serif,Georgia,serif' }}>Plantas analisadas</h1>
            <p style={{ fontSize: 12, color: ESP60, marginTop: 4 }}>
              As análises são permanentes. Reabrir aqui não gera nova cobrança.
            </p>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Link href="/dashboard/projetos/takeoff" style={btnNova}>
              <UploadCloud size={14} /> Subir nova planta
            </Link>
            <AjudaCampo chave="hub.takeoff.acervo.nova" />
          </label>
        </header>

        {/* Barra de contagem + busca + filtro (RD-95: "?" em cada um) */}
        <div style={{ background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: ESP, fontWeight: 600 }}>
            {plantas.length} planta(s)
            <span style={{ color: ESP60, fontWeight: 400 }}>· {contagem.analisada} analisada(s) · {contagem.processando} processando · {contagem.enviada} enviada(s)</span>
            <AjudaCampo chave="hub.takeoff.acervo.total" />
          </label>
          <div style={{ flex: 1 }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: BG, border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '6px 10px' }}>
            <Search size={14} color={ESP60} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por planta, projeto ou cliente"
              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: ESP, minWidth: 180 }}
            />
            <AjudaCampo chave="hub.takeoff.acervo.busca" />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as 'todas' | Estado)}
              style={{ border: `0.5px solid ${LINE}`, background: '#FFFFFF', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: ESP, minHeight: 36 }}
            >
              <option value="todas">Todos os status</option>
              <option value="analisada">Analisada</option>
              <option value="processando">Processando</option>
              <option value="enviada">Enviada</option>
            </select>
            <AjudaCampo chave="hub.takeoff.acervo.filtro_status" />
          </label>
          {projetos.length > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <select
                value={filtroProjeto}
                onChange={(e) => setFiltroProjeto(e.target.value)}
                aria-label="Filtrar por projeto"
                data-testid="acervo-filtro-projeto"
                style={{ border: `0.5px solid ${LINE}`, background: '#FFFFFF', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: ESP, minHeight: 36, maxWidth: 180 }}
              >
                <option value="todos">Todos os projetos</option>
                {projetos.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <AjudaCampo chave="hub.takeoff.acervo.filtro_projeto" />
            </label>
          )}
          {clientes.length > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <select
                value={filtroCliente}
                onChange={(e) => setFiltroCliente(e.target.value)}
                aria-label="Filtrar por cliente"
                data-testid="acervo-filtro-cliente"
                style={{ border: `0.5px solid ${LINE}`, background: '#FFFFFF', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: ESP, minHeight: 36, maxWidth: 180 }}
              >
                <option value="todos">Todos os clientes</option>
                {clientes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <AjudaCampo chave="hub.takeoff.acervo.filtro_cliente" />
            </label>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ArrowDownUp size={14} color={ESP60} />
            <select
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as Ordem)}
              aria-label="Ordenar o acervo"
              data-testid="acervo-ordenar"
              style={{ border: `0.5px solid ${LINE}`, background: '#FFFFFF', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: ESP, minHeight: 36 }}
            >
              {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <AjudaCampo chave="hub.takeoff.acervo.ordenar" />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <button type="button" onClick={exportarCsv} data-testid="acervo-exportar" style={btnVoltar}>
              <FileDown size={14} /> Exportar
            </button>
            <AjudaCampo chave="hub.takeoff.acervo.exportar" />
          </label>
          <Link href="/dashboard/projetos/takeoff" style={btnVoltar}>
            <ArrowLeft size={14} /> Voltar ao Takeoff
          </Link>
        </div>

        {erro && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 12, borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        {loading && <div style={{ padding: 24, textAlign: 'center', color: ESP60, fontSize: 13 }}>Carregando análises...</div>}
        {!loading && plantas.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: ESP60, fontSize: 13, background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12 }}>
            Nenhuma planta enviada ainda. <Link href="/dashboard/projetos/takeoff" style={{ color: GOLD, fontWeight: 600 }}>Subir a primeira</Link>.
          </div>
        )}
        {!loading && plantas.length > 0 && filtradas.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: ESP60, fontSize: 13, background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12 }}>
            Nenhuma planta encontrada para esta busca/filtro.
          </div>
        )}

        <div style={{ display: 'grid', gap: 10 }}>
          {visiveis.map((p) => {
            const est = estadoDe(p)
            const cor = COR[est]
            const feito = est === 'analisada'
            const dt = p.analisado_em ?? p.aps_traduzido_em ?? p.created_at ?? p.updated_at
            const nObj = p.aps_diagnostico?.n_objetos
            const nLayers = Array.isArray(p.aps_diagnostico?.layers) ? p.aps_diagnostico!.layers!.length : null
            const nViews = p.aps_diagnostico?.total_views
            return (
              <div key={p.id} style={{ background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12, opacity: excluindo === p.id ? 0.5 : 1 }}>
                <Link
                  href={`/dashboard/projetos/takeoff?planta_id=${p.id}`}
                  style={{ padding: 14, textDecoration: 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, background: cor.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor.fg, flexShrink: 0,
                  }}>
                    {feito ? <CheckCircle2 size={18} /> : est === 'processando' ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: ESP, fontWeight: 600 }}>
                      <FileText size={12} style={{ verticalAlign: '-2px', marginRight: 6, color: GOLD }} />
                      {p.nome}
                    </div>
                    <div style={{ fontSize: 11, color: ESP60, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>{ROTULO[est]}{dt ? ` · ${new Date(dt).toLocaleString('pt-BR')}` : ''}</span>
                      {p.arquivo_tipo && <span>· {p.arquivo_tipo.toUpperCase()}</span>}
                      {nObj !== undefined && <span>· {nObj} objetos</span>}
                      {nLayers !== null && <span>· {nLayers} layers</span>}
                      {nViews !== undefined && <span>· {nViews} views</span>}
                      {p.orcamento_id && <span>· tem orçamento</span>}
                    </div>
                    {(p.projeto_nome || p.cliente_nome) && (
                      <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
                        {p.projeto_nome && <span>{p.projeto_nome}</span>}
                        {p.projeto_nome && p.cliente_nome && <span> · </span>}
                        {p.cliente_nome && <span>{p.cliente_nome}</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: cor.fg, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {ROTULO[est]}
                  </div>
                </Link>
                <div style={{ borderTop: `0.5px solid ${LINE}`, padding: '7px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: ESP60, display: 'inline-flex', alignItems: 'center', gap: 4 }} data-testid="acervo-autor">
                    {nomeAutor(p.criado_por) || nomeAutor(p.analisado_por) ? (
                      <>
                        {nomeAutor(p.criado_por) && <span>Enviada por {nomeAutor(p.criado_por)}</span>}
                        {nomeAutor(p.criado_por) && nomeAutor(p.analisado_por) && <span>·</span>}
                        {nomeAutor(p.analisado_por) && <span>Analisada por {nomeAutor(p.analisado_por)}</span>}
                        <AjudaCampo chave="hub.takeoff.acervo.autor" />
                      </>
                    ) : <span style={{ visibility: 'hidden' }}>—<AjudaCampo chave="hub.takeoff.acervo.autor" /></span>}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Link href={`/dashboard/projetos/takeoff?planta_id=${p.id}`} data-testid="acervo-reabrir" style={acaoLink}>
                      <RotateCcw size={13} /> Reabrir análise
                    </Link>
                    <AjudaCampo chave="hub.takeoff.acervo.reabrir" />
                    {p.orcamento_id && (
                      <>
                        <Link href={`/dashboard/orcamentos?id=${p.orcamento_id}`} data-testid="acervo-ver-orcamento" style={acaoLink}>
                          <Receipt size={13} /> Ver orçamento
                        </Link>
                        <AjudaCampo chave="hub.takeoff.acervo.ver_orcamento" />
                      </>
                    )}
                    {p.arquivo_path && (
                      <>
                        <button
                          type="button"
                          disabled={baixando === p.id}
                          onClick={() => void baixar(p)}
                          data-testid="acervo-baixar"
                          style={{ ...acaoLink, border: 'none', background: 'transparent', cursor: baixando === p.id ? 'wait' : 'pointer' }}
                        >
                          <Download size={13} /> {baixando === p.id ? 'Baixando…' : 'Baixar planta'}
                        </button>
                        <AjudaCampo chave="hub.takeoff.acervo.baixar" />
                      </>
                    )}
                    <button
                      type="button"
                      disabled={excluindo === p.id}
                      onClick={() => void excluir(p)}
                      data-testid="acervo-excluir"
                      style={{ background: 'transparent', border: 'none', color: '#B91C1C', fontSize: 12, fontWeight: 600, cursor: excluindo === p.id ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 32 }}
                    >
                      <Trash2 size={13} /> {excluindo === p.id ? 'Excluindo…' : 'Excluir'}
                    </button>
                    <AjudaCampo chave="hub.takeoff.acervo.excluir" />
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {!loading && filtradas.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <div style={{ fontSize: 11, color: ESP60, marginBottom: visiveis.length < filtradas.length ? 8 : 0 }}>
              Mostrando {visiveis.length} de {filtradas.length} planta(s)
            </div>
            {visiveis.length < filtradas.length && (
              <button onClick={() => setPagina((n) => Math.min(n + 1, totalPaginas))} style={btnMais}>
                Mostrar mais ({filtradas.length - visiveis.length})
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const btnNova: CSSProperties = {
  background: GOLD, color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 13,
  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, minHeight: 36,
}
const btnVoltar: CSSProperties = {
  background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`, padding: '7px 12px', borderRadius: 8,
  fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
}
const btnMais: CSSProperties = {
  background: '#FFFFFF', color: ESP, border: `0.5px solid ${LINE}`, padding: '9px 18px', borderRadius: 8,
  fontSize: 13, cursor: 'pointer', fontWeight: 600,
}
const acaoLink: CSSProperties = {
  background: 'transparent', color: ESP, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 32, padding: '0 6px',
}
