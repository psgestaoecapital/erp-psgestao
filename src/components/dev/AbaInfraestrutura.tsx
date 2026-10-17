'use client'
// Central de Desenvolvimento · aba "Infraestrutura" (CEO 16/10 19:15). Três blocos, cada um sob BlocoSeguro (um bloco com
// erro não derruba a aba): (1) fluxograma do pedido à publicação e de volta, com semáforo e número principal por etapa;
// (2) função de cada agente e as leis; (3) desempenho por etapa (hoje / 7 dias). Dados: fn_dev_infra_desempenho e
// fn_dev_infra_agentes (só equipe PS). Regras puras em src/lib/dev/infraestrutura.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { BlocoSeguro } from '@/components/dev/BlocoSeguro'
import { supabase } from '@/lib/supabase'
import {
  AGENTES_INFRA, ETAPAS, LEIS, LIMITES, NOME_AGENTE, estadoAgente, legivelCron, lerAgentes, lerDesempenho, resumirEtapas,
  type AgenteInfra, type Desempenho, type Etapa, type Janela, type Metrica, type ResumoEtapa, type Semaforo,
} from '@/lib/dev/infraestrutura'

const ESP = '#3D2314', OFF = '#FAF7F2', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
// Verde/amarelo/vermelho SÓ como semáforo dos números.
const COR: Record<Semaforo, { fg: string; bg: string; rotulo: string }> = {
  verde: { fg: '#166534', bg: '#DCFCE7', rotulo: 'dentro do limite' },
  amarelo: { fg: '#854D0E', bg: '#FEF3C7', rotulo: 'atenção' },
  vermelho: { fg: '#B91C1C', bg: '#FEE2E2', rotulo: 'fora do limite' },
  sem_dado: { fg: TXM, bg: OFF, rotulo: 'sem limite' },
}
const ROTA = '/dashboard/dev/codes'
const card: React.CSSProperties = { background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 16, marginBottom: 12 }

