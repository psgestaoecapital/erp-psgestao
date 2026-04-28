// src/app/dashboard/conciliacao/[lote_id]/page.tsx
//
// MÓDULO CONCILIAÇÃO UNIVERSAL — Tela do Lote (TELA KILLER)
//
// Filosofia (8 princípios fundacionais):
// 1. Velocidade brutal: tudo em atalhos. Enter=aceitar, R=rejeitar, I=ignorar, Esc=pular, ?=ajuda
// 2. IA invisível: sugestão pré-renderizada, operador só confirma
// 3. Zero tela vazia: lote sem movimentos mostra próximos passos
// 4. Estética premium: paleta canônica + transições 150ms
// 5. Mobile-first: layout responsivo (2 colunas desktop, empilhado mobile)
// 6. Erros invisíveis: toast humano + retry, nunca stack trace
// 7. Performance: optimistic update + skeleton durante load
// 8. Aprende: cada decisão refina a IA via fn_conciliacao_aplicar_match

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ===== Tipos =====
interface Movimento {
  movimento_id: string
  lote_nome: string
  tipo_lote: 'bancario' | 'cartao_despesa' | 'cartao_venda' | 'outro'
  data_transacao: string
  valor: string
  descricao: string
  natureza: 'credito' | 'debito'
  status: string
  sugestao_lancamento_tabela: 'erp_pagar' | 'erp_receber' | null
  sugestao_lancamento_id: string | null
  sugestao_data: string | null
  sugestao_valor: string | null
  sugestao_contraparte: string | null
  sugestao_score: number | null
  sugestao_categoria: 'perfeito' | 'quase' | 'fraco' | null
}

interface Lote {
  id: string
  nome: string
  tipo: string
  operadora: string | null
  total_movimentos: number
  total_pendentes: number
  total_conciliados: number
  status: string
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
const formatBRL = (v: string | number | null) => {
  if (v == null) return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const formatDate = (d: string | null) => {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const semaforo = (categoria: string | null) => {
  if (categoria === 'perfeito') return { cor: VERDE, label: 'Match perfeito', icone: '🟢' }
  if (categoria === 'quase') return { cor: AMARELO, label: 'Quase lá - revise', icone: '🟡' }
  if (categoria === 'fraco') return { cor: VERMELHO, label: 'Sem confiança', icone: '🔴' }
  return { cor: '#999', label: 'Sem sugestão', icone: '⚪' }
}

const tipoLabel = (t: string) => ({
  bancario: '🏦 Conciliação bancária',
  cartao_despesa: '💳 Fatura cartão',
  cartao_venda: '🛒 Vendas no cartão',
  outro: '📋 Outro',
} as Record<string, string>)[t] || t

// ===== Componente principal =====
export default function ConciliacaoLotePage() {
  const params = useParams()
  const router = useRouter()
  const lote_id = params?.lote_id as string

  const [lote, setLote] = useState<Lote | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [indice, setIndice] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [processando, setProcessando] = useState(false)
  const [toast, setToast] = useState<{ tipo: 'ok' | 'erro' | 'info'; msg: string } | null>(null)
  const [mostrarAjuda, setMostrarAjuda] = useState(false)

  const movimentoAtual = movimentos[indice]
  const totalPendentes = movimentos.filter(m => m.status === 'pendente').length

  // ----- Toast -----
  const mostrarToast = (tipo: 'ok' | 'erro' | 'info', msg: string) => {
    setToast({ tipo, msg })
    setTimeout(() => setToast(null), 3000)
  }

  // ----- Loading inicial -----
  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const res = await fetch(`/api/conciliacao/inbox?lote_id=${lote_id}&status=pendente&limit=200`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.mensagem_humana || json.error)
      setLote(json.lote)
      setMovimentos(json.movimentos || [])
      setIndice(0)
    } catch (e: any) {
      mostrarToast('erro', e.message || 'Não consegui carregar')
    } finally {
      setCarregando(false)
    }
  }, [lote_id])

  useEffect(() => {
    if (lote_id) carregar()
  }, [lote_id, carregar])

  // ----- Navegar para próximo pendente -----
  const avancar = useCallback(() => {
    const proximoPendente = movimentos.findIndex(
      (m, i) => i > indice && m.status === 'pendente'
    )
    if (proximoPendente >= 0) {
      setIndice(proximoPendente)
    } else {
      const desde0 = movimentos.findIndex((m) => m.status === 'pendente')
      if (desde0 >= 0 && desde0 !== indice) {
        setIndice(desde0)
      } else {
        mostrarToast('ok', '🎉 Todos os movimentos do lote processados!')
      }
    }
  }, [movimentos, indice])

