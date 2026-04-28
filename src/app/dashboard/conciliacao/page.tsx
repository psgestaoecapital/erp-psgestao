// src/app/dashboard/conciliacao/page.tsx
//
// HUB do Módulo Conciliação Universal
// Lista lotes ativos por empresa, mostra saúde, permite criar novo (upload) ou continuar.
// Princípios fundacionais: zero tela vazia, mobile-first, estética premium, performance.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ===== Tipos =====
interface Lote {
  id: string
  nome: string
  tipo: 'bancario' | 'cartao_despesa' | 'cartao_venda' | 'outro'
  operadora: string | null
  total_movimentos: number
  total_pendentes: number
  total_conciliados: number
  status: string
  created_at: string
  company_id: string
}

interface Saude {
  company_id: string
  razao_social: string
  tipo_conciliacao: string
  total_lotes: number
  lotes_abertos: number
  lotes_em_andamento: number
  lotes_conciliados: number
  total_movimentos: number
  movimentos_pendentes: number
  movimentos_conciliados: number
  pct_conciliado: string | null
}

// ===== Paleta canônica PS Gestão =====
const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO = '#C8941A'
const ESPRESSO_CLARO = '#5D4534'
const VERDE = '#2D7A2D'
const AMARELO = '#C49E1A'
const VERMELHO = '#B1342B'

// ===== Helpers =====
const tipoLabel = (t: string) => ({
  bancario: '🏦 Bancário',
  cartao_despesa: '💳 Fatura cartão',
  cartao_venda: '🛒 Vendas cartão',
  outro: '📋 Outro',
} as Record<string, string>)[t] || t

const tipoIcone = (t: string) => ({
  bancario: '🏦',
  cartao_despesa: '💳',
  cartao_venda: '🛒',
  outro: '📋',
} as Record<string, string>)[t] || '📋'

