'use client'

// Acervo de plantas analisadas (Takeoff).
// RD-98 p1 (PDCA): antes filtrava aps_status IN ('radiografado','traduzindo') e ESCONDIA as plantas com
// status null (DEMO Construtora tinha 4 plantas, todas null → acervo vazio apesar do dado existir).
// Agora lista TODAS as plantas não excluídas da empresa e deriva o status do dado real; com busca,
// filtro por status, contagem e paginação. Click numa planta reabre no /takeoff (bridge por query param).
// Origem do dado (system_screens): erp_obra_planta. RD-95: "?" em busca, filtro, contagem e ação.

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, CheckCircle2, Loader2, UploadCloud, Search } from 'lucide-react'
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
  orcamento_id: string | null
  projeto_nome: string | null
  cliente_nome: string | null
  aps_diagnostico: { n_objetos?: number; total_views?: number; layers?: unknown[] } | null
}

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
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setLoading(true); setErro(null)
    supabase
      .from('erp_obra_planta')
      .select('id,nome,aps_status,analisado_em,aps_traduzido_em,created_at,updated_at,arquivo_tipo,orcamento_id,projeto_nome,cliente_nome,aps_diagnostico')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('analisado_em', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .then(({ data, error }) => {
        if (!alive) return
        setLoading(false)
        if (error) { setErro(error.message); return }
        setPlantas((data as PlantaAcervo[]) ?? [])
      })
    return () => { alive = false }
  }, [companyId])

  useEffect(() => { setPagina(1) }, [busca, filtro])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return plantas.filter((p) => {
      if (filtro !== 'todas' && estadoDe(p) !== filtro) return false
      if (!q) return true
      return [p.nome, p.projeto_nome, p.cliente_nome].some((v) => (v ?? '').toLowerCase().includes(q))
    })
  }, [plantas, busca, filtro])

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGINA))
  const visiveis = filtradas.slice(0, pagina * PAGINA)
  const contagem = useMemo(() => ({
    analisada: plantas.filter((p) => estadoDe(p) === 'analisada').length,
    processando: plantas.filter((p) => estadoDe(p) === 'processando').length,
    enviada: plantas.filter((p) => estadoDe(p) === 'enviada').length,
  }), [plantas])

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
              <Link
                key={p.id}
                href={`/dashboard/projetos/takeoff?planta_id=${p.id}`}
                style={{
                  background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12,
                  padding: 14, textDecoration: 'none', display: 'flex', gap: 12, alignItems: 'flex-start',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: cor.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor.fg, flexShrink: 0,
                }}>
                  {feito ? <CheckCircle2 size={18} /> : est === 'processando' ? <Loader2 size={18} /> : <FileText size={18} />}
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
            )
          })}
        </div>

        {!loading && visiveis.length < filtradas.length && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button onClick={() => setPagina((n) => Math.min(n + 1, totalPaginas))} style={btnMais}>
              Mostrar mais ({filtradas.length - visiveis.length})
            </button>
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