function useLargura(limite: number) {
  const [estreito, setEstreito] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(max-width: ${limite}px)`)
    const f = () => setEstreito(mq.matches)
    f(); mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [limite])
  return estreito
}

export default function AbaInfraestrutura() {
  const [desemp, setDesemp] = useState<Desempenho | null>(null)
  const [agentes, setAgentes] = useState<AgenteInfra[] | null>(null)
  const [erro, setErro] = useState<{ desemp: boolean; agentes: boolean }>({ desemp: false, agentes: false })
  const [carregando, setCarregando] = useState(true)
  const [janela, setJanela] = useState<Janela>('hoje')
  const [agora, setAgora] = useState(() => new Date())

  const carregar = useCallback(async () => {
    const [d, a] = await Promise.allSettled([supabase.rpc('fn_dev_infra_desempenho'), supabase.rpc('fn_dev_infra_agentes')])
    const dd = d.status === 'fulfilled' && !d.value.error ? lerDesempenho(d.value.data) : null
    const aa = a.status === 'fulfilled' && !a.value.error ? lerAgentes(a.value.data) : null
    setDesemp(dd); setAgentes(aa); setErro({ desemp: !dd, agentes: !aa }); setAgora(new Date()); setCarregando(false)
  }, [])
  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(t)
  }, [carregar])

  const etapas = useMemo(() => (desemp ? resumirEtapas(desemp, janela) : null), [desemp, janela])

  return (
    <div data-testid="aba-infraestrutura">
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: ESP, fontSize: 16 }}>Infraestrutura</span>
        <AjudaCampo chave="dev.infra.aba" rota={ROTA} />
        <span style={{ color: TXM, fontSize: 13, flex: 1, minWidth: 200 }}>Do pedido do cliente à publicação, e de volta: quem faz o quê e como cada etapa está andando.</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span role="group" aria-label="Período" style={{ display: 'inline-flex', border: `1px solid ${BD}`, borderRadius: 8, overflow: 'hidden' }}>
            {(['hoje', 'd7'] as Janela[]).map(j => (
              <button key={j} data-testid={`infra-janela-${j}`} onClick={() => setJanela(j)} aria-pressed={janela === j}
                style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: 'none', background: janela === j ? DOU : BRANCO, color: ESP }}>
                {j === 'hoje' ? 'Hoje' : '7 dias'}
              </button>
            ))}
          </span>
          <AjudaCampo chave="dev.infra.janela" rota={ROTA} />
        </span>
      </div>

      <BlocoSeguro nome="Fluxograma">
        <BlocoFluxograma etapas={etapas} carregando={carregando} falhou={erro.desemp} />
      </BlocoSeguro>
      <BlocoSeguro nome="Funções de cada agente">
        <BlocoAgentes agentes={agentes} falhou={erro.agentes} agora={agora} carregando={carregando} />
      </BlocoSeguro>
      <BlocoSeguro nome="Desempenho por etapa">
        <BlocoDesempenho etapas={etapas} falhou={erro.desemp} carregando={carregando} />
      </BlocoSeguro>
    </div>
  )
}

function Semaforo({ s }: { s: Semaforo }) {
  const c = COR[s]
  return <span title={c.rotulo} aria-label={c.rotulo} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: s === 'sem_dado' ? BD : c.fg, flex: 'none' }} />
}

// ---------- Bloco 1: fluxograma ----------
function BlocoFluxograma({ etapas, carregando, falhou }: { etapas: ResumoEtapa[] | null; carregando: boolean; falhou: boolean }) {
  const estreito = useLargura(720)
  const [sel, setSel] = useState<Etapa | null>(null)
  const W = 150, H = 92, GAP = 34
  const n = ETAPAS.length
  const horiz = !estreito
  const vw = horiz ? n * W + (n - 1) * GAP : 330
  const vh = horiz ? H + 56 : n * H + (n - 1) * GAP + 8
  const pos = (i: number) => (horiz ? { x: i * (W + GAP), y: 0, w: W } : { x: 0, y: i * (H + GAP), w: 300 })
  const escolhida = etapas?.find(e => e.id === sel) ?? null

  return (
    <section style={card} aria-label="Fluxograma">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: ESP }}>Fluxograma</span><AjudaCampo chave="dev.infra.fluxograma" rota={ROTA} />
      </div>
      {falhou && !carregando && <p role="status" style={{ color: TXM, fontSize: 13 }}>Os números das etapas não carregaram; o desenho segue sem semáforo.</p>}
      <svg viewBox={`0 0 ${vw} ${vh}`} role="img" aria-label="Pedido, Code constrói, Esteira, Publicação, Code-Auditor e Volta" style={{ width: '100%', height: 'auto', maxWidth: horiz ? 1100 : 360, display: 'block', margin: '0 auto' }}>
        <defs>
          <marker id="seta-infra" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={ESP} /></marker>
        </defs>
        {ETAPAS.slice(0, -1).map((_, i) => {
          const a = pos(i), b = pos(i + 1)
          return horiz
            ? <line key={i} x1={a.x + a.w} y1={H / 2} x2={b.x - 2} y2={H / 2} stroke={ESP} strokeWidth="1.5" markerEnd="url(#seta-infra)" />
            : <line key={i} x1={a.x + a.w / 2} y1={a.y + H} x2={a.x + a.w / 2} y2={b.y - 2} stroke={ESP} strokeWidth="1.5" markerEnd="url(#seta-infra)" />
        })}
        {/* Volta: da última caixa de volta ao Pedido */}
        {horiz
          ? <path d={`M${pos(n - 1).x + W / 2} ${H} V${H + 36} H${W / 2} V${H + 2}`} fill="none" stroke={DOU} strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#seta-infra)" />
          : <path d={`M300 ${pos(n - 1).y + H / 2} H322 V${H / 2} H302`} fill="none" stroke={DOU} strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#seta-infra)" />}
        {horiz && <text x={(pos(n - 1).x + W / 2 + W / 2) / 2} y={H + 52} textAnchor="middle" fontSize="12" fill={TXM}>o achado volta como chamado interno</text>}
        {ETAPAS.map((e, i) => {
          const p = pos(i)
          const r = etapas?.find(x => x.id === e.id)
          const s = r?.semaforo ?? 'sem_dado'
          const ativo = sel === e.id
          return (
            <g key={e.id} data-testid={`infra-etapa-${e.id}`} role="button" tabIndex={0} aria-pressed={ativo} aria-label={`${e.nome}: ${r ? r.principal.rotulo + ' ' + r.principal.valor : 'sem dado'}`}
              onClick={() => setSel(ativo ? null : e.id)} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSel(ativo ? null : e.id) } }} style={{ cursor: 'pointer' }}>
              <rect x={p.x} y={p.y} width={p.w} height={H} rx="12" fill={COR[s].bg} stroke={ativo ? DOU : ESP} strokeWidth={ativo ? 3 : 1.5} />
              <circle cx={p.x + 16} cy={p.y + 18} r="5" fill={s === 'sem_dado' ? BD : COR[s].fg} />
              <text x={p.x + 28} y={p.y + 23} fontSize="14" fontWeight="700" fill={ESP}>{e.nome}</text>
              <text x={p.x + 12} y={p.y + 50} fontSize="12" fill={TXM}>{r ? recortar(r.principal.rotulo, horiz ? 22 : 40) : '—'}</text>
              <text x={p.x + 12} y={p.y + 74} fontSize="18" fontWeight="700" fill={ESP}>{r ? recortar(r.principal.valor, 14) : '—'}</text>
            </g>
          )
        })}
      </svg>
      <p style={{ color: TXM, fontSize: 12, margin: '10px 0 0', textAlign: 'center' }}>Toque numa caixa para ver o detalhe da etapa. A linha pontilhada é a volta.</p>
      {escolhida && (
        <div data-testid="infra-detalhe-etapa" style={{ marginTop: 12, border: `1px solid ${BD}`, borderRadius: 10, padding: 12, background: OFF }}>
          <div style={{ fontWeight: 700, color: ESP }}>{escolhida.nome}</div>
          <div style={{ color: TXM, fontSize: 13, margin: '2px 0 10px' }}>{escolhida.descricao}</div>
          <ListaMetricas etapa={escolhida} />
        </div>
      )}
    </section>
  )
}
const recortar = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1) + '…' : t)

function ListaMetricas({ etapa }: { etapa: ResumoEtapa }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gap: 8 }}>
      {etapa.metricas.map(m => <LinhaMetrica key={m.chave} etapa={etapa.id} m={m} />)}
    </dl>
  )
}
function LinhaMetrica({ etapa, m }: { etapa: Etapa; m: Metrica }) {
  const c = COR[m.semaforo]
  return (
    <div data-testid={`infra-metrica-${etapa}-${m.chave}`} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <dt style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: ESP, fontSize: 14 }}>
        <Semaforo s={m.semaforo} />{m.rotulo}<AjudaCampo chave={`dev.infra.${etapa}.${m.chave}`} rota={ROTA} />
      </dt>
      <dd style={{ margin: 0, fontWeight: 700, color: c.fg, background: c.bg, borderRadius: 8, padding: '4px 10px', fontSize: 14 }}>{m.valor}</dd>
    </div>
  )
}

// ---------- Bloco 2: agentes e leis ----------
function BlocoAgentes({ agentes, falhou, agora, carregando }: { agentes: AgenteInfra[] | null; falhou: boolean; agora: Date; carregando: boolean }) {
  const ordenados = useMemo(() => {
    const por = new Map((agentes ?? []).map(a => [a.agente, a]))
    return AGENTES_INFRA.map(id => por.get(id)).filter((a): a is AgenteInfra => !!a)
  }, [agentes])
  return (
    <section style={card} aria-label="Funções de cada agente">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: ESP }}>Funções de cada agente</span><AjudaCampo chave="dev.infra.agentes" rota={ROTA} />
      </div>
      {falhou && !carregando && <p role="status" style={{ color: TXM, fontSize: 13 }}>Não foi possível carregar os agentes agora.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {ordenados.map(a => {
          const est = estadoAgente(a, agora)
          const cor = est === 'trabalhando' ? COR.verde : est === 'esperando' ? COR.amarelo : COR.sem_dado
          return (
            <article key={a.agente} data-testid={`infra-agente-${a.agente}`} style={{ border: `1px solid ${BD}`, borderRadius: 10, padding: 12, background: OFF }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, color: ESP }}>{NOME_AGENTE(a.agente)}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: cor.fg, background: cor.bg, borderRadius: 8, padding: '2px 8px' }}>{est}</span>
              </div>
              <p style={{ color: ESP, fontSize: 13, margin: '8px 0' }}>{a.observacao || 'Sem descrição de papel cadastrada.'}</p>
              <div style={{ color: TXM, fontSize: 12 }}>
                Acordado: {a.cron_job ? `${legivelCron(a.cron_agenda)}${a.cron_ativo === false ? ' (desligado)' : ''}` : a.aciona ? 'por evento' : 'desligado'}
              </div>
              <div style={{ color: TXM, fontSize: 12 }}>Última sessão: {a.renovada_em ? ultimaSessao(a, agora) : 'nenhuma registrada'}</div>
            </article>
          )
        })}
      </div>
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, color: ESP }}>Leis</span><AjudaCampo chave="dev.infra.leis" rota={ROTA} />
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
        {LEIS.map(l => (
          <li key={l.id} data-testid={`infra-lei-${l.id}`} style={{ borderLeft: `4px solid ${DOU}`, background: OFF, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontWeight: 700, color: ESP }}>{l.titulo}</div>
            <div style={{ color: ESP, fontSize: 13 }}>{l.texto}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}
function ultimaSessao(a: AgenteInfra, agora: Date): string {
  const t = new Date(a.renovada_em as string).getTime()
  const ini = a.iniciada_em ? new Date(a.iniciada_em).getTime() : t
  const fim = t < ini ? t + 24 * 3600_000 : t // sessão encerrada grava renovada_em = fim − 1 dia
  const min = Math.max(0, Math.round((agora.getTime() - fim) / 60_000))
  return min < 60 ? `há ${min} min` : min < 2880 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dias`
}

