'use client'
// Painel de Codes · "Avanço por vertical" (CEO 16/10): % mapeado/essencial/provado por jornada de cada vertical do blueprint,
// ondas 200–211 do Hub e evolução diária. Fonte: fn_dev_avanco_vertical (guarda equipe PS). Sem Realtime: recarrega a cada 5 min.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { supabase } from '@/lib/supabase'
import { fmtPct, nomeVertical, ordenar, resumoOndas, semaforo, serieHistorico, totalOnda, type Cobertura, type OndaHub, type PontoHistorico } from '@/lib/dev/avancoVertical'

const ESP = '#3D2314', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const COR = { verde: '#166534', amarelo: '#B7791F', vermelho: '#B91C1C', neutro: TXM } as const
const ROTA = '/dashboard/dev/codes'
const CORES_LINHA = [ESP, DOU, '#7C5A3C', '#A68A64', '#4B3A2A', '#D9B96A', '#8A6F4D']

function Barra({ pct, rotulo, ajuda }: { pct: number | null; rotulo: string; ajuda?: string }) {
  const cor = COR[semaforo(pct)]
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: TXM }}>
        <span>{rotulo}{ajuda ? <> <AjudaCampo chave={ajuda} rota={ROTA} /></> : null}</span><b style={{ color: cor }}>{fmtPct(pct)}</b>
      </div>
      <div role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={rotulo}
        style={{ height: 10, background: '#F1EAE0', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, height: '100%', background: cor }} />
      </div>
    </div>
  )
}

function CartaoVertical({ c, ondas }: { c: Cobertura; ondas: OndaHub[] | null }) {
  const [aberto, setAberto] = useState(false)
  const telas = c.por_tela ?? []
  return (
    <section data-testid={`avanco-${c.vertical}`} style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: ESP }}>{nomeVertical(c.vertical!)}</h3>
        <span style={{ fontSize: 12, color: TXM }}>{c.total_requisitos} mapeados <AjudaCampo chave="dev.codes.avanco.mapeado" rota={ROTA} /></span>
      </header>
      <div style={{ marginTop: 8 }}>
        <Barra pct={c.geral_pct} rotulo="Geral" ajuda="dev.codes.avanco.geral" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ flex: 1 }}><Barra pct={c.essenciais_pct} rotulo="Essenciais" /></div><AjudaCampo chave="dev.codes.avanco.essencial" rota={ROTA} /></div>
      </div>
      <div style={{ fontSize: 12, color: TXM }}>
        Provados por teste de jornada: <b style={{ color: ESP }}>{c.total_provado_por_jornada}</b> de {c.total_requisitos} <AjudaCampo chave="dev.codes.avanco.jornada" rota={ROTA} />
      </div>
      {ondas && ondas.length > 0 && <OndasHub ondas={ondas} />}
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} data-testid={`avanco-telas-${c.vertical}`}
        style={{ marginTop: 10, background: 'none', border: `1px solid ${BD}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: ESP, cursor: 'pointer', minHeight: 40 }}>
        {aberto ? 'Esconder telas' : `Ver as ${telas.length} telas`}
      </button>
      <span style={{ marginLeft: 4 }}><AjudaCampo chave="dev.codes.avanco.telas" rota={ROTA} /></span>
      {aberto && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
          {telas.map((t) => (
            <li key={String(t.tela_num)} style={{ padding: '6px 0', borderTop: `1px solid ${BD}` }}>
              <Barra pct={t.pct} rotulo={`${t.tela_nome} · ${t.requisitos} req. · ${t.provado_por_jornada} provados`} ajuda="dev.codes.avanco.tela" />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OndasHub({ ondas }: { ondas: OndaHub[] }) {
  const r = resumoOndas(ondas)
  return (
    <div data-testid="avanco-ondas-hub" style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${BD}` }}>
      <div style={{ fontSize: 12, color: ESP, fontWeight: 700, marginBottom: 4 }}>
        Ondas 200–211 <AjudaCampo chave="dev.codes.avanco.ondas" rota={ROTA} />
        <span style={{ fontWeight: 400, color: TXM }}> · {r.concluidos} concluídas · {r.em_andamento} em andamento · {r.planejados} planejadas</span>
      </div>
      {ondas.map((o) => {
        const t = totalOnda(o) || 1
        return (
          <div key={o.onda} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: TXM, marginBottom: 3 }}>
            <span style={{ width: 28 }}>{o.onda}</span>
            <div style={{ flex: 1, display: 'flex', height: 8, background: '#F1EAE0', borderRadius: 4, overflow: 'hidden' }} title={`${o.concluidos} concluídas, ${o.em_andamento} em andamento, ${o.planejados} planejadas`}>
              <div style={{ width: `${(100 * o.concluidos) / t}%`, background: ESP }} />
              <div style={{ width: `${(100 * o.em_andamento) / t}%`, background: DOU }} />
            </div>
            <span style={{ width: 54, textAlign: 'right' }}>{o.concluidos}/{o.em_andamento}/{o.planejados}</span>
          </div>
        )
      })}
      <div style={{ fontSize: 10, color: TXM }}>concluídas / em andamento / planejadas <AjudaCampo chave="dev.codes.avanco.ondas_legenda" rota={ROTA} /></div>
    </div>
  )
}

export default function AvancoVertical() {
  const [dados, setDados] = useState<{ cobs: Cobertura[]; ondas: OndaHub[]; hist: PontoHistorico[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_dev_avanco_vertical')
    if (error || !data || (data as { ok?: boolean }).ok === false) { setErro(error?.message ?? 'sem acesso'); return }
    const d = data as { verticais?: Cobertura[]; hub_ondas?: OndaHub[]; historico?: PontoHistorico[] }
    setErro(null)
    setDados({ cobs: ordenar(d.verticais ?? []), ondas: d.hub_ondas ?? [], hist: d.historico ?? [] })
  }, [])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), 300_000)
    return () => clearInterval(t)
  }, [carregar])

  const serie = useMemo(() => (dados ? serieHistorico(dados.hist) : []), [dados])
  if (erro) return <div role="alert" style={{ fontSize: 12, color: TXM, marginBottom: 8 }}>Não consegui ler o avanço por vertical: {erro}</div>
  if (!dados) return <div style={{ fontSize: 13, color: TXM }}>Carregando avanço por vertical…</div>
  return (
    <div data-testid="codes-avanco-vertical" style={{ marginTop: 12 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: ESP, margin: '0 0 8px' }}>Avanço por vertical</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {dados.cobs.map((c) => <CartaoVertical key={c.vertical} c={c} ondas={c.vertical === 'hub_projetos' ? dados.ondas : null} />)}
      </div>
      <section data-testid="avanco-linha-tempo" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginTop: 12 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: ESP }}>Evolução diária do % geral <AjudaCampo chave="dev.codes.avanco.linha_tempo" rota={ROTA} /></h3>
        {serie.length < 2 ? (
          <div style={{ fontSize: 12, color: TXM }}>O retrato é gravado uma vez por dia; a linha aparece a partir do segundo dia.</div>
        ) : (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={serie} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={BD} vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: TXM }} tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: TXM }} />
                <Tooltip />
                {dados.cobs.map((c, i) => <Line key={c.vertical} type="monotone" dataKey={c.vertical!} name={nomeVertical(c.vertical!)} stroke={CORES_LINHA[i % CORES_LINHA.length]} dot={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  )
}
