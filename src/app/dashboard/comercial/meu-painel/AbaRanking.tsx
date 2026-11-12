'use client'
// Aba "Ranking de vendedores" (premiação por desempenho) — V1 apresentável (CEO 12/11, contexto a059298b).
// Pódio 1-2-3 + tabela com a nota de cada indicador e a nota final, com alternância Mês × Ano.
// Fonte única no banco: fn_bi_comercial_ranking_pontuacao (guarda 'lider'; vendedor comum não vê o ranking).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', verde: '#3f7d4e', red: '#A32D2D', bd: '#E7DED3', bg2: '#F0ECE3', m: '#6B5D4F', d: '#9C8E80' }
const ROTA = '/dashboard/comercial/meu-painel'
const brl0 = (v: number | null | undefined) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const nota = (v: number | null | undefined) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)
const pct = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : ''}${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

type Indic = { faturamento: number; volume_kg: number; clientes: number; clientes_novos: number; cidades: number; cidades_novas: number; preco_kg: number | null; indice_preco: number | null; desconto_pct: number | null; acrescimo_pct: number | null; devolucao_pct: number | null; crescimento_fat_pct: number | null; crescimento_vol_pct: number | null }
// Notas 0-100: faturamento e volume ABSOLUTOS + crescimento de cada um (CEO 12/11: pontuar quem mais vende E quem mais cresce).
type Notas = { faturamento: number; volume: number; crescimento_fat: number; crescimento_vol: number; clientes: number; cidades: number; preco: number; desconto: number; devolucao: number }
type Vend = { cod: string; nome: string; abaixo_minimo: boolean; indicadores: Indic; notas: Notas; bloco_crescimento: number | null; bloco_margem: number | null; nota_final: number | null }
type Resp = { ok: boolean; erro?: string; base?: string; periodo?: { de: string; ate: string; de_ant: string; ate_ant: string }; pesos?: { crescimento: number; margem: number }; piso_kg?: number; vendedores?: Vend[]; podio?: { pos: number; cod: string; nome: string; nota_final: number }[] }
// Seção "Participantes do ranking": quem o gestor marca/desmarca. Desmarcado sai do pódio e da tabela, mas segue no BI.
type Part = { cod: string; nome: string; volume_kg: number; faturamento: number; incluido: boolean; motivo: string | null }
type RespParts = { ok: boolean; erro?: string; participantes?: Part[] }

// Mês = último mês FECHADO × o mês anterior (fechado × fechado). Ano = 1º de janeiro do ano do mês fechado até o
// fim dele × o mesmo intervalo do ano anterior. Nunca usa o mês corrente parcial (comparável, igual com igual).
function ranges(modo: 'mes' | 'ano') {
  const h = new Date()
  const fimMes = new Date(h.getFullYear(), h.getMonth(), 0) // último dia do último mês fechado
  const Y = fimMes.getFullYear(), M = fimMes.getMonth()
  if (modo === 'mes') {
    const de = new Date(Y, M, 1), ate = fimMes
    const deAnt = new Date(Y, M - 1, 1), ateAnt = new Date(Y, M, 0)
    return { de: iso(de), ate: iso(ate), deAnt: iso(deAnt), ateAnt: iso(ateAnt) }
  }
  const de = new Date(Y, 0, 1), ate = fimMes
  const deAnt = new Date(Y - 1, 0, 1), ateAnt = new Date(Y - 1, M + 1, 0)
  return { de: iso(de), ate: iso(ate), deAnt: iso(deAnt), ateAnt: iso(ateAnt) }
}
const MES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
function rotuloPeriodo(modo: 'mes' | 'ano', p?: { de: string; ate: string }) {
  if (!p) return ''
  const d = new Date(p.ate + 'T00:00:00')
  return modo === 'mes' ? `${MES_PT[d.getMonth()]}/${d.getFullYear()}` : `${d.getFullYear()} até ${MES_PT[d.getMonth()]}`
}

// Colunas de nota: faturamento e volume ABSOLUTOS lado a lado com o crescimento de cada um (transparência pedida pelo CEO).
const COLS: { k: keyof Notas; rot: string }[] = [
  { k: 'faturamento', rot: 'Fatur.' }, { k: 'crescimento_fat', rot: 'Cresc. R$' },
  { k: 'volume', rot: 'Volume' }, { k: 'crescimento_vol', rot: 'Cresc. kg' },
  { k: 'clientes', rot: 'Clientes' }, { k: 'cidades', rot: 'Cidades' }, { k: 'preco', rot: 'Preço' },
  { k: 'desconto', rot: 'Desc.' }, { k: 'devolucao', rot: 'Devol.' },
]
const notaCor = (n: number | null | undefined) => n == null ? C.m : n >= 75 ? C.verde : n >= 45 ? C.gold : C.red

export function AbaRanking({ empresa }: { empresa: string | null }) {
  const [modo, setModo] = useState<'mes' | 'ano'>('mes')
  const [resp, setResp] = useState<Resp | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const r = useMemo(() => ranges(modo), [modo])

  // Participantes do ranking (seção de gestão): lista e marca/desmarca quem entra.
  const [parts, setParts] = useState<Part[] | null>(null)
  const [partsAberto, setPartsAberto] = useState(false)
  const [salvando, setSalvando] = useState<string | null>(null)

  const carregar = useCallback(async (cid: string) => {
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_bi_comercial_ranking_pontuacao', {
      p_company_id: cid, p_dt_ini: r.de, p_dt_fim: r.ate, p_dt_ini_ant: r.deAnt, p_dt_fim_ant: r.ateAnt,
    })
    if (error) { setErro(erroAmigavel(error)); setResp(null) }
    else { const d = data as Resp; setResp(d); if (!d?.ok) setErro(d?.erro === 'sem_acesso_comercial' ? 'Só diretores/gestores comerciais veem o ranking.' : (d?.erro ?? null)) }
    setCarregando(false)
  }, [r])

  const carregarParts = useCallback(async (cid: string) => {
    const { data } = await supabase.rpc('fn_com_ranking_participantes_listar', { p_company_id: cid, p_dt_ini: r.de, p_dt_fim: r.ate })
    const d = data as RespParts | null
    setParts(d?.ok ? (d.participantes ?? []) : [])
  }, [r])

  const togglePart = useCallback(async (cod: string, incluido: boolean) => {
    if (!empresa) return
    setSalvando(cod)
    const { error } = await supabase.rpc('fn_com_ranking_participante_definir', { p_company_id: empresa, p_cod_vendedor: cod, p_incluido: incluido, p_motivo: null })
    if (!error) { await Promise.all([carregarParts(empresa), carregar(empresa)]) }
    setSalvando(null)
  }, [empresa, carregar, carregarParts])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (empresa) { void carregar(empresa); void carregarParts(empresa) } }, [empresa, carregar, carregarParts])

  if (!empresa) return <Aviso t="Escolha uma empresa" l="Selecione uma empresa específica no topo para ver o ranking." />
  if (erro) return <Aviso t="Ranking" l={erro} />
  if (carregando && !resp) return <div style={{ color: C.m, fontSize: 13, padding: 12 }}>Montando o ranking…</div>

  const vend = resp?.vendedores ?? []
  const podio = resp?.podio ?? []
  // ordem do pódio para o visual: 2º, 1º, 3º (degrau central mais alto)
  const ordemPodio = [podio.find(p => p.pos === 2), podio.find(p => p.pos === 1), podio.find(p => p.pos === 3)].filter(Boolean) as typeof podio

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* controles */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 3, background: '#fff', border: `0.5px solid ${C.bd}`, borderRadius: 999, padding: 3 }}>
          {(['mes', 'ano'] as const).map(k => (
            <button key={k} type="button" onClick={() => setModo(k)} style={pill(modo === k)}>{k === 'mes' ? 'Ranking do mês' : 'Placar do ano'}</button>
          ))}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: C.esp }}>
          Como é calculado <AjudaCampo chave="comercial.ranking.como" rota={ROTA} />
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.m }}>Pesos {Math.round((resp?.pesos?.crescimento ?? 0.5) * 100)}% crescimento · {Math.round((resp?.pesos?.margem ?? 0.5) * 100)}% margem · <em>edição em breve</em></span>
      </div>

      {resp?.periodo && (
        <div style={{ fontSize: 11.5, color: C.m, marginTop: -4 }}>
          {modo === 'mes' ? 'Mês fechado' : 'Ano'}: <strong style={{ color: C.esp }}>{rotuloPeriodo(modo, resp.periodo)}</strong>
          {' '}· sobre vendas de carne (sem despojo/subproduto){resp.piso_kg ? ` · mínimo ${new Intl.NumberFormat('pt-BR').format(resp.piso_kg)} kg` : ''}
        </div>
      )}

      {/* pódio */}
      {ordemPodio.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, alignItems: 'end' }}>
          {ordemPodio.map(p => {
            const topo = p.pos === 1
            const medal = p.pos === 1 ? '🥇' : p.pos === 2 ? '🥈' : '🥉'
            return (
              <div key={p.cod} style={{ background: topo ? '#FBF3DE' : '#fff', border: `${topo ? 1 : 0.5}px solid ${topo ? C.gold : C.bd}`, borderRadius: 14, padding: topo ? '18px 14px' : '13px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: topo ? 30 : 24 }}>{medal}</div>
                <div style={{ fontSize: topo ? 15 : 13.5, fontWeight: 800, color: C.esp, marginTop: 4, wordBreak: 'break-word' }}>{p.nome}</div>
                <div style={{ fontSize: topo ? 30 : 24, fontWeight: 800, color: C.gold, lineHeight: 1.1, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{nota(p.nota_final)}</div>
                <div style={{ fontSize: 10.5, color: C.m }}>nota final · {p.pos}º lugar</div>
              </div>
            )
          })}
        </div>
      )}

      {/* tabela completa */}
      <div style={{ background: '#fff', border: `0.5px solid ${C.bd}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 14px', borderBottom: `0.5px solid ${C.bd}` }}>
          <strong style={{ fontSize: 13.5, color: C.esp }}>Todos os vendedores</strong>
          <span style={{ fontSize: 11, color: C.m }}>· nota 0–100 por indicador (melhor do período = 100)</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.off }}>
                <th style={thL}>#</th>
                <th style={thL}>Vendedor</th>
                <th style={thR}>Faturamento</th>
                <th style={thR}>Δ vs ant.</th>
                <th style={thR}><span style={{ display: 'inline-flex', alignItems: 'center' }}>Nota final<AjudaCampo chave="comercial.ranking.nota_final" rota={ROTA} /></span></th>
                <th style={thR}>Bloco cresc.</th>
                <th style={thR}>Bloco marg.</th>
                <th style={thRmini} colSpan={COLS.length}>Notas por indicador (0–100)</th>
              </tr>
              <tr style={{ background: C.off }}>
                <th style={thL} colSpan={5}></th>
                <th style={thR}></th><th style={thR}></th>
                {COLS.map(c => <th key={c.k} style={thRmini}>{
                  c.k === 'desconto' ? <span style={{ display: 'inline-flex', alignItems: 'center' }}>{c.rot}<AjudaCampo chave="comercial.ranking.acrescimo" rota={ROTA} /></span>
                  : c.k === 'preco' ? <span style={{ display: 'inline-flex', alignItems: 'center' }}>{c.rot}<AjudaCampo chave="comercial.ranking.preco" rota={ROTA} /></span>
                  : c.rot}</th>)}
              </tr>
            </thead>
            <tbody>
              {vend.map((v, i) => (
                <tr key={v.cod} style={{ borderTop: `0.5px solid ${C.bd}`, background: v.abaixo_minimo ? '#FBF7EC' : '#fff' }}>
                  <td style={{ ...tdL, color: C.m, fontWeight: 700 }}>{v.abaixo_minimo ? '—' : i + 1}</td>
                  <td style={tdL}>
                    <span style={{ fontWeight: 700, color: C.esp }}>{v.nome}</span>
                    {v.indicadores.acrescimo_pct != null && <span title="Vendeu acima da tabela — acréscimo conta a favor da margem" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: C.verde, background: '#E6F1E9', borderRadius: 999, padding: '1px 7px' }}>acréscimo +{nota(v.indicadores.acrescimo_pct)}%</span>}
                    {v.abaixo_minimo && <span title="Volume de carteira abaixo do mínimo — fora do pódio" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#8A6A1E', background: '#F3E6C9', borderRadius: 999, padding: '1px 7px' }}>abaixo do mínimo<AjudaCampo chave="comercial.ranking.piso" rota={ROTA} /></span>}
                  </td>
                  <td style={tdR}>{brl0(v.indicadores.faturamento)}</td>
                  <td style={{ ...tdR, color: (v.indicadores.crescimento_fat_pct ?? 0) >= 0 ? C.verde : C.red }}>{pct(v.indicadores.crescimento_fat_pct)}</td>
                  <td style={{ ...tdR, fontWeight: 800, fontSize: 14, color: notaCor(v.nota_final) }}>{nota(v.nota_final)}</td>
                  <td style={tdR}>{nota(v.bloco_crescimento)}</td>
                  <td style={tdR}>{nota(v.bloco_margem)}</td>
                  {COLS.map(c => <td key={c.k} style={{ ...tdRmini, color: notaCor(v.notas[c.k]) }}>{nota(v.notas[c.k])}</td>)}
                </tr>
              ))}
              {vend.length === 0 && <tr><td colSpan={7 + COLS.length} style={{ padding: 18, textAlign: 'center', color: C.m }}>Sem vendas no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {/* Participantes do ranking — o gestor marca/desmarca quem entra (ex. sócio/diretor que vende sai da disputa) */}
      <div style={{ background: '#fff', border: `0.5px solid ${C.bd}`, borderRadius: 14, overflow: 'hidden' }}>
        <button type="button" onClick={() => setPartsAberto(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '11px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <strong style={{ fontSize: 13.5, color: C.esp }}>Participantes do ranking</strong>
          <AjudaCampo chave="comercial.ranking.participantes" rota={ROTA} />
          <span style={{ fontSize: 11, color: C.m }}>· marque quem entra na disputa</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 16, color: C.m, transform: partsAberto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
        </button>
        {partsAberto && (
          <div style={{ borderTop: `0.5px solid ${C.bd}`, padding: '4px 0' }}>
            {parts == null && <div style={{ padding: 12, fontSize: 12, color: C.m }}>Carregando participantes…</div>}
            {parts && parts.length === 0 && <div style={{ padding: 12, fontSize: 12, color: C.m }}>Sem vendedores com venda no período.</div>}
            {parts && parts.map(p => (
              <label key={p.cod} data-ajuda="comercial.ranking.participantes" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: `0.5px solid ${C.bg2}`, cursor: 'pointer' }}>
                <input type="checkbox" checked={p.incluido} disabled={salvando === p.cod} onChange={e => void togglePart(p.cod, e.target.checked)} style={{ width: 16, height: 16, accentColor: C.gold, cursor: 'pointer' }} />
                <span style={{ fontWeight: 700, color: p.incluido ? C.esp : C.d, fontSize: 13 }}>{p.nome}</span>
                <span style={{ fontSize: 11, color: C.m }}>{brl0(p.faturamento)}</span>
                {!p.incluido && <span style={{ fontSize: 10, fontWeight: 700, color: C.m, background: C.bg2, borderRadius: 999, padding: '1px 7px' }}>fora do ranking</span>}
                {salvando === p.cod && <span style={{ fontSize: 11, color: C.d }}>salvando…</span>}
              </label>
            ))}
            {parts && parts.length > 0 && <div style={{ padding: '8px 14px', fontSize: 11, color: C.m }}>Quem sai do ranking continua normalmente no restante do painel comercial.</div>}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: C.m }}>
        Ainda não entram na nota (chegam na próxima versão): mix nobre × comum e prazo médio de pagamento.
      </div>
    </div>
  )
}

const pill = (on: boolean): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', border: 'none', background: on ? C.gold : 'transparent', color: on ? '#fff' : C.m })
const thL: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: C.m, whiteSpace: 'nowrap' }
const thR: React.CSSProperties = { ...thL, textAlign: 'right' }
const thRmini: React.CSSProperties = { ...thR, fontSize: 10, color: C.d }
const tdL: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap' }
const tdR: React.CSSProperties = { ...tdL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const tdRmini: React.CSSProperties = { ...tdR, fontSize: 11 }

function Aviso({ t, l }: { t: string; l: string }) {
  return <div style={{ background: '#fff', border: `1px dashed ${C.bd}`, borderRadius: 14, padding: '26px 18px', textAlign: 'center' }}>
    <div style={{ fontSize: 15, fontWeight: 700, color: C.esp }}>{t}</div>
    <div style={{ fontSize: 13, color: C.m, marginTop: 4 }}>{l}</div>
  </div>
}