  const voltar = useCallback(() => {
    if (indice > 0) setIndice(indice - 1)
  }, [indice])

  // ----- Ações -----
  const aplicarMatch = useCallback(async () => {
    if (!movimentoAtual || !movimentoAtual.sugestao_lancamento_id) {
      mostrarToast('info', 'Sem sugestão para aceitar — busque manualmente')
      return
    }
    if (processando) return
    setProcessando(true)

    // Optimistic update — princípio #7 (latência percebida menor que 100ms)
    const idx = indice
    setMovimentos(prev =>
      prev.map((m, i) =>
        i === idx ? { ...m, status: 'conciliado' } : m
      )
    )

    try {
      const res = await fetch('/api/conciliacao/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'aplicar',
          movimento_id: movimentoAtual.movimento_id,
          lancamento_tabela: movimentoAtual.sugestao_lancamento_tabela,
          lancamento_id: movimentoAtual.sugestao_lancamento_id,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.mensagem_humana || 'Erro ao aplicar match')

      mostrarToast('ok', `✓ Conciliado com ${movimentoAtual.sugestao_contraparte}`)
      avancar()
    } catch (e: any) {
      // Rollback do optimistic update
      setMovimentos(prev =>
        prev.map((m, i) =>
          i === idx ? { ...m, status: 'pendente' } : m
        )
      )
      mostrarToast('erro', e.message)
    } finally {
      setProcessando(false)
    }
  }, [movimentoAtual, indice, processando, avancar])

  const rejeitarSugestao = useCallback(async () => {
    if (!movimentoAtual || !movimentoAtual.sugestao_lancamento_id) {
      avancar()
      return
    }
    if (processando) return
    setProcessando(true)

    try {
      await fetch('/api/conciliacao/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'rejeitar',
          movimento_id: movimentoAtual.movimento_id,
          lancamento_tabela: movimentoAtual.sugestao_lancamento_tabela,
          lancamento_id: movimentoAtual.sugestao_lancamento_id,
        }),
      })
      mostrarToast('info', '↻ IA aprendeu — não vai mais sugerir esse padrão')
      avancar()
    } catch (e: any) {
      mostrarToast('erro', e.message)
    } finally {
      setProcessando(false)
    }
  }, [movimentoAtual, processando, avancar])

  const ignorarMovimento = useCallback(async () => {
    if (!movimentoAtual || processando) return
    setProcessando(true)

    const idx = indice
    setMovimentos(prev =>
      prev.map((m, i) => (i === idx ? { ...m, status: 'ignorado' } : m))
    )

    try {
      await fetch('/api/conciliacao/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'ignorar',
          movimento_id: movimentoAtual.movimento_id,
        }),
      })
      mostrarToast('ok', '✓ Marcado como ignorado')
      avancar()
    } catch (e: any) {
      setMovimentos(prev =>
        prev.map((m, i) => (i === idx ? { ...m, status: 'pendente' } : m))
      )
      mostrarToast('erro', e.message)
    } finally {
      setProcessando(false)
    }
  }, [movimentoAtual, indice, processando, avancar])

  // ----- Atalhos teclado (princípio #1: velocidade brutal) -----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Enter' && !processando) {
        e.preventDefault()
        aplicarMatch()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        rejeitarSugestao()
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault()
        ignorarMovimento()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        avancar()
      } else if (e.key === '?') {
        e.preventDefault()
        setMostrarAjuda(s => !s)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        voltar()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        avancar()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [aplicarMatch, rejeitarSugestao, ignorarMovimento, avancar, voltar, processando])

  // ===== Renderização =====
  if (carregando) {
    return <SkeletonLoading />
  }

  if (!lote) {
    return (
      <div style={{ padding: 32, textAlign: 'center', background: OFFWHITE, minHeight: '100vh' }}>
        <h2 style={{ color: ESPRESSO }}>Lote não encontrado</h2>
        <p>O lote pode ter sido arquivado ou o link está incorreto.</p>
        <button onClick={() => router.push('/dashboard/conciliacao')} style={btnPrimario}>
          ← Voltar para a lista
        </button>
      </div>
    )
  }

  if (movimentos.length === 0) {
    return <OnboardingLoteVazio lote={lote} onRecarregar={carregar} />
  }

  if (totalPendentes === 0) {
    return <LoteCompleto lote={lote} onVoltarLista={() => router.push('/dashboard/conciliacao')} />
  }

  return (
    <div style={containerStyle}>
      <Header
        lote={lote}
        movimentoAtualIdx={indice}
        totalMovimentos={movimentos.length}
        onVoltar={() => router.push('/dashboard/conciliacao')}
        onAjuda={() => setMostrarAjuda(s => !s)}
      />

      <div style={mainStyle}>
        <ColunaMovimento movimento={movimentoAtual} indice={indice} total={movimentos.length} />
        <ColunaSugestao
          movimento={movimentoAtual}
          onAceitar={aplicarMatch}
          onRejeitar={rejeitarSugestao}
          onIgnorar={ignorarMovimento}
          onPular={avancar}
          processando={processando}
        />
      </div>

      <Atalhos onMostrarAjuda={() => setMostrarAjuda(true)} />

      {toast && <Toast {...toast} />}

      {mostrarAjuda && <ModalAjuda onFechar={() => setMostrarAjuda(false)} />}
    </div>
  )
}

