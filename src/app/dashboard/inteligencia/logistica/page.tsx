'use client'
// Indústria › Inteligência › BI de Logística — rastreamento da frota (SPEC 27/11, PARTE E).
// Lê só a porta fn_frota_rastreio_painel (posição atual + cruzamento com a frota cadastrada pela placa e o custo
// lançado nos últimos 30 dias). A leitura do rastreador é feita pela edge `frota-rastreio-sync` na cadência da
// empresa; "Atualizar agora" pede uma leitura fora da agenda. Rota histórica: SOB DEMANDA e só quando
// frota_rastreio_config.playback_habilitado = true (decisão HISTÓRICO pendente do CEO — desligada por padrão).
// Sem credencial no cofre: estado vazio explicativo com o caminho para Conectores (nunca erro cru). Celular e notebook.
import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3', azul: '#2f6f8f' }
const ROTA = '/dashboard/inteligencia/logistica'

type Situacao = 'em_movimento' | 'ligado_parado' | 'parado' | 'sem_sinal'
type Veiculo = {
  imei: string; rotulo: string; placa: string | null; nome: string | null
  gps_em: string | null; latitude: number | null; longitude: number | null; velocidade_kmh: number | null
  ignicao: boolean | null; km_hoje: number | null; motorista: string | null; situacao: Situacao; km_30d: number | null
  cadastrado: boolean; modelo: string | null; marca: string | null; custo_30d: number | null; custo_km_30d: number | null
  metodo: 'manual' | 'placa' | 'nome' | 'sem_par' | 'fora_da_frota' | null; km_mes_ant: number | null; custo_rateado_mes_ant: number | null
}
type CustoMes = { mes: string; km: number; combustivel: number; manutencao: number; pneus: number; total: number; titulos: number; custo_km: number | null; parcial: boolean }
type Divergencias = {
  casados: number; fora_da_frota: number
  rastreador_sem_par: { imei: string; nome: string | null; placa_rastreador: string | null; sugestao_veiculo_id: string | null; sugestao_placa: string | null }[]
  veiculo_sem_rastreador: { veiculo_id: string; placa: string; tipo: string | null }[]
}
type Alarmes = { ultimas_24h: number; por_tipo: { tipo: string; n: number }[]; recentes: { imei: string; tipo: string; em: string; cerca: string | null; velocidade_kmh: number | null }[] }
type Ontem = { dia: string; km: number; viagens: number; paradas: number; horas_rodando: number; copiados: number; cercas: number }
type Painel = {
  tem_credencial: boolean
  config: { cadencia_min: number; playback_habilitado: boolean; copia_diaria_habilitada?: boolean; ultima_sync_em: string | null; ultima_sync_ok_em: string | null; ultimo_status: string | null; ultimo_erro: string | null }
  frota_cadastrada: number
  kpis: { total: number; em_movimento: number; ligado_parado: number; parado: number; sem_sinal: number; km_hoje: number; km_30d: number; cadastrados: number; custo_30d: number }
  custo_mes?: CustoMes[]
  divergencias?: Divergencias
  alarmes?: Alarmes
  ontem?: Ontem
  veiculos: Veiculo[]
}
type Rota = { pontos: { lat: number; lng: number; em: string; velocidade: number | null }[]; resumo: { pontos: number; distancia_km: number; velocidade_max: number } }