// ---------- Bloco 3: desempenho ----------
function BlocoDesempenho({ etapas, falhou, carregando }: { etapas: ResumoEtapa[] | null; falhou: boolean; carregando: boolean }) {
  return (
    <section style={card} aria-label="Desempenho por etapa">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: ESP }}>Desempenho por etapa</span><AjudaCampo chave="dev.infra.desempenho" rota={ROTA} />
      </div>
      {carregando && <p style={{ color: TXM, fontSize: 13 }}>Carregando…</p>}
      {falhou && !carregando && <p role="status" style={{ color: TXM, fontSize: 13 }}>Não foi possível carregar o desempenho agora. Tente atualizar a página.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {(etapas ?? []).map(e => (
          <article key={e.id} data-testid={`infra-desempenho-${e.id}`} style={{ border: `1px solid ${BD}`, borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Semaforo s={e.semaforo} /><span style={{ fontWeight: 700, color: ESP }}>{e.nome}</span>
            </div>
            <ListaMetricas etapa={e} />
          </article>
        ))}
      </div>
      <p style={{ color: TXM, fontSize: 12, marginTop: 12 }}>
        Limites do semáforo: {Object.entries(LIMITES).map(([k, l]) => `${k.replace(/_/g, ' ')} verde ${l.menor ? '≤' : '≥'} ${l.bom}${l.unidade ? ' ' + l.unidade : ''}, amarelo até ${l.medio}`).join(' · ')}.
      </p>
    </section>
  )
}
