'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

// ═══ TIPOS ═══
type Panorama = {
  arquivos_total: number
  arquivos_criticos: number
  arquivos_com_bug: number
  arquivos_por_tipo: Record<string, number>
  arquivos_por_categoria: Record<string, number>
  mudancas_pendentes_aprovacao: number
  mudancas_aprovadas_nao_deployadas: number
  mudancas_deployadas_30d: number
  contexto_itens_ativos: number
  contexto_criticos_abertos: number
  atualizado_em: string
}

type Contexto = {
  id: string
  projeto: string
  categoria: string
  prioridade: string
  status: string
  titulo: string
  descricao: string | null
  tags: string[] | null
  atualizado_em: string
}

type Arquivo = {
  id: string
  caminho: string
  tipo: string
  categoria_funcional: string | null
  o_que_faz: string
  observacoes: string | null
  status: string
  critico: boolean
  tem_bug_conhecido: boolean
  versao_conhecida: string | null
  tabelas_afetadas: string[] | null
  tags: string[] | null
  atualizado_em: string
}

type Mudanca = {
  id: string
  numero: number
  titulo: string
  descricao: string
  tipo_mudanca: string
  status: string
  prioridade: string
  arquivos_afetados: string[] | null
  tabelas_afetadas: string[] | null
  commit_url: string | null
  proposto_em: string
  aprovado_em: string | null
  deployado_em: string | null
  tags: string[] | null
}

type Aba = 'contexto' | 'arquivos' | 'mudancas'

// ═══ CORES ═══
const COR = {
  espresso: '#3D2314',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offWhite: '#FAF7F2',
  cream: '#F0ECE3',
  creamD: '#E8E1D3',
  border: '#E0D8CC',
  borderL: '#EDE7DA',
  gold: '#C8941A',
  goldD: '#A57A15',
  goldBg: '#FDF7E8',
  green: '#2D7A3E',
  greenBg: '#EBF3ED',
  red: '#B83B3B',
  redBg: '#F6E8E8',
  amber: '#C88A1A',
  amberBg: '#FAF0DF',
  blue: '#2C5282',
  blueBg: '#E7EDF5',
}

// ═══ PÁGINA ═══
export default function ProjetoPage() {
  const [aba, setAba] = useState<Aba>('contexto')
  const [panorama, setPanorama] = useState<Panorama | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregarPanorama = useCallback(async () => {
    const { data } = await supabase.rpc('fn_projeto_panorama')
    if (data) setPanorama(data as Panorama)
  }, [])

  useEffect(() => { 
    carregarPanorama()
    setCarregando(false)
  }, [carregarPanorama])

  if (carregando) {
    return (
      <main style={{ minHeight: '100vh', backgroundColor: COR.offWhite, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: COR.espresso }}>
        <p style={{ opacity: 0.6 }}>Carregando…</p>
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: COR.offWhite, fontFamily: 'Inter, system-ui, sans-serif', color: COR.espresso, padding: '32px 24px 64px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Cabeçalho */}
        <header style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
            PS Gestão · Administração
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 40, fontWeight: 400, margin: '4px 0 0', letterSpacing: -0.5 }}>
            Projeto ERP
          </h1>
          <p style={{ fontSize: 14, opacity: 0.6, margin: '8px 0 0' }}>
            Mapa vivo do projeto — contexto, arquivos, mudanças com workflow de aprovação.
          </p>
        </header>

        {/* Panorama — cards compactos */}
        {panorama && (
          <section style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <MiniCard titulo="Itens de contexto" valor={panorama.contexto_itens_ativos} sub={`${panorama.contexto_criticos_abertos} crítico(s) aberto(s)`} cor={COR.gold} />
            <MiniCard titulo="Arquivos catalogados" valor={panorama.arquivos_total} sub={`${panorama.arquivos_criticos} crítico(s) · ${panorama.arquivos_com_bug} com bug`} cor={COR.espresso} />
            <MiniCard titulo="Mudanças pendentes" valor={panorama.mudancas_pendentes_aprovacao} sub="aguardando aprovação" cor={panorama.mudancas_pendentes_aprovacao > 0 ? COR.red : COR.espressoL} />
            <MiniCard titulo="Aprovadas não deployadas" valor={panorama.mudancas_aprovadas_nao_deployadas} sub="prontas para deploy" cor={panorama.mudancas_aprovadas_nao_deployadas > 0 ? COR.amber : COR.espressoL} />
            <MiniCard titulo="Deploys últimos 30d" valor={panorama.mudancas_deployadas_30d} sub="em produção" cor={COR.green} />
          </section>
        )}

        {/* Abas */}
        <section style={{ marginBottom: 24, borderBottom: `2px solid ${COR.border}`, display: 'flex', gap: 0 }}>
          <TabButton ativo={aba === 'contexto'} onClick={() => setAba('contexto')} label="📋 Contexto" count={panorama?.contexto_itens_ativos} />
          <TabButton ativo={aba === 'arquivos'} onClick={() => setAba('arquivos')} label="📁 Arquivos" count={panorama?.arquivos_total} />
          <TabButton ativo={aba === 'mudancas'} onClick={() => setAba('mudancas')} label="🔄 Mudanças" count={panorama?.mudancas_pendentes_aprovacao} destaque={(panorama?.mudancas_pendentes_aprovacao || 0) > 0} />
        </section>

        {/* Conteúdo da aba */}
        {aba === 'contexto' && <AbaContexto onChange={carregarPanorama} />}
        {aba === 'arquivos' && <AbaArquivos />}
        {aba === 'mudancas' && <AbaMudancas onChange={carregarPanorama} />}
      </div>
    </main>
  )
}