const SIT: Record<Situacao, { rot: string; cor: string }> = {
  em_movimento: { rot: 'Em movimento', cor: C.ok },
  ligado_parado: { rot: 'Ligado parado', cor: C.warn },
  parado: { rot: 'Parado', cor: C.azul },
  sem_sinal: { rot: 'Sem sinal', cor: C.bad },
}

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const brl = (v: number | null | undefined, d = 0) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: d, minimumFractionDigits: d }).format(v)
const dataHora = (s: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? '—' : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` }
function ha(s: string | null): string {
  if (!s) return 'sem posição'
  const min = Math.round((Date.now() - new Date(s).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`
  return `há ${Math.round(min / 1440)} dias`
}
const mesRot = (s: string) => { const [a, m] = s.slice(0, 7).split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m) - 1]}/${a.slice(2)}` }
const dataBR = (s: string) => { const [a, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${a}` }
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16, minWidth: 0, display: 'grid', gap: 10, alignContent: 'start' }
const grade = (min: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: 'start' })
const pill = (on: boolean): CSSProperties => ({ font: 'inherit', fontSize: 13, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? C.esp : C.bd}`, background: on ? C.esp : '#fff', color: on ? '#fff' : C.esp })
const btn = (prim: boolean, off = false): CSSProperties => ({ font: 'inherit', fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 10, cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.6 : 1, border: prim ? 'none' : `1px solid ${C.bd}`, background: prim ? C.gold : '#fff', color: C.esp })
const inp: CSSProperties = { font: 'inherit', fontSize: 14, padding: '9px 12px', borderRadius: 10, border: `1px solid ${C.bd}`, background: '#fff', color: C.esp, minWidth: 0 }

function Titulo({ t, nota, ajuda }: { t: string; nota?: ReactNode; ajuda: string }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>{t}<AjudaCampo chave={ajuda} rota={ROTA} /></div>
      {nota && <div style={{ fontSize: 12, color: C.m }}>{nota}</div>}
    </div>
  )
}
function Kpi({ rot, v, sub, ajuda, cor }: { rot: string; v: string; sub?: string; ajuda: string; cor?: string }) {
  return (
    <div style={{ ...card, gap: 4 }}>
      <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>{rot}<AjudaCampo chave={ajuda} rota={ROTA} /></div>
      <div style={{ fontSize: 26, fontFamily: 'Fraunces, Georgia, serif', color: cor ?? C.esp, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      {sub && <div style={{ fontSize: 12, color: C.m }}>{sub}</div>}
    </div>
  )
}

// Mapa: posição no OpenStreetMap (embed, sem chave) do veículo escolhido, com enquadramento da frota.
function Mapa({ veiculos, sel }: { veiculos: Veiculo[]; sel: Veiculo | null }) {
  const comPos = veiculos.filter((v) => v.latitude != null && v.longitude != null)
  if (!comPos.length) return <div style={{ fontSize: 13, color: C.m }}>Nenhum veículo com posição ainda.</div>
  const alvo = sel && sel.latitude != null ? [sel] : comPos
  const lats = alvo.map((v) => Number(v.latitude)), lngs = alvo.map((v) => Number(v.longitude))
  const pad = alvo.length === 1 ? 0.02 : 0.05
  const bbox = [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad].join(',')
  const m = sel && sel.latitude != null ? `&marker=${sel.latitude},${sel.longitude}` : ''
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <iframe title="Mapa da frota" src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${m}`}
        style={{ width: '100%', height: 320, border: `1px solid ${C.bd}`, borderRadius: 10 }} loading="lazy" />
      <div style={{ fontSize: 12, color: C.m }}>
        {sel ? <>Mostrando <b>{sel.rotulo}</b> · {ha(sel.gps_em)}. </> : <>Enquadra os {comPos.length} veículos com posição. Toque em um veículo da lista para marcar no mapa. </>}
        {sel && sel.latitude != null && <a href={`https://www.openstreetmap.org/?mlat=${sel.latitude}&mlon=${sel.longitude}#map=15/${sel.latitude}/${sel.longitude}`} target="_blank" rel="noreferrer" style={{ color: C.azul }}>Abrir mapa grande</a>}
      </div>
    </div>
  )
}

// Rota histórica desenhada em SVG (projeção simples, suficiente para a escala de um dia de viagem).
function RotaSvg({ pontos }: { pontos: Rota['pontos'] }) {
  if (pontos.length < 2) return <div style={{ fontSize: 13, color: C.m }}>Poucos pontos no período para desenhar a rota.</div>
  const W = 640, H = 300, P = 14
  const lats = pontos.map((p) => p.lat), lngs = pontos.map((p) => p.lng)
  const [la0, la1, ln0, ln1] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const k = Math.cos(((la0 + la1) / 2) * Math.PI / 180)
  const sx = (ln1 - ln0) * k || 1e-6, sy = (la1 - la0) || 1e-6
  const esc = Math.min((W - 2 * P) / sx, (H - 2 * P) / sy)
  const xy = (p: { lat: number; lng: number }) => [P + (p.lng - ln0) * k * esc, H - P - (p.lat - la0) * esc]
  const d = pontos.map((p, i) => `${i ? 'L' : 'M'}${xy(p).map((n) => n.toFixed(1)).join(',')}`).join(' ')
  const [x0, y0] = xy(pontos[0]), [x1, y1] = xy(pontos[pontos.length - 1])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: C.off, borderRadius: 10, border: `1px solid ${C.bd}` }} role="img" aria-label="Rota percorrida no período">
      <path d={d} fill="none" stroke={C.azul} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x0} cy={y0} r={6} fill={C.ok}><title>Início {dataHora(pontos[0].em)}</title></circle>
      <circle cx={x1} cy={y1} r={6} fill={C.bad}><title>Fim {dataHora(pontos[pontos.length - 1].em)}</title></circle>
    </svg>
  )
}

