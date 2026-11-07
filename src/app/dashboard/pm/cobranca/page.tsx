'use client'
// COBRANÇA / FEE (P&M · Financeiro). Mensalidades recorrentes (agency_contratos ativos) a cobrar no mês.
// A tela LANÇA / AVANÇA (enviada→paga) / ESTORNA a cobrança por contrato e mostra o HISTÓRICO
// (agency_cobranca_lancamento, RD-98 p2). Estorno é soft e rastreável. O disparo real da cobrança na
// GE (erp_receber/Asaas) fica wired — post só após régua RD-53. Escopo por company_id (RD-45). Tema Espresso.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/cobranca'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const AZUL = '#1A4E8A'; const VERMELHO = '#B3261E'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
// Tinta suave da cor de status (fundo/borda do selo) — leitura rápida sem poluir, no tom do tema espresso.
const tint = (hex: string, a = 0.12) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})` }
const competenciaAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const compLabel = (c: string) => { const [y, m] = c.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) }

type Contrato = { id: string; cliente_id: string | null; fee_mensal: number | null; dia_vencimento: number | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }
type Lanc = { id: string; contrato_id: string; cliente_id: string | null; competencia: string; valor: number; status: string; observacao: string | null; lancado_em: string | null; enviado_em: string | null; pago_em: string | null; estornado_em: string | null; motivo_estorno: string | null }

const ST: Record<string, { rot: string; cor: string }> = {
  lancada: { rot: 'Lançada', cor: DOURADO }, enviada: { rot: 'Enviada', cor: AZUL },
  paga: { rot: 'Paga', cor: GREEN }, estornada: { rot: 'Estornada', cor: VERMELHO },
}

export default function CobrancaPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [contratos, setContratos] = useState<Contrato[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [lancs, setLancs] = useState<Lanc[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState<string | null>(null); const [toast, setToast] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    // Contratos + lançamentos primeiro; só então os clientes REFERENCIADOS (por id). Buscar "todos os clientes da
    // empresa" estourava o limite padrão de 1000 linhas do PostgREST em empresas com muitos clientes (p.ex. 1370),
    // e os contratos/lançamentos cujo cliente ficava fora da página resolviam o nome como "—". Buscando só os ids
    // usados, o nome real sempre aparece (e o conjunto é pequeno). RD-45: RLS por empresa segue valendo.
    const [c, lc] = await Promise.all([
      supabase.from('agency_contratos').select('id, cliente_id, fee_mensal, dia_vencimento').eq('company_id', empresa).eq('tipo', 'recorrente').eq('status', 'ativo'),
      supabase.rpc('fn_agency_cobranca_listar', { p_company_id: empresa }),
    ])
    const contratosData = (c.data ?? []) as Contrato[]
    const r = (lc.data ?? {}) as { ok?: boolean; lancamentos?: Lanc[] }
    const lancsData = r.ok ? (r.lancamentos ?? []) : []
    const ids = Array.from(new Set([...contratosData.map((x) => x.cliente_id), ...lancsData.map((x) => x.cliente_id)].filter((v): v is string => !!v)))
    let clientesData: Cli[] = []
    if (ids.length) {
      const { data: cl } = await supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa).in('id', ids)
      clientesData = (cl ?? []) as Cli[]
    }
    setContratos(contratosData); setClientes(clientesData); setLancs(lancsData)
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  // Nome do cliente para exibição. Sem vínculo (cliente_id nulo) → rótulo claro, nunca "—" cru. Vínculo que não
  // resolve (cliente ausente/removido) → aviso, para o usuário saber que há um dado a corrigir.
  const nomeCli = (id: string | null): { texto: string; vinculado: boolean } => {
    if (!id) return { texto: 'Sem cliente vinculado', vinculado: false }
    const c = clientes.find((x) => x.id === id)
    return c ? { texto: c.nome_fantasia ?? c.nome, vinculado: true } : { texto: 'Cliente não encontrado', vinculado: false }
  }

  const comp = competenciaAtual()
  const vivaDoMes = useMemo(() => {
    const m = new Map<string, Lanc>()
    for (const l of lancs) if (l.competencia?.slice(0, 10) === comp && l.status !== 'estornada') m.set(l.contrato_id, l)
    return m
  }, [lancs, comp])

  const chamar = async (rpc: string, args: Record<string, unknown>, ok: string, key: string) => {
    setBusy(key)
    const { data, error } = await supabase.rpc(rpc, args)
    setBusy(null)
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (error || !r.ok) { setToast(`Não foi possível: ${r.erro ?? error?.message ?? 'erro'}`); return }
    setToast(ok); await carregar()
  }
  const lancar = (c: Contrato) => chamar('fn_agency_cobranca_lancar', { p_company_id: empresa, p_contrato_id: c.id, p_competencia: comp, p_valor: c.fee_mensal ?? 0 }, 'Cobrança lançada.', `lan-${c.id}`)
  const avancar = (l: Lanc, novo: string) => chamar('fn_agency_cobranca_status', { p_id: l.id, p_status: novo }, novo === 'enviada' ? 'Marcada como enviada.' : 'Marcada como paga.', `st-${l.id}`)
  const estornar = (l: Lanc) => { const motivo = window.prompt('Motivo do estorno (fica no histórico):', ''); if (motivo === null) return; void chamar('fn_agency_cobranca_estornar', { p_id: l.id, p_motivo: motivo || null }, 'Cobrança estornada.', `es-${l.id}`) }

  const mrr = useMemo(() => contratos.reduce((s, c) => s + Number(c.fee_mensal ?? 0), 0), [contratos])
  const recebidoMes = useMemo(() => lancs.filter((l) => l.competencia?.slice(0, 10) === comp && l.status === 'paga').reduce((s, l) => s + Number(l.valor ?? 0), 0), [lancs, comp])
  const abertoMes = useMemo(() => lancs.filter((l) => l.competencia?.slice(0, 10) === comp && (l.status === 'lancada' || l.status === 'enviada')).reduce((s, l) => s + Number(l.valor ?? 0), 0), [lancs, comp])
  const mesL = useMemo(() => new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), [])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>💰 P&amp;M · Financeiro</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Cobrança / Fee<AjudaCampo chave="pm.cobranca.tela" rota={ROTA} /></h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0', textTransform: 'capitalize' }}>Mensalidades recorrentes a cobrar · {mesL}</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Contratos a cobrar" v={String(contratos.length)} chave="pm.cobranca.kpi_contratos" />
          <Kpi l="Total do mês (MRR)" v={brl(mrr)} cor={DOURADO} chave="pm.cobranca.kpi_mrr" />
          <Kpi l="Recebido no mês" v={brl(recebidoMes)} cor={GREEN} chave="pm.cobranca.kpi_recebido" />
          <Kpi l="Em aberto no mês" v={brl(abertoMes)} cor={AZUL} chave="pm.cobranca.kpi_aberto" />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : contratos.length === 0 ? <Vazio icon="💤" titulo="Nenhuma mensalidade recorrente ativa" sub="Os contratos recorrentes ativos da empresa aparecem aqui para você lançar a cobrança do mês." />
          : (
            <div style={{ display: 'grid', gap: 10 }}>
              {contratos.map((c) => {
                const l = vivaDoMes.get(c.id); const s = l ? ST[l.status] : null
                return (
                  <div key={c.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 1px 2px rgba(61,35,20,0.04)' }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      {(() => { const nc = nomeCli(c.cliente_id); return (
                        <div style={{ fontWeight: 700, fontSize: 15, color: nc.vinculado ? ESPRESSO : TEXTM, fontStyle: nc.vinculado ? 'normal' : 'italic' }}
                          title={nc.vinculado ? undefined : 'Contrato sem cliente vinculado — corrija o vínculo do contrato em P&M · Contratos'}>{nc.texto}</div>
                      ) })()}
                      <div style={{ fontSize: 12, color: TEXTM, marginTop: 3 }}>vencimento dia {c.dia_vencimento ?? '—'}</div>
                    </div>
                    <div style={{ minWidth: 110, textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{brl(Number((l?.valor ?? c.fee_mensal) ?? 0))}</div>
                      <div style={{ fontSize: 10.5, color: TEXTM, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 }}>no mês</div>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', minWidth: 96 }}>
                      <span title="Etapa da cobrança deste contrato no mês" style={chipStyle(s ? s.cor : TEXTM)}>
                        {s ? s.rot : 'A lançar'}
                      </span>
                      <AjudaCampo chave="pm.cobranca.status" rota={ROTA} />
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {!l && <>
                        <button onClick={() => void lancar(c)} disabled={busy === `lan-${c.id}`} style={btn(DOURADO)}>Lançar cobrança</button>
                        <AjudaCampo chave="pm.cobranca.acao_lancar" rota={ROTA} />
                      </>}
                      {l?.status === 'lancada' && <>
                        <button onClick={() => void avancar(l, 'enviada')} disabled={busy === `st-${l.id}`} style={btn(AZUL)}>Marcar enviada</button>
                        <AjudaCampo chave="pm.cobranca.acao_avancar" rota={ROTA} />
                      </>}
                      {l?.status === 'enviada' && <>
                        <button onClick={() => void avancar(l, 'paga')} disabled={busy === `st-${l.id}`} style={btn(GREEN)}>Marcar paga</button>
                        <AjudaCampo chave="pm.cobranca.acao_avancar" rota={ROTA} />
                      </>}
                      {l && l.status !== 'paga' && <>
                        <button onClick={() => estornar(l)} disabled={busy === `es-${l.id}`} style={btnGhost(VERMELHO)}>Estornar</button>
                        <AjudaCampo chave="pm.cobranca.acao_estornar" rota={ROTA} />
                      </>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 8px', display: 'flex', alignItems: 'center' }}>Histórico de cobranças<AjudaCampo chave="pm.cobranca.historico" rota={ROTA} /></h2>
          {lancs.length === 0 ? <Vazio icon="🧾" titulo="Nenhuma cobrança lançada ainda" sub="Ao lançar a primeira cobrança do mês, o histórico aparece aqui com status, competência e trilha de auditoria." />
            : <div style={{ display: 'grid', gap: 8 }}>
                {lancs.map((l) => { const s = ST[l.status]
                  return (
                    <div key={l.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                      {(() => { const nc = nomeCli(l.cliente_id); return (
                        <div style={{ flex: 1, minWidth: 150, fontWeight: 600, color: nc.vinculado ? undefined : TEXTM, fontStyle: nc.vinculado ? undefined : 'italic' }}
                          title={nc.vinculado ? undefined : 'Cobrança sem cliente vinculado'}>{nc.texto}</div>
                      ) })()}
                      <div style={{ minWidth: 90, color: TEXTM, textTransform: 'capitalize' }}>{compLabel(l.competencia?.slice(0, 10) ?? '')}</div>
                      <div style={{ minWidth: 100, textAlign: 'right', fontWeight: 700, color: l.status === 'estornada' ? TEXTM : ESPRESSO, textDecoration: l.status === 'estornada' ? 'line-through' : 'none' }}>{brl(Number(l.valor))}</div>
                      <div style={{ minWidth: 90 }}><span style={chipStyle(s?.cor ?? TEXTM)}>{s?.rot ?? l.status}</span></div>
                      {l.status === 'estornada' && l.motivo_estorno && <div style={{ color: VERMELHO, fontSize: 12, flexBasis: '100%' }}>Motivo do estorno: {l.motivo_estorno}</div>}
                    </div>
                  )
                })}
              </div>}
        </section>

        <p style={{ fontSize: 11.5, color: TEXTM, marginTop: 14, display: 'flex', alignItems: 'flex-start' }}>
          <span>Para corrigir o valor ou a competência de uma cobrança já lançada, <b>estorne</b> e <b>lance novamente</b> — o livro é imutável, e o histórico e a trilha de auditoria ficam preservados (não há &ldquo;Editar&rdquo; de propósito).</span>
          <AjudaCampo chave="pm.cobranca.correcao" rota={ROTA} />
        </p>
        <p style={{ fontSize: 11, color: TEXTM, marginTop: 8, fontStyle: 'italic' }}>
          A emissão da cobrança na Gestão Empresarial (erp_receber / Asaas) é ligada após a régua de não-regressão financeira (RD-53).
        </p>
        <p style={{ fontSize: 10.5, color: TEXTM, marginTop: 6 }}>
          Origem do dado: contratos recorrentes ativos (<code>agency_contratos</code>) e o histórico de lançamentos
          (<code>agency_cobranca_lancamento</code>), por <code>fn_agency_cobranca_listar/lancar/status/estornar</code>. Escopo por empresa.
        </p>
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}
// Selo de status em pílula, com tinta suave da própria cor — leitura rápida mantendo o tom do tema.
const chipStyle = (cor: string): CSSProperties => ({ display: 'inline-block', fontSize: 11, fontWeight: 700, color: cor, background: tint(cor, 0.12), border: `1px solid ${tint(cor, 0.34)}`, borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' })
// Estado vazio premium: ícone + título + orientação do que aparece ali (acabamento espresso/off-white).
function Vazio({ icon, titulo, sub }: { icon: string; titulo: string; sub: string }) {
  return <div style={{ background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 14, padding: '34px 24px', textAlign: 'center' }}>
    <div style={{ fontSize: 30, lineHeight: 1 }} aria-hidden>{icon}</div>
    <div style={{ fontWeight: 700, fontSize: 15, color: ESPRESSO, marginTop: 10 }}>{titulo}</div>
    <div style={{ fontSize: 13, color: TEXTM, marginTop: 6, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>{sub}</div>
  </div>
}
function btn(cor: string): CSSProperties { return { background: cor, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }
function btnGhost(cor: string): CSSProperties { return { background: '#fff', color: cor, border: `1px solid ${cor}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }
function Kpi({ l, v, cor, chave }: { l: string; v: string; cor?: string; chave?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
