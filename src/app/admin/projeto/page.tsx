'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

// Tipos
type Item = {
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

type Resumo = {
  projetos: string[] | null
  totais: Record<string, number> | null
  criticas: Item[] | null
}

// Rótulos e cores por categoria
const rotulosCategoria: Record<string, { label: string; cor: string; bg: string }> = {
  regra_operacional: { label: 'Regra',        cor: '#6a2020', bg: '#fce8e8' },
  decisao:           { label: 'Decisão',      cor: '#2d6a3e', bg: '#e8f3ec' },
  pendencia:         { label: 'Pendência',    cor: '#8a6a10', bg: '#fdf4e0' },
  bug:               { label: 'Bug',          cor: '#a02020', bg: '#fce8e8' },
  credencial:        { label: 'Credencial',   cor: '#3D2314', bg: '#f5f0e8' },
  convencao:         { label: 'Convenção',    cor: '#3D2314', bg: '#f0ebe0' },
  descoberta:        { label: 'Descoberta',   cor: '#C8941A', bg: '#fdf4e0' },
  proximo_passo:     { label: 'Próximo',      cor: '#2d6a3e', bg: '#e8f3ec' },
  contexto:          { label: 'Contexto',     cor: '#555',    bg: '#eeeeee' },
}

const rotulosPrioridade: Record<string, { label: string; cor: string }> = {
  critica: { label: 'Crítica', cor: '#a02020' },
  alta:    { label: 'Alta',    cor: '#C8941A' },
  media:   { label: 'Média',   cor: '#3D2314' },
  baixa:   { label: 'Baixa',   cor: '#888' },
}

function TagCategoria({ cat }: { cat: string }) {
  const r = rotulosCategoria[cat] || { label: cat, cor: '#555', bg: '#eee' }
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, backgroundColor: r.bg, color: r.cor }}>
      {r.label}
    </span>
  )
}

function TagPrioridade({ prio }: { prio: string }) {
  const r = rotulosPrioridade[prio] || { label: prio, cor: '#555' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: r.cor, letterSpacing: 0.5, textTransform: 'uppercase' }}>
      {r.label}
    </span>
  )
}