export default function BiLogisticaPage() {
  return (
    <Suspense fallback={<div style={{ background: C.off, minHeight: '100vh', padding: 40, textAlign: 'center', color: C.m, fontSize: 13 }}>Carregando…</div>}>
      <BiLogistica />
    </Suspense>
  )
}

function BiLogistica() {
  const router = useRouter()
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [painel, setPainel] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Situacao | 'todos'>('todos')
  const [selImei, setSelImei] = useState<string | null>(null)

  const agora = new Date()
  const [rotaImei, setRotaImei] = useState('')
  const [rotaIni, setRotaIni] = useState(localInput(new Date(agora.getTime() - 12 * 3600 * 1000)))
  const [rotaFim, setRotaFim] = useState(localInput(agora))
  const [rota, setRota] = useState<Rota | null>(null)
  const [rotaErro, setRotaErro] = useState<string | null>(null)
  const [rotaCarregando, setRotaCarregando] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_frota_rastreio_painel', { p_company_id: companyId })
    if (error) setErro(erroAmigavel(error, 'Não foi possível carregar a logística. Tente de novo.'))
    setPainel((data ?? null) as Painel | null)
    setLoading(false)
  }, [companyId])

  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { void carregar() }, [carregar])

  async function atualizarAgora() {
    if (!companyId) return
    setSincronizando(true); setAviso(null)
    const { data, error } = await supabase.functions.invoke('frota-rastreio-sync', { body: { modo: 'sync', company_id: companyId } })
    const j = (data ?? {}) as { ok?: boolean; pulado?: boolean; erro?: string; veiculos?: number }
    if (error) setAviso('Não foi possível pedir a leitura agora. Tente de novo em instantes.')
    else if (j.pulado) setAviso('A última leitura foi há menos de 1 minuto: mostrando o que já foi lido.')
    else if (!j.ok) setAviso(j.erro ?? 'O rastreador não respondeu como esperado. A próxima leitura tenta de novo.')
    else setAviso(`Leitura concluída: ${int(j.veiculos ?? 0)} veículo(s).`)
    setSincronizando(false)
    await carregar()
  }

  async function verRota() {
    if (!companyId || !rotaImei) { setRotaErro('Escolha o veículo.'); return }
    setRotaCarregando(true); setRotaErro(null); setRota(null)
    const { data, error } = await supabase.functions.invoke('frota-rastreio-sync', {
      body: { modo: 'playback', company_id: companyId, imei: rotaImei, inicio: new Date(rotaIni).toISOString(), fim: new Date(rotaFim).toISOString() },
    })
    const j = (data ?? {}) as { ok?: boolean; erro?: string } & Partial<Rota>
    if (error) setRotaErro('Não foi possível consultar a rota agora. Confira o período (até 3 dias) e tente de novo.')
    else if (!j.ok) setRotaErro(j.erro ?? 'O rastreador não devolveu a rota.')
    else setRota({ pontos: j.pontos ?? [], resumo: j.resumo ?? { pontos: 0, distancia_km: 0, velocidade_max: 0 } })
    setRotaCarregando(false)
  }

  const [vinculando, setVinculando] = useState<string | null>(null)
  async function vincular(imei: string, veiculoId: string | null, foraDaFrota = false) {
    if (!companyId) return
    setVinculando(imei); setAviso(null)
    const { error } = await supabase.rpc('fn_frota_rastreio_vincular', { p_company_id: companyId, p_imei: imei, p_veiculo_id: veiculoId, p_fora_da_frota: foraDaFrota })
    if (error) setAviso(erroAmigavel(error, 'Não foi possível salvar o vínculo. Tente de novo.'))
    setVinculando(null)
    await carregar()
  }

  const veiculos = useMemo(() => painel?.veiculos ?? [], [painel])
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return veiculos.filter((v) => (filtro === 'todos' || v.situacao === filtro) &&
      (!q || [v.placa, v.nome, v.motorista, v.rotulo].some((s) => (s ?? '').toLowerCase().includes(q))))
  }, [veiculos, busca, filtro])
  const selecionado = veiculos.find((v) => v.imei === selImei) ?? null

  const cfg = painel?.config
  const k = painel?.kpis

  return (
    <div style={{ background: C.off, minHeight: '100vh', padding: '24px 16px', color: C.esp }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 16 }}>
        <button onClick={() => router.push('/dashboard/inteligencia?area=industrial')} style={{ background: 'transparent', border: 'none', color: C.m, fontSize: 12, cursor: 'pointer', padding: 0, justifySelf: 'start' }}>
          ← Análise de dados
        </button>
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: C.gold, fontWeight: 600, letterSpacing: 0.4 }}>🚛 Inteligência (BI) · industrial · saída</div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, fontSize: 28, margin: '4px 0 0' }}>Logística · frota rastreada</h1>
          </div>
          {painel?.tem_credencial && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => void atualizarAgora()} disabled={sincronizando} style={btn(true, sincronizando)}>{sincronizando ? 'Lendo o rastreador…' : 'Atualizar agora'}</button>
              <AjudaCampo chave="log.bi.atualizar" rota={ROTA} />
            </div>
          )}
        </header>

        {!companyId && <div style={card}>Escolha uma empresa no seletor do topo para ver a frota.</div>}
        {companyId && loading && <div style={{ ...card, color: C.m }}>Carregando a frota…</div>}
        {companyId && !loading && erro && (
          <div style={{ ...card, borderColor: C.bad }}>
            <div>{erro}</div>
            <button onClick={() => void carregar()} style={{ ...btn(false), justifySelf: 'start' }}>Tentar de novo</button>
          </div>
        )}

        {/* Estado vazio: sem credencial no cofre → explica e leva ao cadastro (nunca erro cru) */}
        {companyId && !loading && !erro && painel && !painel.tem_credencial && (
          <div style={{ ...card, padding: 28, textAlign: 'center', justifyItems: 'center' }}>
            <div style={{ fontSize: 36 }}>📡</div>
            <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, display: 'flex', alignItems: 'center', gap: 4 }}>Conecte o rastreador da frota<AjudaCampo chave="log.bi.conexao" rota={ROTA} /></div>
            <p style={{ fontSize: 14, color: C.m, maxWidth: 520, margin: 0, lineHeight: 1.5 }}>
              Para ver a posição dos veículos aqui, cadastre uma vez a <b>conta</b> e a <b>senha</b> do rastreador em Conectores › Logística.
              A senha fica guardada no cofre da empresa e a leitura passa a acontecer sozinha a cada {int(cfg?.cadencia_min ?? 10)} minutos.
            </p>
            <div style={{ fontSize: 13, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Dica: peça ao fornecedor uma conta só para a integração.<AjudaCampo chave="log.bi.subconta" rota={ROTA} /></div>
            <button onClick={() => router.push('/dashboard/conectores')} style={btn(true)}>Ir para Conectores</button>
            {painel.frota_cadastrada > 0 && <div style={{ fontSize: 12, color: C.m }}>{int(painel.frota_cadastrada)} veículo(s) já cadastrados na frota serão cruzados pela placa.</div>}
          </div>
        )}

        {companyId && !loading && !erro && painel?.tem_credencial && cfg && k && (
          <>
            <div style={{ ...card, gridTemplateColumns: '1fr', gap: 4 }}>
              <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: cfg.ultimo_status === 'ok' ? C.ok : cfg.ultimo_status ? C.bad : C.warn }} />
                <b>{cfg.ultimo_status === 'ok' ? 'Rastreador conectado' : cfg.ultimo_status ? 'A última leitura não deu certo' : 'Aguardando a primeira leitura'}</b>
                <span style={{ color: C.m }}>· última leitura {dataHora(cfg.ultima_sync_em)} · a cada {int(cfg.cadencia_min)} min</span>
                <AjudaCampo chave="log.bi.conexao" rota={ROTA} />
              </div>
              {cfg.ultimo_status && cfg.ultimo_status !== 'ok' && cfg.ultimo_erro && <div style={{ fontSize: 13, color: C.bad }}>{cfg.ultimo_erro}</div>}
              {!cfg.ultimo_status && <div style={{ fontSize: 13, color: C.m }}>A credencial está salva. Toque em “Atualizar agora” para ler a frota sem esperar a próxima leitura.</div>}
              {aviso && <div style={{ fontSize: 13, color: C.m }}>{aviso}</div>}
              <div style={{ fontSize: 12, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>
                Use uma conta do rastreador só para a integração: cada entrada nova derruba a sessão anterior.<AjudaCampo chave="log.bi.subconta" rota={ROTA} />
              </div>
            </div>

            <div style={grade(160)}>
              <Kpi rot="Veículos rastreados" v={int(k.total)} sub={`${int(k.cadastrados)} cruzados com a frota cadastrada`} ajuda="log.bi.total" />
              <Kpi rot="Em movimento" v={int(k.em_movimento)} ajuda="log.bi.movimento" cor={C.ok} />
              <Kpi rot="Parados" v={int(k.parado + k.ligado_parado)} sub={`${int(k.ligado_parado)} com motor ligado`} ajuda="log.bi.parado" cor={C.azul} />
              <Kpi rot="Sem sinal" v={int(k.sem_sinal)} sub="última posição há mais de 1 h" ajuda="log.bi.sem_sinal" cor={k.sem_sinal ? C.bad : C.esp} />
              <Kpi rot="Km rodados" v={`${int(k.km_hoje)} km`} sub={`hoje · ${int(k.km_30d)} km em 30 dias`} ajuda="log.bi.km" />
              {(() => {
                const fechado = (painel.custo_mes ?? []).find((m) => !m.parcial)
                return <Kpi rot="Custo × km" v={fechado?.custo_km != null ? `${brl(fechado.custo_km, 2)}/km` : '—'}
                  sub={fechado ? (fechado.km > 0 ? `${mesRot(fechado.mes)} · ${brl(fechado.total)} ÷ ${int(fechado.km)} km` : `${mesRot(fechado.mes)} · ${brl(fechado.total)} · sem km oficial ainda`) : 'sem títulos de frota'}
                  ajuda="log.bi.custo_mes" />
              })()}
            </div>

            <div style={grade(300)}>
              {painel.ontem && (
                <div style={card}>
                  <Titulo t={`Ontem · ${dataBR(painel.ontem.dia)}`} ajuda="log.bi.ontem" nota={cfg.copia_diaria_habilitada ? 'Copiado do rastreador na madrugada.' : 'Cópia diária desligada para esta empresa.'} />
                  {painel.ontem.copiados === 0
                    ? <div style={{ fontSize: 13, color: C.m }}>A cópia do dia anterior ainda não rodou. Ela acontece toda madrugada.</div>
                    : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13 }}>
                        <div><b style={{ fontSize: 20 }}>{int(painel.ontem.km)}</b> km</div>
                        <div><b style={{ fontSize: 20 }}>{int(painel.ontem.viagens)}</b> viagens</div>
                        <div><b style={{ fontSize: 20 }}>{int(painel.ontem.paradas)}</b> paradas</div>
                        <div><b style={{ fontSize: 20 }}>{nf({ maximumFractionDigits: 1 }).format(painel.ontem.horas_rodando)}</b> h rodando</div>
                      </div>}
                </div>
              )}
              {(painel.custo_mes ?? []).length > 0 && (
                <div style={card}>
                  <Titulo t="Custo da frota por km" ajuda="log.bi.custo_mes" nota="Títulos a pagar do ERP (postos, oficinas, pneus) ÷ km oficial do mês." />
                  {(painel.custo_mes ?? []).map((m) => (
                    <div key={m.mes} style={{ display: 'grid', gap: 2, fontSize: 13, borderTop: `1px solid ${C.bg2}`, paddingTop: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <b>{mesRot(m.mes)}{m.parcial ? ' (em andamento)' : ''}</b>
                        <b>{m.custo_km != null ? `${brl(m.custo_km, 2)}/km` : '—'}</b>
                      </div>
                      <div style={{ color: C.m, fontSize: 12 }}>
                        Combustível {brl(m.combustivel)} · manutenção {brl(m.manutencao)} · pneus {brl(m.pneus)} · {int(m.km)} km
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {painel.alarmes && (
                <div style={card}>
                  <Titulo t="Alarmes" ajuda="log.bi.alarmes" nota={`${int(painel.alarmes.ultimas_24h)} nas últimas 24 h`} />
                  {painel.alarmes.recentes.length === 0
                    ? <div style={{ fontSize: 13, color: C.m }}>Nenhum alarme recebido. Os alarmes são ligados na plataforma do rastreador.</div>
                    : <div style={{ display: 'grid', gap: 4, fontSize: 12, maxHeight: 180, overflow: 'auto' }}>
                        {painel.alarmes.recentes.map((a, i) => (
                          <div key={a.imei + a.em + i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span><b>{veiculos.find((v) => v.imei === a.imei)?.rotulo ?? a.imei}</b> · {a.tipo}{a.cerca ? ` · ${a.cerca}` : ''}</span>
                            <span style={{ color: C.m, whiteSpace: 'nowrap' }}>{ha(a.em)}</span>
                          </div>
                        ))}
                      </div>}
                </div>
              )}
            </div>

            {painel.divergencias && (painel.divergencias.rastreador_sem_par.length > 0 || painel.divergencias.veiculo_sem_rastreador.length > 0) && (
              <div style={card}>
                <Titulo t="Divergências: rastreador × frota cadastrada" ajuda="log.bi.casamento"
                  nota={`${int(painel.divergencias.casados)} de ${int(veiculos.length)} rastreadores ligados a um veículo cadastrado.`} />
                {painel.divergencias.rastreador_sem_par.map((d) => (
                  <div key={d.imei} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', fontSize: 13, borderTop: `1px solid ${C.bg2}`, paddingTop: 6 }}>
                    <span>
                      <b>{d.nome ?? d.imei}</b>{' '}
                      {d.sugestao_placa ? <span style={{ color: C.warn }}>parece {d.sugestao_placa} (1 caractere diferente)</span> : <span style={{ color: C.m }}>sem placa conhecida no nome</span>}
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {d.sugestao_veiculo_id && (
                        <button disabled={vinculando === d.imei} onClick={() => void vincular(d.imei, d.sugestao_veiculo_id)} style={btn(true, vinculando === d.imei)}>Confirmar {d.sugestao_placa}</button>
                      )}
                      <button disabled={vinculando === d.imei} onClick={() => void vincular(d.imei, null, true)} style={btn(false, vinculando === d.imei)}>Não é da frota</button>
                    </span>
                  </div>
                ))}
                {painel.divergencias.veiculo_sem_rastreador.length > 0 && (
                  <div style={{ fontSize: 13, color: C.m, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', borderTop: `1px solid ${C.bg2}`, paddingTop: 6 }}>
                    Sem rastreador: {painel.divergencias.veiculo_sem_rastreador.map((v) => v.placa).join(', ')}<AjudaCampo chave="log.bi.sem_rastreador" rota={ROTA} />
                  </div>
                )}
              </div>
            )}

            {veiculos.length === 0 ? (
              <div style={{ ...card, color: C.m }}>O rastreador ainda não devolveu veículos para esta conta. Depois da primeira leitura, a frota aparece aqui.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16, alignItems: 'start' }}>
                <div style={card}>
                  <Titulo t="Veículos e posição atual" ajuda="log.bi.lista" nota="Toque em um veículo para marcar no mapa." />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar placa, nome ou motorista" style={{ ...inp, flex: 1 }} aria-label="Buscar veículo" />
                    <AjudaCampo chave="log.bi.busca" rota={ROTA} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={() => setFiltro('todos')} style={pill(filtro === 'todos')}>Todos · {veiculos.length}</button>
                    {(Object.keys(SIT) as Situacao[]).map((s) => (
                      <button key={s} onClick={() => setFiltro(s)} style={pill(filtro === s)}>{SIT[s].rot} · {veiculos.filter((v) => v.situacao === s).length}</button>
                    ))}
                    <AjudaCampo chave="log.bi.situacao" rota={ROTA} />
                  </div>
                  <div style={{ display: 'grid', gap: 6, maxHeight: 560, overflow: 'auto' }}>
                    {lista.length === 0 && <div style={{ fontSize: 13, color: C.m }}>Nenhum veículo com esse filtro.</div>}
                    {lista.map((v) => (
                      <button key={v.imei} onClick={() => setSelImei(v.imei === selImei ? null : v.imei)}
                        style={{ font: 'inherit', textAlign: 'left', cursor: 'pointer', border: `1px solid ${v.imei === selImei ? C.gold : C.bg2}`, background: v.imei === selImei ? 'rgba(200,148,26,0.08)' : '#fff', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 3, color: C.esp }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <b style={{ fontSize: 14 }}>{v.rotulo}</b>
                          <span style={{ fontSize: 12, fontWeight: 600, color: SIT[v.situacao].cor }}>● {SIT[v.situacao].rot}</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.m, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span>{ha(v.gps_em)}</span>
                          {v.velocidade_kmh != null && <span>{int(v.velocidade_kmh)} km/h</span>}
                          {v.km_hoje != null && <span>{int(v.km_hoje)} km hoje</span>}
                          {v.motorista && <span>{v.motorista}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: C.m }}>
                          {v.cadastrado
                            ? <>{[v.marca, v.modelo].filter(Boolean).join(' ') || 'Na frota'}{v.metodo === 'manual' ? ' · vínculo confirmado' : ''}{v.custo_rateado_mes_ant != null && <> · mês anterior {brl(v.custo_rateado_mes_ant)} em {int(v.km_mes_ant)} km</>}</>
                            : v.metodo === 'fora_da_frota' ? <>Marcado como fora da frota</> : <>Sem par na frota cadastrada (veja Divergências)</>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 16 }}>
                  <div style={card}>
                    <Titulo t="Mapa" ajuda="log.bi.lista" nota="Posição da última leitura, não ao vivo." />
                    <Mapa veiculos={veiculos} sel={selecionado} />
                  </div>

                  {/* Rota histórica: SOB DEMANDA e atrás da flag playback_habilitado (decisão HISTÓRICO pendente) */}
                  {cfg.playback_habilitado && (
                    <div style={card}>
                      <Titulo t="Rota histórica" ajuda="log.bi.rota" nota="Consulta direta no rastreador, até 3 dias por vez." />
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select value={rotaImei} onChange={(e) => setRotaImei(e.target.value)} style={{ ...inp, flex: 1 }} aria-label="Veículo da rota">
                          <option value="">Escolha o veículo</option>
                          {veiculos.map((v) => <option key={v.imei} value={v.imei}>{v.rotulo}</option>)}
                        </select>
                        <AjudaCampo chave="log.bi.rota" rota={ROTA} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input type="datetime-local" value={rotaIni} onChange={(e) => setRotaIni(e.target.value)} style={inp} aria-label="Início da rota" />
                        <span style={{ color: C.m, fontSize: 13 }}>até</span>
                        <input type="datetime-local" value={rotaFim} onChange={(e) => setRotaFim(e.target.value)} style={inp} aria-label="Fim da rota" />
                        <AjudaCampo chave="log.bi.rota_periodo" rota={ROTA} />
                      </div>
                      <button onClick={() => void verRota()} disabled={rotaCarregando} style={{ ...btn(true, rotaCarregando), justifySelf: 'start' }}>{rotaCarregando ? 'Buscando a rota…' : 'Ver rota'}</button>
                      {rotaErro && <div style={{ fontSize: 13, color: C.bad }}>{rotaErro}</div>}
                      {rota && (
                        <>
                          <div style={{ fontSize: 13, color: C.m }}>{int(rota.resumo.distancia_km)} km aproximados · máx. {int(rota.resumo.velocidade_max)} km/h · {int(rota.resumo.pontos)} pontos</div>
                          <RotaSvg pontos={rota.pontos} />
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