// ═══════════════════════════════════════════════════
// COMPONENTES COMPARTILHADOS
// ═══════════════════════════════════════════════════

function MiniCard({ titulo, valor, sub, cor }: { titulo: string; valor: number; sub: string; cor: string }) {
  return (
    <div style={{ backgroundColor: 'white', borderRadius: 10, padding: 14, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', borderLeft: `3px solid ${cor}` }}>
      <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.55, margin: 0, color: COR.espresso }}>{titulo}</p>
      <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, margin: '2px 0 0', color: cor, lineHeight: 1 }}>{valor}</p>
      <p style={{ fontSize: 11, margin: '4px 0 0', opacity: 0.6 }}>{sub}</p>
    </div>
  )
}

function TabButton({ ativo, onClick, label, count, destaque }: { ativo: boolean; onClick: () => void; label: string; count?: number; destaque?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '14px 24px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer',
        fontSize: 14, fontWeight: ativo ? 700 : 500,
        color: ativo ? COR.espresso : COR.espressoM,
        borderBottom: `3px solid ${ativo ? COR.gold : 'transparent'}`,
        marginBottom: -2, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 700,
          backgroundColor: destaque ? COR.red : (ativo ? COR.gold : COR.cream),
          color: destaque ? 'white' : (ativo ? 'white' : COR.espressoM),
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

function TagSmall({ texto, cor, bg }: { texto: string; cor: string; bg: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, letterSpacing: 0.3, backgroundColor: bg, color: cor }}>
      {texto}
    </span>
  )
}

// ═══════════════════════════════════════════════════
// ABA: CONTEXTO
// ═══════════════════════════════════════════════════