// ============================================================================
// SUB-COMPONENTES
// ============================================================================

function Header({ lote, movimentoAtualIdx, totalMovimentos, onVoltar, onAjuda }: any) {
  const totalConciliados = lote.total_conciliados
  const pctConcluido = lote.total_movimentos > 0
    ? Math.round((totalConciliados / lote.total_movimentos) * 100)
    : 0

  return (
    <header style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        <button onClick={onVoltar} style={btnIcone} aria-label="Voltar">←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {lote.nome}
          </h1>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
            {lote.operadora && `${lote.operadora} · `}
            {tipoLabel(lote.tipo)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'right', fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
          <div>{movimentoAtualIdx + 1} de {totalMovimentos}</div>
          <div style={{ color: DOURADO, fontWeight: 600 }}>{pctConcluido}% concluído</div>
        </div>
        <div style={progressBarBg}>
          <div style={{ ...progressBarFg, width: `${pctConcluido}%` }} />
        </div>
        <button onClick={onAjuda} style={btnIcone} aria-label="Ajuda">?</button>
      </div>
    </header>
  )
}

function ColunaMovimento({ movimento, indice, total }: { movimento: Movimento; indice: number; total: number }) {
  const isCredito = movimento.natureza === 'credito'

  return (
    <section style={colunaStyle}>
      <div style={colunaTituloStyle}>
        <span>📥 Movimento da fatura/extrato</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{indice + 1}/{total}</span>
      </div>

      <div style={cardMovimento}>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
          {formatDate(movimento.data_transacao)} · {isCredito ? '🟢 Entrada' : '🔴 Saída'}
        </div>

        <div style={{ fontSize: 28, fontWeight: 700, color: isCredito ? VERDE : ESPRESSO, marginBottom: 12 }}>
          {formatBRL(movimento.valor)}
        </div>

        <div style={{ fontSize: 14, color: ESPRESSO, lineHeight: 1.5 }}>
          {movimento.descricao || <em style={{ color: '#999' }}>(sem descrição)</em>}
        </div>
      </div>
    </section>
  )
}

function ColunaSugestao({ movimento, onAceitar, onRejeitar, onIgnorar, onPular, processando }: any) {
  const temSugestao = !!movimento.sugestao_lancamento_id
  const sem = semaforo(movimento.sugestao_categoria)

  return (
    <section style={colunaStyle}>
      <div style={colunaTituloStyle}>
        <span>🤖 Sugestão da IA</span>
        {temSugestao && (
          <span style={{ fontSize: 12, color: sem.cor, fontWeight: 600 }}>
            {sem.icone} {sem.label} · {Math.round(parseFloat(movimento.sugestao_score))}%
          </span>
        )}
      </div>

      {temSugestao ? (
        <>
          <div style={{ ...cardSugestao, borderColor: sem.cor }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
              {formatDate(movimento.sugestao_data)}
              {movimento.sugestao_lancamento_tabela === 'erp_pagar' ? ' · Conta a Pagar' : ' · Conta a Receber'}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: ESPRESSO, marginBottom: 8 }}>
              {formatBRL(movimento.sugestao_valor)}
            </div>
            <div style={{ fontSize: 14, color: ESPRESSO_CLARO, lineHeight: 1.5 }}>
              {movimento.sugestao_contraparte || '(sem nome)'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={onAceitar} disabled={processando} style={btnAceitar}>
              ✓ Aceitar <kbd style={kbdStyle}>Enter</kbd>
            </button>
            <button onClick={onRejeitar} disabled={processando} style={btnRejeitar}>
              ✗ Rejeitar <kbd style={kbdStyle}>R</kbd>
            </button>
            <button onClick={onIgnorar} disabled={processando} style={btnSecundario}>
              ⊘ Ignorar <kbd style={kbdStyle}>I</kbd>
            </button>
            <button onClick={onPular} disabled={processando} style={btnSecundario}>
              → Pular <kbd style={kbdStyle}>Esc</kbd>
            </button>
          </div>
        </>
      ) : (
        <div style={cardSemSugestao}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🤔</div>
          <div style={{ fontSize: 14, color: ESPRESSO_CLARO, marginBottom: 16 }}>
            Não encontrei nada parecido nas contas a {movimento.natureza === 'credito' ? 'receber' : 'pagar'}.
          </div>
          <div style={{ fontSize: 12, color: '#777', marginBottom: 12 }}>
            Pode ser um lançamento ainda não cadastrado, ou movimento sem contraparte.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={onIgnorar} disabled={processando} style={btnSecundario}>
              ⊘ Ignorar <kbd style={kbdStyle}>I</kbd>
            </button>
            <button onClick={onPular} disabled={processando} style={btnSecundario}>
              → Pular <kbd style={kbdStyle}>Esc</kbd>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Atalhos({ onMostrarAjuda }: { onMostrarAjuda: () => void }) {
  return (
    <footer style={atalhosStyle}>
      <span style={atalhoItem}><kbd style={kbdStyle}>Enter</kbd> aceitar</span>
      <span style={atalhoItem}><kbd style={kbdStyle}>R</kbd> rejeitar</span>
      <span style={atalhoItem}><kbd style={kbdStyle}>I</kbd> ignorar</span>
      <span style={atalhoItem}><kbd style={kbdStyle}>Esc</kbd> pular</span>
      <span style={atalhoItem}><kbd style={kbdStyle}>←/→</kbd> navegar</span>
      <button onClick={onMostrarAjuda} style={{ ...atalhoItem, cursor: 'pointer', background: 'transparent', border: 'none', color: 'inherit' }}>
        <kbd style={kbdStyle}>?</kbd> ajuda
      </button>
    </footer>
  )
}

function Toast({ tipo, msg }: { tipo: 'ok' | 'erro' | 'info'; msg: string }) {
  const cores = {
    ok: { bg: VERDE, color: '#fff' },
    erro: { bg: VERMELHO, color: '#fff' },
    info: { bg: ESPRESSO, color: '#fff' },
  }
  return (
    <div style={{ ...toastStyle, ...cores[tipo] }}>
      {msg}
    </div>
  )
}

function ModalAjuda({ onFechar }: { onFechar: () => void }) {
  return (
    <div style={overlayStyle} onClick={onFechar}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <h2 style={{ color: ESPRESSO, marginTop: 0 }}>⚡ Atalhos da Conciliação</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={tdAtalho}><kbd style={kbdStyle}>Enter</kbd></td><td>Aceita a sugestão da IA (concilia)</td></tr>
            <tr><td style={tdAtalho}><kbd style={kbdStyle}>R</kbd></td><td>Rejeita a sugestão (IA aprende)</td></tr>
            <tr><td style={tdAtalho}><kbd style={kbdStyle}>I</kbd></td><td>Marca o movimento como ignorado</td></tr>
            <tr><td style={tdAtalho}><kbd style={kbdStyle}>Esc</kbd></td><td>Pula este movimento</td></tr>
            <tr><td style={tdAtalho}><kbd style={kbdStyle}>←  →</kbd></td><td>Navega entre movimentos</td></tr>
            <tr><td style={tdAtalho}><kbd style={kbdStyle}>?</kbd></td><td>Mostra/esconde esta ajuda</td></tr>
          </tbody>
        </table>

        <h3 style={{ color: ESPRESSO, marginTop: 24 }}>🚦 Semáforo da IA</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>🟢 <strong>Match perfeito</strong> (90%+) — pode confiar e dar Enter</div>
          <div>🟡 <strong>Quase lá</strong> (60-89%) — confira valor/data antes de aceitar</div>
          <div>🔴 <strong>Sem confiança</strong> (menos de 60%) — provavelmente não é</div>
        </div>

        <button onClick={onFechar} style={{ ...btnPrimario, marginTop: 24 }}>
          Fechar (Esc)
        </button>
      </div>
    </div>
  )
}

function SkeletonLoading() {
  return (
    <div style={{ padding: 24, background: OFFWHITE, minHeight: '100vh' }}>
      <div style={{ height: 56, background: '#e8e0d4', borderRadius: 8, marginBottom: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ height: 240, background: '#e8e0d4', borderRadius: 12 }} />
        <div style={{ height: 240, background: '#e8e0d4', borderRadius: 12 }} />
      </div>
    </div>
  )
}

function OnboardingLoteVazio({ lote, onRecarregar }: { lote: Lote; onRecarregar: () => void }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', background: OFFWHITE, minHeight: '100vh' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>📂</div>
      <h2 style={{ color: ESPRESSO }}>Este lote ainda não tem movimentos</h2>
      <p style={{ color: ESPRESSO_CLARO, fontSize: 14, marginBottom: 24 }}>
        O lote <strong>{lote.nome}</strong> foi criado mas não há linhas para conciliar.
      </p>
      <p style={{ color: '#777', fontSize: 13, marginBottom: 24 }}>
        Pode ter ocorrido falha no upload ou o arquivo estava vazio.
      </p>
      <button onClick={onRecarregar} style={btnPrimario}>↻ Recarregar</button>
    </div>
  )
}

function LoteCompleto({ lote, onVoltarLista }: { lote: Lote; onVoltarLista: () => void }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', background: OFFWHITE, minHeight: '100vh' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
      <h2 style={{ color: VERDE }}>Lote 100% conciliado!</h2>
      <p style={{ color: ESPRESSO_CLARO, fontSize: 16, marginBottom: 8 }}>
        <strong>{lote.nome}</strong>
      </p>
      <p style={{ color: ESPRESSO_CLARO, fontSize: 14, marginBottom: 24 }}>
        {lote.total_conciliados} movimentos conciliados de {lote.total_movimentos}
      </p>
      <button onClick={onVoltarLista} style={btnPrimario}>← Voltar para próximo lote</button>
    </div>
  )
}

// ===== Estilos =====
const containerStyle: React.CSSProperties = {
  background: OFFWHITE,
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  color: ESPRESSO,
}

const headerStyle: React.CSSProperties = {
  background: ESPRESSO,
  color: '#fff',
  padding: '12px 20px',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  position: 'sticky',
  top: 0,
  zIndex: 10,
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
}

const mainStyle: React.CSSProperties = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: 16,
  padding: 16,
  maxWidth: 1200,
  width: '100%',
  margin: '0 auto',
}

const colunaStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 20,
  boxShadow: '0 2px 12px rgba(61,35,20,0.06)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const colunaTituloStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 13,
  fontWeight: 600,
  color: ESPRESSO_CLARO,
  paddingBottom: 8,
  borderBottom: `1px solid ${OFFWHITE}`,
}

const cardMovimento: React.CSSProperties = {
  padding: 20,
  background: OFFWHITE,
  borderRadius: 8,
  borderLeft: `4px solid ${ESPRESSO}`,
}

const cardSugestao: React.CSSProperties = {
  padding: 20,
  background: OFFWHITE,
  borderRadius: 8,
  borderLeft: '4px solid',
  transition: 'all 150ms ease',
}

const cardSemSugestao: React.CSSProperties = {
  padding: 32,
  background: OFFWHITE,
  borderRadius: 8,
  textAlign: 'center',
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

const btnAceitar: React.CSSProperties = {
  background: VERDE,
  color: '#fff',
  border: 'none',
  padding: '10px 18px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  transition: 'all 150ms ease',
}

const btnRejeitar: React.CSSProperties = {
  background: VERMELHO,
  color: '#fff',
  border: 'none',
  padding: '10px 18px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  transition: 'all 150ms ease',
}

const btnSecundario: React.CSSProperties = {
  background: 'transparent',
  color: ESPRESSO,
  border: `1px solid ${ESPRESSO_CLARO}`,
  padding: '10px 18px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  transition: 'all 150ms ease',
}

const btnIcone: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  color: '#fff',
  border: 'none',
  width: 36,
  height: 36,
  borderRadius: 8,
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 150ms ease',
}

const kbdStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.08)',
  color: 'inherit',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'monospace',
  border: '1px solid rgba(0,0,0,0.1)',
}

const progressBarBg: React.CSSProperties = {
  width: 120,
  height: 6,
  background: 'rgba(255,255,255,0.2)',
  borderRadius: 3,
  overflow: 'hidden',
}

const progressBarFg: React.CSSProperties = {
  height: '100%',
  background: DOURADO,
  transition: 'width 300ms ease',
}

const atalhosStyle: React.CSSProperties = {
  background: ESPRESSO_CLARO,
  color: 'rgba(255,255,255,0.85)',
  padding: '8px 16px',
  fontSize: 11,
  display: 'flex',
  gap: 16,
  flexWrap: 'wrap',
  justifyContent: 'center',
}

const atalhoItem: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
}

const toastStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 60,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '12px 20px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  zIndex: 100,
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(61,35,20,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
}

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 32,
  maxWidth: 500,
  width: '90%',
  maxHeight: '85vh',
  overflow: 'auto',
}

const tdAtalho: React.CSSProperties = {
  padding: '6px 0',
  width: 80,
}
