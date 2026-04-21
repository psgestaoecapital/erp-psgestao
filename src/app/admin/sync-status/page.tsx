'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

// ============================================================
// Tipos
// ============================================================

type StatusGeral = {
  agora_utc: string
  agora_local: string
  crons_ativos: number
  empresas_agendadas: number
  syncs_ultimas_24h: number
  syncs_sucesso_24h: number
  syncs_falha_24h: number
  syncs_em_andamento: number
  proximo_sync: {
    empresa: string
    minuto_da_hora: number
    em_minutos: number
  } | null
}

type UltimoSync = {
  id: string
  empresa: string
  iniciado_em: string
  iniciado_local: string
  finalizado_em: string | null
  duracao_s: number | null
  fase: string
  trigger_type: string
  http_status: number | null
  sync_counts: Record<string, number> | null
  erro: string | null
}

type ResumoEmpresa = {
  company_id: string
  empresa: string
  minuto_agendado: number
  ultimo_sync: string | null
  ultimo_sync_local: string | null
  ultimo_sync_fase: string | null
  duracao_media_s: number | null
  total_24h: number
  sucessos_24h: number
  falhas_24h: number
  taxa_sucesso_24h: number | null
}

// ============================================================
// Utilitários de estilo
// ============================================================

const coresFase: Record<string, { bg: string; fg: string; label: string }> = {
  sucesso: { bg: '#e8f3ec', fg: '#2d6a3e', label: 'Sucesso' },
  falha: { bg: '#fce8e8', fg: '#a02020', label: 'Falha' },
  timeout: { bg: '#fcf0e0', fg: '#a06020', label: 'Timeout' },
  sync_omie: { bg: '#fdf4e0', fg: '#8a6a10', label: 'Em sync' },
  etl: { bg: '#fdf4e0', fg: '#8a6a10', label: 'Em ETL' },
  iniciando: { bg: '#fdf4e0', fg: '#8a6a10', label: 'Iniciando' },
}

function Badge({ fase }: { fase: string }) {
  const c = coresFase[fase] || { bg: '#eee', fg: '#555', label: fase }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: c.bg,
        color: c.fg,
        letterSpacing: 0.2,
      }}
    >
      {c.label}
    </span>
  )
}

// ============================================================
// Página
// ============================================================