function AbaContexto({ onChange }: { onChange: () => void }) {
  const [itens, setItens] = useState<Contexto[]>([])
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('ativo')
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_contexto_listar', {
      p_categoria: filtroCategoria || null,
      p_status: filtroStatus || null,
    })
    if (data) setItens(data as Contexto[])
  }, [filtroCategoria, filtroStatus])

  useEffect(() => { carregar() }, [carregar])

  const concluir = async (id: string) => {
    if (!confirm('Marcar este item como concluído?')) return
    await supabase.rpc('fn_contexto_concluir', { p_id: id })
    carregar()
    onChange()
  }

  const itensFiltrados = busca
    ? itens.filter(i => 
        i.titulo.toLowerCase().includes(busca.toLowerCase()) ||
        (i.descricao && i.descricao.toLowerCase().includes(busca.toLowerCase())))
    : itens

  const categorias = ['regra_operacional', 'decisao', 'pendencia', 'bug', 'credencial', 'convencao', 'descoberta', 'proximo_passo', 'contexto']
  const corCategoria: Record<string, { cor: string; bg: string; label: string }> = {
    regra_operacional: { cor: '#6a2020', bg: '#fce8e8', label: 'Regra' },
    decisao: { cor: COR.green, bg: COR.greenBg, label: 'Decisão' },
    pendencia: { cor: '#8a6a10', bg: COR.goldBg, label: 'Pendência' },
    bug: { cor: COR.red, bg: COR.redBg, label: 'Bug' },
    credencial: { cor: COR.espresso, bg: COR.cream, label: 'Credencial' },
    convencao: { cor: COR.espresso, bg: COR.creamD, label: 'Convenção' },
    descoberta: { cor: COR.gold, bg: COR.goldBg, label: 'Descoberta' },
    proximo_passo: { cor: COR.green, bg: COR.greenBg, label: 'Próximo' },
    contexto: { cor: '#555', bg: '#eee', label: 'Contexto' },
  }
  const corPrioridade: Record<string, string> = { critica: COR.red, alta: COR.gold, media: COR.espresso, baixa: COR.espressoL }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="text" placeholder="Buscar…" value={busca} onChange={e => setBusca(e.target.value)} style={inputStyle} />
        <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={selectStyle}>
          <option value="">Todas categorias</option>
          {categorias.map(c => <option key={c} value={c}>{corCategoria[c]?.label || c}</option>)}
        </select>
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={selectStyle}>
          <option value="ativo">Ativos</option>
          <option value="concluido">Concluídos</option>
          <option value="">Todos</option>
        </select>
      </div>

      <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 10 }}>{itensFiltrados.length} itens</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {itensFiltrados.map(item => {
          const r = corCategoria[item.categoria] || { cor: '#555', bg: '#eee', label: item.categoria }
          return (
            <div key={item.id} style={{ backgroundColor: 'white', borderRadius: 10, padding: 14, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', display: 'flex', gap: 14, alignItems: 'flex-start', opacity: item.status === 'concluido' ? 0.55 : 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                  <TagSmall texto={r.label} cor={r.cor} bg={r.bg} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: corPrioridade[item.prioridade], textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.prioridade}</span>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>· {item.projeto}</span>
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: '2px 0 4px', lineHeight: 1.3 }}>{item.titulo}</h3>
                {item.descricao && <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0, opacity: 0.75, whiteSpace: 'pre-wrap' }}>{item.descricao}</p>}
                {item.tags && item.tags.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {item.tags.map(t => <span key={t} style={tagPillStyle}>{t}</span>)}
                  </div>
                )}
              </div>
              {item.status === 'ativo' && (
                <button onClick={() => concluir(item.id)} style={btnMiniStyle}>✓ Concluir</button>
              )}
            </div>
          )
        })}
        {itensFiltrados.length === 0 && <p style={{ padding: 32, textAlign: 'center', opacity: 0.5 }}>Nenhum item.</p>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// ABA: ARQUIVOS
// ═══════════════════════════════════════════════════

function AbaArquivos() {
  const [itens, setItens] = useState<Arquivo[]>([])
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [busca, setBusca] = useState('')
  const [soCriticos, setSoCriticos] = useState(false)
  const [soComBug, setSoComBug] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_catalogo_listar', {
      p_tipo: filtroTipo || null,
      p_categoria: filtroCategoria || null,
      p_busca: busca || null,
      p_so_criticos: soCriticos,
      p_so_com_bug: soComBug,
    })
    if (data) setItens(data as Arquivo[])
  }, [filtroTipo, filtroCategoria, busca, soCriticos, soComBug])

  useEffect(() => { 
    const t = setTimeout(() => carregar(), 200)
    return () => clearTimeout(t)
  }, [carregar])

  const tipoCor: Record<string, { cor: string; bg: string }> = {
    pagina: { cor: COR.blue, bg: COR.blueBg },
    layout: { cor: COR.red, bg: COR.redBg },
    api_route: { cor: COR.gold, bg: COR.goldBg },
    componente: { cor: COR.green, bg: COR.greenBg },
    hook: { cor: COR.green, bg: COR.greenBg },
    lib: { cor: COR.espresso, bg: COR.cream },
    config: { cor: COR.espressoM, bg: COR.creamD },
    sql: { cor: COR.amber, bg: COR.amberBg },
    doc: { cor: '#555', bg: '#eee' },
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="text" placeholder="Buscar por caminho, descrição, tag…" value={busca} onChange={e => setBusca(e.target.value)} style={{ ...inputStyle, flex: '1 1 260px' }} />
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={selectStyle}>
          <option value="">Todos tipos</option>
          <option value="pagina">Páginas</option>
          <option value="layout">Layouts</option>
          <option value="api_route">API Routes</option>
          <option value="componente">Componentes</option>
          <option value="lib">Libs</option>
          <option value="config">Config</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={soCriticos} onChange={e => setSoCriticos(e.target.checked)} />
          Só críticos
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={soComBug} onChange={e => setSoComBug(e.target.checked)} />
          Com bug
        </label>
      </div>

      <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 10 }}>{itens.length} arquivos</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {itens.map(a => {
          const t = tipoCor[a.tipo] || { cor: '#555', bg: '#eee' }
          const exp = expandido === a.id
          return (
            <div key={a.id} style={{ backgroundColor: 'white', borderRadius: 10, padding: 14, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', borderLeft: a.critico ? `4px solid ${COR.red}` : (a.tem_bug_conhecido ? `4px solid ${COR.amber}` : '4px solid transparent') }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setExpandido(exp ? null : a.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <TagSmall texto={a.tipo} cor={t.cor} bg={t.bg} />
                    {a.categoria_funcional && <span style={{ fontSize: 10, fontWeight: 600, color: COR.espressoM, letterSpacing: 0.5 }}>{a.categoria_funcional.toUpperCase()}</span>}
                    {a.critico && <TagSmall texto="CRÍTICO" cor={COR.red} bg={COR.redBg} />}
                    {a.tem_bug_conhecido && <TagSmall texto="BUG" cor={COR.amber} bg={COR.amberBg} />}
                    {a.versao_conhecida && <span style={{ fontSize: 10, opacity: 0.5, fontFamily: 'monospace' }}>{a.versao_conhecida}</span>}
                  </div>
                  <code style={{ fontSize: 12, color: COR.espresso, fontFamily: 'JetBrains Mono, Consolas, monospace', fontWeight: 600 }}>{a.caminho}</code>
                  <p style={{ fontSize: 12, margin: '4px 0 0', opacity: 0.75 }}>{a.o_que_faz}</p>
                </div>
                <span style={{ fontSize: 12, opacity: 0.4 }}>{exp ? '▼' : '▶'}</span>
              </div>
              {exp && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COR.borderL}`, fontSize: 12, color: COR.espressoM }}>
                  {a.observacoes && <p style={{ margin: '0 0 8px', lineHeight: 1.5 }}><strong>Observações:</strong> {a.observacoes}</p>}
                  {a.tabelas_afetadas && a.tabelas_afetadas.length > 0 && (
                    <p style={{ margin: '0 0 8px' }}>
                      <strong>Tabelas:</strong> {a.tabelas_afetadas.map(t => <code key={t} style={codeInlineStyle}>{t}</code>)}
                    </p>
                  )}
                  {a.tags && a.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {a.tags.map(t => <span key={t} style={tagPillStyle}>{t}</span>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {itens.length === 0 && <p style={{ padding: 32, textAlign: 'center', opacity: 0.5 }}>Nenhum arquivo.</p>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// ABA: MUDANÇAS
// ═══════════════════════════════════════════════════

function AbaMudancas({ onChange }: { onChange: () => void }) {
  const [itens, setItens] = useState<Mudanca[]>([])
  const [filtroStatus, setFiltroStatus] = useState('')
  const [busca, setBusca] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_mudancas_listar', {
      p_status: filtroStatus || null,
      p_busca: busca || null,
    })
    if (data) setItens(data as Mudanca[])
  }, [filtroStatus, busca])

  useEffect(() => {
    const t = setTimeout(() => carregar(), 200)
    return () => clearTimeout(t)
  }, [carregar])

  const aprovar = async (id: string) => {
    if (!confirm('Aprovar esta mudança? O Claude poderá executar.')) return
    await supabase.rpc('fn_mudanca_aprovar', { p_id: id, p_por: 'gilberto via web' })
    carregar(); onChange()
  }

  const rejeitar = async (id: string) => {
    const motivo = prompt('Motivo da rejeição (opcional):')
    if (motivo === null) return
    await supabase.rpc('fn_mudanca_rejeitar', { p_id: id, p_motivo: motivo || null })
    carregar(); onChange()
  }

  const statusCor: Record<string, { cor: string; bg: string; label: string }> = {
    proposto: { cor: COR.blue, bg: COR.blueBg, label: 'Proposto' },
    aguardando_aprovacao: { cor: COR.amber, bg: COR.amberBg, label: 'Aguardando' },
    aprovado: { cor: COR.green, bg: COR.greenBg, label: 'Aprovado' },
    em_execucao: { cor: COR.gold, bg: COR.goldBg, label: 'Em execução' },
    deployado: { cor: COR.green, bg: COR.greenBg, label: 'Deployado' },
    rejeitado: { cor: COR.red, bg: COR.redBg, label: 'Rejeitado' },
    rollback: { cor: COR.red, bg: COR.redBg, label: 'Rollback' },
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="text" placeholder="Buscar…" value={busca} onChange={e => setBusca(e.target.value)} style={{ ...inputStyle, flex: '1 1 260px' }} />
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={selectStyle}>
          <option value="">Todos status</option>
          <option value="proposto">Propostas</option>
          <option value="aguardando_aprovacao">Aguardando aprovação</option>
          <option value="aprovado">Aprovadas</option>
          <option value="em_execucao">Em execução</option>
          <option value="deployado">Deployadas</option>
          <option value="rejeitado">Rejeitadas</option>
        </select>
      </div>

      <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 10 }}>{itens.length} mudanças</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {itens.map(m => {
          const s = statusCor[m.status] || { cor: '#555', bg: '#eee', label: m.status }
          const exp = expandido === m.id
          const podeAprovar = m.status === 'proposto' || m.status === 'aguardando_aprovacao'
          return (
            <div key={m.id} style={{ backgroundColor: 'white', borderRadius: 10, padding: 14, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', borderLeft: `4px solid ${s.cor}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    <code style={{ fontSize: 11, fontWeight: 700, color: COR.gold, fontFamily: 'JetBrains Mono, monospace' }}>M-{String(m.numero).padStart(3, '0')}</code>
                    <TagSmall texto={s.label} cor={s.cor} bg={s.bg} />
                    <TagSmall texto={m.tipo_mudanca} cor={COR.espresso} bg={COR.cream} />
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, margin: '2px 0 4px', lineHeight: 1.3, cursor: 'pointer' }} onClick={() => setExpandido(exp ? null : m.id)}>
                    {m.titulo}
                  </h3>
                  <p style={{ fontSize: 12, margin: 0, opacity: 0.75, lineHeight: 1.5 }}>{m.descricao}</p>
                  
                  {exp && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COR.borderL}`, fontSize: 11, color: COR.espressoM }}>
                      {m.arquivos_afetados && m.arquivos_afetados.length > 0 && (
                        <p style={{ margin: '0 0 6px' }}>
                          <strong>Arquivos:</strong> {m.arquivos_afetados.map(f => <code key={f} style={codeInlineStyle}>{f}</code>)}
                        </p>
                      )}
                      {m.tabelas_afetadas && m.tabelas_afetadas.length > 0 && (
                        <p style={{ margin: '0 0 6px' }}>
                          <strong>Tabelas:</strong> {m.tabelas_afetadas.map(t => <code key={t} style={codeInlineStyle}>{t}</code>)}
                        </p>
                      )}
                      <p style={{ margin: '0 0 4px' }}><strong>Proposto:</strong> {new Date(m.proposto_em).toLocaleString('pt-BR')}</p>
                      {m.aprovado_em && <p style={{ margin: '0 0 4px' }}><strong>Aprovado:</strong> {new Date(m.aprovado_em).toLocaleString('pt-BR')}</p>}
                      {m.deployado_em && <p style={{ margin: '0 0 4px' }}><strong>Deployado:</strong> {new Date(m.deployado_em).toLocaleString('pt-BR')}</p>}
                      {m.commit_url && <p style={{ margin: '0 0 4px' }}><strong>Commit:</strong> <a href={m.commit_url} target="_blank" rel="noopener" style={{ color: COR.gold }}>{m.commit_url}</a></p>}
                    </div>
                  )}
                </div>
                {podeAprovar && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                    <button onClick={() => aprovar(m.id)} style={{ ...btnMiniStyle, backgroundColor: COR.greenBg, color: COR.green, borderColor: COR.green }}>✓ Aprovar</button>
                    <button onClick={() => rejeitar(m.id)} style={{ ...btnMiniStyle, backgroundColor: COR.redBg, color: COR.red, borderColor: COR.red }}>✕ Rejeitar</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {itens.length === 0 && <p style={{ padding: 32, textAlign: 'center', opacity: 0.5 }}>Nenhuma mudança.</p>}
      </div>
    </div>
  )
}

// ═══ ESTILOS COMPARTILHADOS ═══
const inputStyle: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 8, border: `1px solid ${COR.border}`,
  backgroundColor: 'white', fontSize: 13, fontFamily: 'inherit', color: COR.espresso, outline: 'none',
}

const selectStyle: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 8, border: `1px solid ${COR.border}`,
  backgroundColor: 'white', fontSize: 13, fontFamily: 'inherit', color: COR.espresso, outline: 'none',
}

const btnMiniStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: `1px solid ${COR.border}`,
  backgroundColor: 'white', color: COR.green, fontSize: 11, fontWeight: 600,
  cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit', whiteSpace: 'nowrap',
}

const tagPillStyle: React.CSSProperties = {
  fontSize: 10, padding: '2px 6px', backgroundColor: COR.cream, color: COR.espresso,
  borderRadius: 4, fontFamily: 'JetBrains Mono, monospace',
}

const codeInlineStyle: React.CSSProperties = {
  fontSize: 10, padding: '1px 6px', backgroundColor: COR.cream, color: COR.espresso,
  borderRadius: 3, fontFamily: 'JetBrains Mono, monospace', marginRight: 4,
  display: 'inline-block', marginBottom: 2,
}
