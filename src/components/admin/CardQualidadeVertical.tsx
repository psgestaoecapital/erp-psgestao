'use client'

// Card "Qualidade por Vertical" (Auditor Completo de Tela, RD-35): por área, % de telas LIBERADAS; clique abre as telas e,
// na tela, o veredito com os gaps exatos. Verde/amarelo/vermelho só como semáforo de desempenho (identidade PS: espresso,
// off-white e dourado). Dados: fn_auditor_telas_resumo() e fn_auditor_tela_completo(rota).
// Ticker do Hub (CEO 23/10, msg b76dd837 item B): quando o veredito traz 'ticker' (rotas /dashboard/projetos), mostra os
// 5 critérios com passou/falhou e "x de 5". Sem 'ticker' no retorno (fora do Hub), nada muda.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

type Resumo = { area: string; total: number; liberado: number; bloqueado: number; pct_liberado: number; sem_auditoria: number }
type Tela = { rota: string; titulo: string | null }
type CriterioTicker = { n: number; criterio: string; nome: string; passou: boolean; detalhe?: string | null; verificado_em?: string | null }
type Veredito = {
  rota: string
  veredito: string | null
  scores?: { visual?: number; funcional?: number; consistencia?: number }
  dado_bate_banco?: boolean | null
  features_faltando?: string[] | null
  gaps?: string[] | null
  analisado_em?: string | null
  ticker?: CriterioTicker[] | null
  criterios_ok?: number | null
  criterios_total?: number | null
}

const COR = { espresso: '#3D2314', fraco: 'rgba(61,35,20,0.6)', offWhite: '#FAF7F2', dourado: '#C8941A', borda: '0.5px solid rgba(61,35,20,0.14)' }
const SEMAFORO = { verde: '#2E7D32', amarelo: '#B7791F', vermelho: '#B3261E' }
const ROTA_AJUDA = '/admin/auditores'

function semaforo(pct: number) {
  if (pct >= 90) return { cor: SEMAFORO.verde, texto: 'No padrão' }
  if (pct >= 60) return { cor: SEMAFORO.amarelo, texto: 'Atenção' }
  return { cor: SEMAFORO.vermelho, texto: 'Abaixo do padrão' }
}