// ===== Componente principal =====
export default function ConciliacaoHubPage() {
  const router = useRouter()
  const [lotes, setLotes] = useState<Lote[]>([])
  const [saude, setSaude] = useState<Saude[]>([])
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>('todas')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/conciliacao/saude')
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.mensagem_humana || json.error)
        setSaude(json.saude || [])
        setLotes(json.lotes || [])
      })
      .catch(e => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [])

  // Empresas únicas para filtro
  const empresasUnicas = Array.from(
    new Set(saude.map(s => s.razao_social))
  ).sort()

  // Filtragem
  const lotesFiltrados = lotes.filter(l => {
    if (filtroTipo !== 'todos' && l.tipo !== filtroTipo) return false
    if (filtroEmpresa !== 'todas') {
      const matchSaude = saude.find(s => s.company_id === l.company_id)
      if (matchSaude?.razao_social !== filtroEmpresa) return false
    }
    return true
  })

  // Estatísticas globais
  const totalPendentes = lotes.reduce((acc, l) => acc + l.total_pendentes, 0)
  const totalConciliados = lotes.reduce((acc, l) => acc + l.total_conciliados, 0)
  const totalMovimentos = lotes.reduce((acc, l) => acc + l.total_movimentos, 0)
  const pctGlobal = totalMovimentos > 0
    ? Math.round((totalConciliados / totalMovimentos) * 100)
    : 0

  if (carregando) return <SkeletonHub />

  if (erro) {
    return (
      <div style={{ padding: 32, background: OFFWHITE, minHeight: '100vh' }}>
        <h2 style={{ color: VERMELHO }}>Algo saiu errado</h2>
        <p>{erro}</p>
        <button onClick={() => location.reload()} style={btnPrimario}>↻ Tentar novamente</button>
      </div>
    )
  }

  // Zero tela vazia (princípio #3) — sem lotes mostra onboarding
  if (lotes.length === 0) {
    return <OnboardingPrimeiroLote />
  }

  return (
    <div style={containerStyle}>
      <header style={hubHeaderStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>
            Conciliação
          </h1>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>
            {totalPendentes} pendentes · {totalConciliados} conciliados · {pctGlobal}% global
          </div>
        </div>
        <button style={btnPrimario}>+ Importar fatura/extrato</button>
      </header>

      {/* Cards de saúde por empresa */}
      <section style={{ padding: 16, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <h2 style={subTituloStyle}>Saúde por empresa</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {saude.map((s, i) => {
            const pct = s.pct_conciliado ? parseFloat(s.pct_conciliado) : 0
            const cor = pct >= 80 ? VERDE : pct >= 30 ? AMARELO : VERMELHO
            return (
              <div key={i} style={cardSaude}>
                <div style={{ fontSize: 13, color: ESPRESSO_CLARO }}>
                  {s.razao_social}
                </div>
                <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
                  {tipoLabel(s.tipo_conciliacao)}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: cor }}>
                  {pct.toFixed(0)}%
                </div>
                <div style={{ fontSize: 12, color: ESPRESSO_CLARO }}>
                  {s.movimentos_conciliados} de {s.total_movimentos} conciliados
                </div>
                <div style={{ height: 6, background: OFFWHITE, borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: cor, width: `${pct}%`, transition: 'width 300ms' }} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Filtros */}
      <section style={{ padding: '0 16px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ ...subTituloStyle, margin: 0, flex: '0 0 auto' }}>Lotes ativos</h2>

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={selectStyle}>
              <option value="todos">Todos os tipos</option>
              <option value="bancario">🏦 Bancário</option>
              <option value="cartao_despesa">💳 Fatura cartão</option>
              <option value="cartao_venda">🛒 Vendas cartão</option>
            </select>
            <select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} style={selectStyle}>
              <option value="todas">Todas as empresas</option>
              {empresasUnicas.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>

        {/* Lista */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lotesFiltrados.map(lote => {
            const empresa = saude.find(s => s.company_id === lote.company_id)?.razao_social || ''
            const pct = lote.total_movimentos > 0
              ? Math.round((lote.total_conciliados / lote.total_movimentos) * 100)
              : 0
            const cor = pct >= 80 ? VERDE : pct >= 30 ? AMARELO : VERMELHO
            return (
              <div
                key={lote.id}
                onClick={() => router.push(`/dashboard/conciliacao/${lote.id}`)}
                style={cardLote}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#999' }}>{empresa}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: ESPRESSO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tipoIcone(lote.tipo)} {lote.nome}
                  </div>
                  <div style={{ fontSize: 12, color: ESPRESSO_CLARO, marginTop: 2 }}>
                    {lote.operadora && `${lote.operadora} · `}
                    {lote.total_movimentos} movimentos
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 100 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: cor }}>{pct}%</div>
                  <div style={{ fontSize: 11, color: ESPRESSO_CLARO }}>
                    {lote.total_pendentes} pendentes
                  </div>
                </div>
                <div style={{ width: 100, height: 4, background: OFFWHITE, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: cor, width: `${pct}%` }} />
                </div>
                <span style={{ fontSize: 18, color: ESPRESSO_CLARO }}>→</span>
              </div>
            )
          })}
        </div>

        {lotesFiltrados.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>
            Nenhum lote bate com os filtros selecionados
          </div>
        )}
      </section>
    </div>
  )
}

function OnboardingPrimeiroLote() {
  return (
    <div style={{ padding: 48, textAlign: 'center', background: OFFWHITE, minHeight: '100vh' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🎯</div>
      <h2 style={{ color: ESPRESSO }}>Sua primeira conciliação está a 2 cliques</h2>
      <p style={{ color: ESPRESSO_CLARO, fontSize: 14, maxWidth: 480, margin: '0 auto 24px' }}>
        Importe um arquivo OFX do seu banco, uma fatura PDF do cartão ou um relatório de adquirente.
        A IA vai sugerir os matches sozinha — você só confirma com Enter.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button style={btnPrimario}>📤 Importar OFX/CSV</button>
        <button style={btnSecundario}>📋 Importar fatura PDF</button>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 32 }}>
        Suportado: OFX (banco), CSV, PDF de fatura, API Pluggy/Belvo (em breve)
      </div>
    </div>
  )
}

function SkeletonHub() {
  return (
    <div style={{ padding: 24, background: OFFWHITE, minHeight: '100vh' }}>
      <div style={{ height: 56, background: '#e8e0d4', borderRadius: 8, marginBottom: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        {[1,2,3].map(i => <div key={i} style={{ height: 100, background: '#e8e0d4', borderRadius: 8 }} />)}
      </div>
      {[1,2,3,4,5].map(i => <div key={i} style={{ height: 64, background: '#e8e0d4', borderRadius: 8, marginBottom: 8 }} />)}
    </div>
  )
}

// ===== Estilos =====
const containerStyle: React.CSSProperties = {
  background: OFFWHITE,
  minHeight: '100vh',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
}

const hubHeaderStyle: React.CSSProperties = {
  background: ESPRESSO,
  color: '#fff',
  padding: '20px 24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 16,
}

const subTituloStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: ESPRESSO_CLARO,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 12,
  marginTop: 24,
}

const cardSaude: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 1px 4px rgba(61,35,20,0.05)',
  transition: 'all 150ms ease',
}

const cardLote: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 1px 4px rgba(61,35,20,0.05)',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  cursor: 'pointer',
  transition: 'all 150ms ease',
}

const btnPrimario: React.CSSProperties = {
  background: DOURADO,
  color: '#fff',
  border: 'none',
  padding: '10px 20px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 150ms ease',
}

const btnSecundario: React.CSSProperties = {
  background: 'transparent',
  color: ESPRESSO,
  border: `1px solid ${ESPRESSO_CLARO}`,
  padding: '10px 20px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
}

const selectStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d6cfc4',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 13,
  color: ESPRESSO,
  cursor: 'pointer',
}