export default function ContextoProjetoPage() {
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroProjeto, setFiltroProjeto] = useState<string>('')
  const [filtroCategoria, setFiltroCategoria] = useState<string>('')
  const [filtroStatus, setFiltroStatus] = useState<string>('ativo')
  const [busca, setBusca] = useState('')

  const carregar = useCallback(async () => {
    const [r, l] = await Promise.all([
      supabase.rpc('fn_contexto_resumo', { p_projeto: filtroProjeto || null }),
      supabase.rpc('fn_contexto_listar', {
        p_projeto: filtroProjeto || null,
        p_categoria: filtroCategoria || null,
        p_status: filtroStatus || null,
      }),
    ])
    if (r.data) setResumo(r.data as Resumo)
    if (l.data) setItens(l.data as Item[])
    setCarregando(false)
  }, [filtroProjeto, filtroCategoria, filtroStatus])

  useEffect(() => { carregar() }, [carregar])

  const concluir = async (id: string) => {
    if (!confirm('Marcar este item como concluído?')) return
    await supabase.rpc('fn_contexto_concluir', { p_id: id })
    carregar()
  }

  const itensFiltrados = busca
    ? itens.filter(i => 
        i.titulo.toLowerCase().includes(busca.toLowerCase()) ||
        (i.descricao && i.descricao.toLowerCase().includes(busca.toLowerCase())) ||
        (i.tags && i.tags.some(t => t.toLowerCase().includes(busca.toLowerCase())))
      )
    : itens

  if (carregando) {
    return (
      <main style={{ minHeight: '100vh', backgroundColor: '#FAF7F2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: '#3D2314' }}>
        <p style={{ opacity: 0.6 }}>Carregando contexto…</p>
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#FAF7F2', fontFamily: 'Inter, system-ui, sans-serif', color: '#3D2314', padding: '32px 24px 64px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        {/* Cabeçalho */}
        <header style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
            PS Gestão · Administração
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 40, fontWeight: 400, margin: '4px 0 0', letterSpacing: -0.5 }}>
            Contexto do Projeto
          </h1>
          <p style={{ fontSize: 14, opacity: 0.6, margin: '8px 0 0' }}>
            Fonte única da verdade — decisões, pendências, credenciais, convenções.
          </p>
        </header>

        {/* Cards de resumo */}
        {resumo?.totais && (
          <section style={{ marginBottom: 32 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              {Object.entries(resumo.totais).map(([cat, qtd]) => {
                const r = rotulosCategoria[cat]
                if (!r) return null
                return (
                  <div 
                    key={cat}
                    onClick={() => setFiltroCategoria(cat === filtroCategoria ? '' : cat)}
                    style={{
                      backgroundColor: filtroCategoria === cat ? r.bg : 'white',
                      borderRadius: 12,
                      padding: 16,
                      boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
                      cursor: 'pointer',
                      border: filtroCategoria === cat ? `2px solid ${r.cor}` : '2px solid transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.6, margin: 0, color: r.cor }}>
                      {r.label}
                    </p>
                    <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, margin: '4px 0 0', color: r.cor }}>
                      {qtd}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Filtros */}
        <section style={{ marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Buscar (título, descrição, tag)…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{
              flex: '1 1 280px', padding: '10px 14px', borderRadius: 8,
              border: '1px solid #e5ddd0', backgroundColor: 'white',
              fontSize: 14, fontFamily: 'inherit', color: '#3D2314',
            }}
          />
          <select
            value={filtroProjeto}
            onChange={(e) => setFiltroProjeto(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e5ddd0', backgroundColor: 'white', fontSize: 14, fontFamily: 'inherit', color: '#3D2314' }}
          >
            <option value="">Todos projetos</option>
            {resumo?.projetos?.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e5ddd0', backgroundColor: 'white', fontSize: 14, fontFamily: 'inherit', color: '#3D2314' }}
          >
            <option value="ativo">Ativos</option>
            <option value="concluido">Concluídos</option>
            <option value="bloqueado">Bloqueados</option>
            <option value="">Todos</option>
          </select>
          {(filtroCategoria || busca) && (
            <button
              onClick={() => { setFiltroCategoria(''); setBusca('') }}
              style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: '#3D2314', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Limpar filtros
            </button>
          )}
        </section>

        {/* Lista de itens */}
        <section>
          <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.6 }}>
            {itensFiltrados.length} {itensFiltrados.length === 1 ? 'item' : 'itens'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {itensFiltrados.map((item) => (
              <div
                key={item.id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: 12,
                  padding: 18,
                  boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
                  display: 'flex',
                  gap: 16,
                  alignItems: 'flex-start',
                  opacity: item.status === 'concluido' ? 0.55 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                    <TagCategoria cat={item.categoria} />
                    <TagPrioridade prio={item.prioridade} />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>· {item.projeto}</span>
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, margin: '2px 0 6px', lineHeight: 1.3, textDecoration: item.status === 'concluido' ? 'line-through' : undefined }}>
                    {item.titulo}
                  </h3>
                  {item.descricao && (
                    <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0, opacity: 0.75, whiteSpace: 'pre-wrap' }}>
                      {item.descricao}
                    </p>
                  )}
                  {item.tags && item.tags.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {item.tags.map(t => (
                        <span key={t} style={{ fontSize: 11, padding: '2px 8px', backgroundColor: '#f5f0e8', color: '#3D2314', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {item.status === 'ativo' && (
                  <button
                    onClick={() => concluir(item.id)}
                    title="Marcar como concluído"
                    style={{
                      padding: '6px 12px', borderRadius: 6, border: '1px solid #e5ddd0',
                      backgroundColor: 'white', color: '#2d6a3e', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
                    }}
                  >
                    ✓ Concluir
                  </button>
                )}
              </div>
            ))}
          </div>

          {itensFiltrados.length === 0 && (
            <p style={{ padding: 48, textAlign: 'center', opacity: 0.5, fontSize: 13 }}>
              Nenhum item encontrado com os filtros atuais.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