export default function SyncStatusPage() {
  const supabase = createClientComponentClient()

  const [statusGeral, setStatusGeral] = useState<StatusGeral | null>(null)
  const [ultimos, setUltimos] = useState<UltimoSync[]>([])
  const [resumo, setResumo] = useState<ResumoEmpresa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null)
  const [mensagemAcao, setMensagemAcao] = useState<string | null>(null)

  const carregarDados = useCallback(async () => {
    const [sg, us, re] = await Promise.all([
      supabase.rpc('fn_sync_status_geral'),
      supabase.rpc('fn_sync_ultimos', { p_limit: 50 }),
      supabase.rpc('fn_sync_resumo_empresas'),
    ])

    if (sg.data) setStatusGeral(sg.data as StatusGeral)
    if (us.data) setUltimos(us.data as UltimoSync[])
    if (re.data) setResumo(re.data as ResumoEmpresa[])

    setUltimaAtualizacao(new Date())
    setCarregando(false)
  }, [supabase])

  useEffect(() => {
    carregarDados()
    const intervalo = setInterval(carregarDados, 30_000) // 30s
    return () => clearInterval(intervalo)
  }, [carregarDados])

  const executarAcao = async (acao: string, companyId?: string) => {
    setMensagemAcao(null)
    const { data, error } = await supabase.rpc('fn_sync_controle', {
      p_acao: acao,
      p_company_id: companyId ?? null,
    })
    if (error) {
      setMensagemAcao(`Erro: ${error.message}`)
      return
    }
    setMensagemAcao((data as { mensagem?: string })?.mensagem ?? 'Ação executada')
    setTimeout(() => setMensagemAcao(null), 4000)
    carregarDados()
  }

  if (carregando) {
    return (
      <main
        style={{
          minHeight: '100vh',
          backgroundColor: '#FAF7F2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#3D2314',
        }}
      >
        <p style={{ opacity: 0.6 }}>Carregando status de sincronização…</p>
      </main>
    )
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#FAF7F2',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#3D2314',
        padding: '32px 24px 64px',
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        {/* ============================================================
            Cabeçalho
         ============================================================ */}
        <header style={{ marginBottom: 32 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 2,
              textTransform: 'uppercase',
              opacity: 0.5,
              margin: 0,
            }}
          >
            PS Gestão · Administração
          </p>
          <h1
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 40,
              fontWeight: 400,
              margin: '4px 0 0',
              letterSpacing: -0.5,
            }}
          >
            Status de Sincronização
          </h1>
          <p
            style={{
              fontSize: 14,
              opacity: 0.6,
              margin: '8px 0 0',
            }}
          >
            Monitor em tempo real dos syncs automáticos com o Omie · atualiza a cada 30s
            {ultimaAtualizacao && (
              <span style={{ marginLeft: 12, opacity: 0.8 }}>
                · última atualização {ultimaAtualizacao.toLocaleTimeString('pt-BR')}
              </span>
            )}
          </p>
        </header>

        {/* ============================================================
            SEÇÃO 1 — Status geral (cards)
         ============================================================ */}
        {statusGeral && (
          <section style={{ marginBottom: 40 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 16,
              }}
            >
              <Card
                titulo="Crons ativos"
                valor={`${statusGeral.crons_ativos} / 2`}
                destaque={statusGeral.crons_ativos === 2 ? 'ok' : 'alerta'}
              />
              <Card titulo="Empresas agendadas" valor={String(statusGeral.empresas_agendadas)} />
              <Card
                titulo="Syncs nas últimas 24h"
                valor={String(statusGeral.syncs_ultimas_24h)}
                detalhe={`${statusGeral.syncs_sucesso_24h} sucesso · ${statusGeral.syncs_falha_24h} falha`}
              />
              <Card
                titulo="Em andamento"
                valor={String(statusGeral.syncs_em_andamento)}
                destaque={statusGeral.syncs_em_andamento > 0 ? 'ativo' : undefined}
              />
              {statusGeral.proximo_sync && (
                <Card
                  titulo="Próximo sync"
                  valor={statusGeral.proximo_sync.empresa.split(' ')[0]}
                  detalhe={`em ${statusGeral.proximo_sync.em_minutos} min (minuto ${statusGeral.proximo_sync.minuto_da_hora})`}
                />
              )}
            </div>
          </section>
        )}

        {/* ============================================================
            SEÇÃO 3 — Resumo por empresa
         ============================================================ */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 24,
              fontWeight: 400,
              margin: '0 0 16px',
            }}
          >
            Por empresa
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {resumo.map((e) => (
              <div
                key={e.company_id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: 12,
                  padding: 20,
                  boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
                }}
              >
                <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
                  Minuto {e.minuto_agendado}
                </p>
                <h3 style={{ fontSize: 18, fontWeight: 600, margin: '4px 0 12px', lineHeight: 1.2 }}>
                  {e.empresa}
                </h3>

                {e.ultimo_sync_fase && (
                  <div style={{ marginBottom: 12 }}>
                    <Badge fase={e.ultimo_sync_fase} />
                    <span style={{ marginLeft: 8, fontSize: 13, opacity: 0.7 }}>
                      {e.ultimo_sync_local || '—'}
                    </span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>Taxa sucesso 24h</p>
                    <p style={{ fontSize: 20, fontWeight: 600, margin: '2px 0 0', color: '#C8941A' }}>
                      {e.taxa_sucesso_24h != null ? `${e.taxa_sucesso_24h}%` : '—'}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>Duração média</p>
                    <p style={{ fontSize: 20, fontWeight: 600, margin: '2px 0 0' }}>
                      {e.duracao_media_s ? `${e.duracao_media_s}s` : '—'}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>Total 24h</p>
                    <p style={{ fontSize: 16, fontWeight: 600, margin: '2px 0 0' }}>{e.total_24h}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>Falhas 24h</p>
                    <p style={{ fontSize: 16, fontWeight: 600, margin: '2px 0 0', color: e.falhas_24h > 0 ? '#a02020' : undefined }}>
                      {e.falhas_24h}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => executarAcao('sync_agora', e.company_id)}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: '#3D2314',
                    color: 'white',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    letterSpacing: 0.3,
                  }}
                >
                  Sincronizar agora
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ============================================================
            SEÇÃO 4 — Controles globais
         ============================================================ */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 24,
              fontWeight: 400,
              margin: '0 0 16px',
            }}
          >
            Controles
          </h2>
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={() => executarAcao('pausar_todos')}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid #a02020',
                backgroundColor: 'white',
                color: '#a02020',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ⏸ Pausar todos os crons
            </button>
            <button
              onClick={() => executarAcao('reativar_todos')}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: '#C8941A',
                color: 'white',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ▶ Reativar todos
            </button>
            {mensagemAcao && (
              <span style={{ fontSize: 13, color: '#2d6a3e', fontWeight: 500 }}>
                {mensagemAcao}
              </span>
            )}
          </div>
        </section>

        {/* ============================================================
            SEÇÃO 2 — Tabela de últimos syncs
         ============================================================ */}
        <section>
          <h2
            style={{
              fontFamily: 'Fraunces, Georgia, serif',
              fontSize: 24,
              fontWeight: 400,
              margin: '0 0 16px',
            }}
          >
            Últimas sincronizações
          </h2>
          <div
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
                  <tr style={{ backgroundColor: '#f5f0e8' }}>
                    <Th>Empresa</Th>
                    <Th>Início</Th>
                    <Th>Duração</Th>
                    <Th>Status</Th>
                    <Th>Gatilho</Th>
                    <Th>A Pagar / Receber</Th>
                    <Th>Clientes</Th>
                    <Th>Erro</Th>
                  </tr>
                </thead>
                <tbody>
                  {ultimos.map((l, i) => (
                    <tr
                      key={l.id}
                      style={{
                        borderTop: i === 0 ? 'none' : '1px solid #f0ebe0',
                      }}
                    >
                      <Td>
                        <span style={{ fontWeight: 500 }}>{l.empresa.split(' ')[0]}</span>
                      </Td>
                      <Td mono>{l.iniciado_local}</Td>
                      <Td mono>{l.duracao_s != null ? `${l.duracao_s}s` : '—'}</Td>
                      <Td>
                        <Badge fase={l.fase} />
                      </Td>
                      <Td>
                        <span style={{ fontSize: 11, opacity: 0.7 }}>{l.trigger_type}</span>
                      </Td>
                      <Td mono>
                        {l.sync_counts
                          ? `${l.sync_counts.contas_pagar ?? 0} / ${l.sync_counts.contas_receber ?? 0}`
                          : '—'}
                      </Td>
                      <Td mono>{l.sync_counts?.clientes ?? '—'}</Td>
                      <Td>
                        {l.erro && (
                          <span
                            style={{
                              fontSize: 12,
                              color: '#a02020',
                              maxWidth: 200,
                              display: 'inline-block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={l.erro}
                          >
                            {l.erro}
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ultimos.length === 0 && (
              <p style={{ padding: 24, textAlign: 'center', opacity: 0.5, fontSize: 13 }}>
                Nenhum sync registrado ainda.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

// ============================================================
// Componentes auxiliares
// ============================================================

function Card({
  titulo,
  valor,
  detalhe,
  destaque,
}: {
  titulo: string
  valor: string
  detalhe?: string
  destaque?: 'ok' | 'alerta' | 'ativo'
}) {
  const corValor =
    destaque === 'ok' ? '#2d6a3e' :
    destaque === 'alerta' ? '#a02020' :
    destaque === 'ativo' ? '#C8941A' :
    '#3D2314'

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)',
      }}
    >
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
        {titulo}
      </p>
      <p
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 32,
          fontWeight: 400,
          margin: '6px 0 0',
          color: corValor,
          letterSpacing: -0.3,
        }}
      >
        {valor}
      </p>
      {detalhe && (
        <p style={{ fontSize: 12, opacity: 0.65, margin: '4px 0 0' }}>{detalhe}</p>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '12px 16px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 1,
        textTransform: 'uppercase',
        opacity: 0.6,
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  mono,
}: {
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <td
      style={{
        padding: '12px 16px',
        fontSize: 13,
        fontFamily: mono ? 'JetBrains Mono, Menlo, monospace' : undefined,
        color: '#3D2314',
      }}
    >
      {children}
    </td>
  )
}