function nomeArea(a: string) {
  return a.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export default function CardQualidadeVertical() {
  const [linhas, setLinhas] = useState<Resumo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)
  const [telas, setTelas] = useState<Tela[]>([])
  const [rota, setRota] = useState<string | null>(null)
  const [ver, setVer] = useState<Veredito | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    supabase.rpc('fn_auditor_telas_resumo').then(({ data, error }) => {
      if (error) setErro('Não foi possível carregar a qualidade das verticais agora.')
      else setLinhas(((data as Resumo[]) ?? []).slice().sort((a, b) => a.pct_liberado - b.pct_liberado || b.total - a.total))
    })
  }, [])

  async function abrirArea(a: string) {
    setArea(a); setRota(null); setVer(null); setCarregando(true)
    const { data } = await supabase.from('system_screens').select('rota, titulo').eq('area', a).order('rota')
    setTelas((data as Tela[]) ?? [])
    setCarregando(false)
  }

  async function abrirTela(r: string) {
    setRota(r); setVer(null); setCarregando(true)
    const { data } = await supabase.rpc('fn_auditor_tela_completo', { p_rota: r })
    setVer((data as Veredito) ?? null)
    setCarregando(false)
  }

  const botao = { background: 'transparent', border: COR.borda, borderRadius: 8, padding: '10px 12px', color: COR.espresso, cursor: 'pointer', textAlign: 'left' as const, minHeight: 44 }

  return (
    <section style={{ background: '#fff', border: COR.borda, borderRadius: 12, padding: 20, marginBottom: 24 }}>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: COR.espresso, margin: 0 }}>
        Qualidade por vertical <AjudaCampo chave="auditor.qualidade.card" rota={ROTA_AJUDA} />
      </h2>
      <p style={{ fontSize: 13, color: COR.fraco, margin: '4px 0 16px' }}>
        Quanto de cada área já está liberado para uso. Toque numa área para ver as telas e o que falta.
      </p>

      {erro && <p style={{ color: SEMAFORO.vermelho, fontSize: 13 }}>{erro}</p>}
      {!erro && !linhas && <p style={{ fontSize: 13, color: COR.fraco }}>Carregando…</p>}
      {linhas && linhas.length === 0 && <p style={{ fontSize: 13, color: COR.fraco }}>Ainda não há telas auditadas. A auditoria roda sozinha a cada hora; volte em instantes.</p>}

      {linhas && !area && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {linhas.map((l) => {
            const s = semaforo(l.pct_liberado)
            return (
              <button key={l.area} type="button" onClick={() => abrirArea(l.area)} style={{ ...botao, borderLeft: `4px solid ${s.cor}` }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{nomeArea(l.area)}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.cor, fontVariantNumeric: 'tabular-nums' }}>{l.pct_liberado}%</div>
                <div style={{ fontSize: 12, color: COR.fraco }}>
                  {s.texto} · {l.liberado} liberadas de {l.total}
                  {l.sem_auditoria > 0 ? ` · ${l.sem_auditoria} ainda sem auditoria` : ''}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {area && (
        <div>
          <button type="button" onClick={() => (rota ? (setRota(null), setVer(null)) : (setArea(null), setTelas([])))} style={{ ...botao, marginBottom: 12 }}>
            ← Voltar
          </button>
          <h3 style={{ fontSize: 15, color: COR.espresso, margin: '0 0 8px' }}>{nomeArea(area)}{rota ? ` · ${rota}` : ''}</h3>
          {carregando && <p style={{ fontSize: 13, color: COR.fraco }}>Carregando…</p>}

          {!rota && !carregando && telas.length === 0 && <p style={{ fontSize: 13, color: COR.fraco }}>Nenhuma tela cadastrada nesta área.</p>}
          {!rota && (
            <div style={{ display: 'grid', gap: 6 }}>
              {telas.map((t) => (
                <button key={t.rota} type="button" onClick={() => abrirTela(t.rota)} style={botao}>
                  <span style={{ fontWeight: 600 }}>{t.titulo || t.rota}</span> <span style={{ fontSize: 12, color: COR.fraco }}>{t.rota}</span>
                </button>
              ))}
            </div>
          )}

          {rota && ver && (
            <div style={{ fontSize: 13, color: COR.espresso }}>
              <p style={{ margin: '0 0 8px' }}>
                <strong style={{ color: ver.veredito === 'LIBERADO' ? SEMAFORO.verde : SEMAFORO.vermelho }}>
                  {ver.veredito === 'LIBERADO' ? 'Liberada' : ver.veredito === 'BLOQUEADO' ? 'Bloqueada' : 'Sem auditoria ainda'}
                </strong>{' '}
                <AjudaCampo chave="auditor.qualidade.veredito" rota={ROTA_AJUDA} />
              </p>
              {(ver.ticker?.length ?? 0) > 0 && (
                <div style={{ margin: '0 0 12px', border: COR.borda, borderRadius: 8, padding: 12, background: COR.offWhite }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>
                    Ticker de qualidade: {ver.criterios_ok ?? ver.ticker!.filter((c) => c.passou).length} de {ver.criterios_total ?? ver.ticker!.length} critérios{' '}
                    <AjudaCampo chave="auditor.qualidade.ticker" rota={ROTA_AJUDA} />
                  </p>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {ver.ticker!.slice().sort((a, b) => a.n - b.n).map((c) => (
                      <li key={c.criterio} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span aria-label={c.passou ? 'passou' : 'falhou'} style={{ flex: '0 0 auto', minWidth: 56, textAlign: 'center', borderRadius: 6, padding: '2px 6px', fontSize: 12, fontWeight: 700, color: '#fff', background: c.passou ? SEMAFORO.verde : SEMAFORO.vermelho }}>
                          {c.passou ? 'Passou' : 'Falhou'}
                        </span>
                        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                          <strong>{c.n}. {c.nome}</strong>
                          {c.detalhe ? <span style={{ color: COR.fraco }}> · {c.detalhe}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ver.scores && (
                <p style={{ margin: '0 0 8px' }}>
                  Visual {ver.scores.visual ?? '—'} · Funcional {ver.scores.funcional ?? '—'} · Consistência {ver.scores.consistencia ?? '—'} (meta 90){' '}
                  <AjudaCampo chave="auditor.qualidade.notas" rota={ROTA_AJUDA} />
                </p>
              )}
              {ver.dado_bate_banco === false && <p style={{ margin: '0 0 8px' }}>Os números da tela não batem com o banco.</p>}
              {(ver.gaps?.length ?? 0) > 0 && (
                <>
                  <p style={{ margin: '8px 0 4px', fontWeight: 700 }}>O que falta <AjudaCampo chave="auditor.qualidade.gaps" rota={ROTA_AJUDA} /></p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{ver.gaps!.map((g) => <li key={g}>{g}</li>)}</ul>
                </>
              )}
              {(ver.features_faltando?.length ?? 0) > 0 && (
                <>
                  <p style={{ margin: '12px 0 4px', fontWeight: 700 }}>Funções que faltam</p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{ver.features_faltando!.map((g) => <li key={g}>{g}</li>)}</ul>
                </>
              )}
            </div>
          )}
          {rota && !ver && !carregando && <p style={{ fontSize: 13, color: COR.fraco }}>Esta tela ainda não foi auditada.</p>}
        </div>
      )}
    </section>
  )
}
