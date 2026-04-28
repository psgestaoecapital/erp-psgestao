'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Modulo = { module: string; ok: boolean; source_count: number; erp_count: number }
type Linha = {
  company_data_source_id: string
  company_id: string
  empresa: { id: string; nome_fantasia: string; razao_social: string }
  conector: { slug: string; nome: string }
  modules_ativos: string[]
  status: 'ok' | 'divergencia' | 'nunca_executada' | 'rate_limited'
  paridade_status: string | null
  ultima_reconciliacao_em: string | null
  ultimo_sync_em: string | null
  ultimo_sync_status: string | null
  rate_limit_bloqueado_ate: string | null
  rate_limit_motivo: string | null
  rate_limit_segundos_restantes: number | null
  resumo: { total: number; ok: number; divergentes: number; erros: number; por_modulo: Modulo[] }
}
type Totais = Record<'total' | 'ok' | 'divergencia' | 'nunca_executada' | 'rate_limited', number>

// Paleta PS Gestão
const C = {
  espresso: '#3D2314',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#2d6a3e',
  greenBg: '#e8f3ec',
  amber: '#8a6a10',
  amberBg: '#fdf4e0',
  red: '#a02020',
  redBg: '#fce8e8',
  orange: '#a06020',
  orangeBg: '#fcf0e0',
  gray: '#6b6b6b',
  grayBg: '#efece6',
}

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatarCountdown(seg: number | null): string {
  if (seg == null || seg <= 0) return '—'
  const m = Math.floor(seg / 60)
  const s = seg % 60
  if (m <= 0) return `${s}s`
  return `${m}m ${s}s`
}

function StatusBadge({ status, countdown }: { status: Linha['status']; countdown?: string }) {
  const map: Record<Linha['status'], { bg: string; fg: string; label: string }> = {
    ok: { bg: C.greenBg, fg: C.green, label: 'OK' },
    divergencia: { bg: C.redBg, fg: C.red, label: 'Divergência' },
    nunca_executada: { bg: C.grayBg, fg: C.gray, label: 'Nunca executada' },
    rate_limited: { bg: C.orangeBg, fg: C.orange, label: 'Rate-limited' },
  }
  const s = map[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: s.bg,
        color: s.fg,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: s.fg,
          display: 'inline-block',
        }}
      />
      {s.label}
      {status === 'rate_limited' && countdown && countdown !== '—' && (
        <span style={{ fontWeight: 500, opacity: 0.85 }}>· liberado em {countdown}</span>
      )}
    </span>
  )
}

export default function AdminConectoresPage() {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [totais, setTotais] = useState<Totais | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroEmpresa, setFiltroEmpresa] = useState('')
  const [filtroConector, setFiltroConector] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'' | Linha['status']>('')
  const [rodando, setRodando] = useState<string | null>(null) // company_data_source_id em execução
  const [mensagem, setMensagem] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    setCarregando(true)
    try {
      const res = await fetch('/api/connectors/status', { cache: 'no-store' })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'falha ao carregar')
      setLinhas(j.conectores || [])
      setTotais(j.totais || null)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const linhasFiltradas = useMemo(() => {
    return linhas.filter((l: Linha) => {
      if (filtroEmpresa) {
        const q = filtroEmpresa.toLowerCase()
        const hay = `${l.empresa.nome_fantasia} ${l.empresa.razao_social}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filtroConector && l.conector.slug !== filtroConector) return false
      if (filtroStatus && l.status !== filtroStatus) return false
      return true
    })
  }, [linhas, filtroEmpresa, filtroConector, filtroStatus])

  const slugsDisponiveis = useMemo(() => {
    const set = new Set<string>()
    for (const l of linhas) if (l.conector.slug) set.add(l.conector.slug)
    return Array.from(set).sort()
  }, [linhas])

  async function reconciliar(l: Linha) {
    setRodando(l.company_data_source_id)
    setMensagem(null)
    try {
      const res = await fetch('/api/connectors/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: l.company_id,
          source_slug: l.conector.slug,
          force: true,
        }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'falha')
      setMensagem(
        `Reconciliado ${l.empresa.nome_fantasia} / ${l.conector.nome} — paridade: ${j.paridade_geral}`
      )
      await carregar()
    } catch (e: any) {
      setMensagem(`Erro: ${e.message}`)
    } finally {
      setRodando(null)
      setTimeout(() => setMensagem(null), 6000)
    }
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ marginBottom: 24 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              opacity: 0.5,
              margin: 0,
            }}
          >
            Administração
          </p>
          <h1
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 32,
              fontWeight: 400,
              margin: '4px 0 6px',
            }}
          >
            Conectores
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
            Status de paridade entre fontes externas e tabelas ERP. Rode reconciliações manuais a
            partir dessa tela.
          </p>
        </header>

        {erro && (
          <div
            style={{
              backgroundColor: C.redBg,
              color: C.red,
              padding: '12px 16px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {erro}
          </div>
        )}

        {mensagem && (
          <div
            style={{
              backgroundColor: C.amberBg,
              color: C.amber,
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {mensagem}
          </div>
        )}

        {/* Totais */}
        {totais && (
          <section style={{ marginBottom: 24 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 12,
              }}
            >
              <Card label="Total" valor={totais.total} cor={C.espresso} />
              <Card label="OK" valor={totais.ok} cor={C.green} />
              <Card label="Divergência" valor={totais.divergencia} cor={C.red} />
              <Card label="Rate-limited" valor={totais.rate_limited} cor={C.orange} />
              <Card label="Nunca executada" valor={totais.nunca_executada} cor={C.gray} />
            </div>
          </section>
        )}

        {/* Filtros */}
        <section
          style={{
            backgroundColor: 'white',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          <input
            type="text"
            placeholder="Filtrar por empresa…"
            value={filtroEmpresa}
            onChange={(e: any) => setFiltroEmpresa(e.target.value)}
            style={{
              flex: '1 1 200px',
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${C.borderLt}`,
              fontSize: 13,
              backgroundColor: C.offwhite,
              color: C.ink,
            }}
          />
          <select
            value={filtroConector}
            onChange={(e: any) => setFiltroConector(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${C.borderLt}`,
              fontSize: 13,
              backgroundColor: 'white',
              minWidth: 140,
            }}
          >
            <option value="">Todos os conectores</option>
            {slugsDisponiveis.map((s: string) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filtroStatus}
            onChange={(e: any) => setFiltroStatus(e.target.value as any)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${C.borderLt}`,
              fontSize: 13,
              backgroundColor: 'white',
              minWidth: 150,
            }}
          >
            <option value="">Todos os status</option>
            <option value="ok">OK</option>
            <option value="divergencia">Divergência</option>
            <option value="rate_limited">Rate-limited</option>
            <option value="nunca_executada">Nunca executada</option>
          </select>
          <button
            onClick={carregar}
            disabled={carregando}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${C.borderLt}`,
              backgroundColor: 'white',
              color: C.espresso,
              fontSize: 13,
              fontWeight: 600,
              cursor: carregando ? 'not-allowed' : 'pointer',
              opacity: carregando ? 0.6 : 1,
            }}
          >
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
            {linhasFiltradas.length} de {linhas.length}
          </span>
        </section>

        {/* Tabela */}
        <section
          style={{
            backgroundColor: 'white',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th>Empresa</Th>
                  <Th>Conector</Th>
                  <Th>Status</Th>
                  <Th>Última check</Th>
                  <Th>Módulos (ok / div / erro)</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {linhasFiltradas.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: '32px 16px',
                        textAlign: 'center',
                        color: C.muted,
                        fontSize: 13,
                      }}
                    >
                      {carregando ? 'Carregando…' : 'Nenhum conector encontrado com esses filtros'}
                    </td>
                  </tr>
                )}
                {linhasFiltradas.map((l: Linha, i: number) => {
                  const countdown = formatarCountdown(l.rate_limit_segundos_restantes)
                  return (
                    <tr
                      key={l.company_data_source_id}
                      style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}
                    >
                      <Td>
                        <div style={{ fontWeight: 600 }}>{l.empresa.nome_fantasia || '—'}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          {l.empresa.razao_social}
                        </div>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{l.conector.nome}</div>
                        <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
                          {l.conector.slug}
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge status={l.status} countdown={countdown} />
                        {l.rate_limit_motivo && l.status === 'rate_limited' && (
                          <div
                            style={{
                              fontSize: 11,
                              color: C.muted,
                              marginTop: 4,
                              maxWidth: 260,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={l.rate_limit_motivo}
                          >
                            {l.rate_limit_motivo}
                          </div>
                        )}
                      </Td>
                      <Td mono>{formatarData(l.ultima_reconciliacao_em)}</Td>
                      <Td>
                        <span style={{ color: C.green, fontWeight: 600 }}>{l.resumo.ok}</span>
                        {' / '}
                        <span
                          style={{
                            color: l.resumo.divergentes > 0 ? C.red : C.muted,
                            fontWeight: l.resumo.divergentes > 0 ? 600 : 400,
                          }}
                        >
                          {l.resumo.divergentes}
                        </span>
                        {' / '}
                        <span
                          style={{
                            color: l.resumo.erros > 0 ? C.orange : C.muted,
                            fontWeight: l.resumo.erros > 0 ? 600 : 400,
                          }}
                        >
                          {l.resumo.erros}
                        </span>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          módulos: {l.modules_ativos.join(', ') || '—'}
                        </div>
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => reconciliar(l)}
                            disabled={
                              rodando === l.company_data_source_id ||
                              l.status === 'rate_limited'
                            }
                            style={{
                              padding: '6px 12px',
                              borderRadius: 6,
                              border: 'none',
                              backgroundColor:
                                l.status === 'rate_limited' ? C.grayBg : C.espresso,
                              color: l.status === 'rate_limited' ? C.gray : 'white',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor:
                                rodando === l.company_data_source_id ||
                                l.status === 'rate_limited'
                                  ? 'not-allowed'
                                  : 'pointer',
                              opacity: rodando === l.company_data_source_id ? 0.6 : 1,
                            }}
                            title={
                              l.status === 'rate_limited'
                                ? `Bloqueado até ${formatarData(l.rate_limit_bloqueado_ate)}`
                                : 'Força reconciliação ignorando cache'
                            }
                          >
                            {rodando === l.company_data_source_id
                              ? 'Rodando…'
                              : 'Reconciliar agora'}
                          </button>
                          <button
                            onClick={() =>
                              alert('Histórico por empresa × conector — em breve (TODO)')
                            }
                            style={{
                              padding: '6px 12px',
                              borderRadius: 6,
                              border: `1px solid ${C.borderLt}`,
                              backgroundColor: 'white',
                              color: C.espresso,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Ver histórico
                          </button>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function Card({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: 12,
        padding: '14px 16px',
        boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          opacity: 0.55,
          margin: 0,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 28,
          fontWeight: 400,
          margin: '2px 0 0',
          color: cor,
        }}
      >
        {valor}
      </p>
    </div>
  )
}

function Th({ children }: { children: any }) {
  return (
    <th
      style={{
        padding: '12px 16px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: 'rgba(61, 35, 20, 0.65)',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, mono }: { children: any; mono?: boolean }) {
  return (
    <td
      style={{
        padding: '12px 16px',
        verticalAlign: 'top',
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
      }}
    >
      {children}
    </td>
  )
}
