'use client'
// IA PREÇO ÓTIMO (P&M). Tira a tela do preview (RD-98 p1): sugere o preço do job a partir do CUSTO REAL de jobs
// semelhantes (horas apontadas × custo/hora, via fn_pm_job_custos) e da MARGEM-ALVO, nunca por achismo (RD-38).
// Jornada: escolher serviço → (margem-alvo) → Sugerir preço → Usar na proposta. Margem-alvo é configurável por
// serviço/empresa, com exclusão rastreável (RD-98 p2/p4). "?" (AjudaCampo, RD-95) em cada campo/indicador/ação.
// Escopo por company_id. Tema Espresso (RD-99). Code: code-desenvolvedor-3.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const YELLOW = '#7A5A0F'; const RED = '#7A1F1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Servico = { id: string; nome: string }
type Margem = { id: string; servico_id: string | null; servico_nome: string; margem_pct: number; observacao: string | null }
type Resultado = {
  ok: boolean; margem_pct: number; fonte_margem: 'parametro' | 'servico' | 'geral' | 'padrao'
  custo_base: number | null; fonte_custo: 'real' | 'estimado' | 'sem_custo'
  n_jobs_real: number; n_jobs_estimado: number; horas_media: number | null
  valor_medio_praticado: number | null; n_jobs_valor: number
  preco_sugerido: number | null; lucro_estimado: number | null; markup_pct: number | null
}

const FONTE_CUSTO: Record<string, string> = { real: 'custo real apurado', estimado: 'custo estimado (sem apontamento)', sem_custo: 'sem custo' }
const FONTE_MARGEM: Record<string, string> = { parametro: 'margem que você informou', servico: 'margem-alvo do serviço', geral: 'margem-alvo geral da empresa', padrao: 'padrão (30%)' }

export default function IaPrecoPage() {
  const router = useRouter()
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [servicos, setServicos] = useState<Servico[]>([])
  const [margens, setMargens] = useState<Margem[]>([])
  const [loading, setLoading] = useState(true)
  const [servicoSel, setServicoSel] = useState<string>('')      // '' = toda a carteira / geral
  const [margemInput, setMargemInput] = useState<string>('')     // '' = usa a margem-alvo cadastrada
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [sv, mg] = await Promise.all([
      supabase.from('agency_servico').select('id, nome').eq('company_id', empresa).is('deleted_at', null).eq('ativo', true).order('nome'),
      supabase.rpc('fn_pm_margem_alvo_listar', { p_company_id: empresa }),
    ])
    setServicos((sv.data ?? []) as Servico[])
    setMargens(((mg.data ?? []) as Margem[]))
    setLoading(false)
  }, [empresa])

  useEffect(() => { void carregar() }, [carregar])

  const sugerir = useCallback(async () => {
    if (!empresa) return
    setCalculando(true); setMsg(null); setResultado(null)
    const margem = margemInput.trim() === '' ? null : Number(margemInput.replace(',', '.'))
    if (margem !== null && (!Number.isFinite(margem) || margem < 0 || margem >= 100)) {
      setMsg({ tipo: 'erro', texto: 'A margem-alvo deve ser um número entre 0 e 99,9.' }); setCalculando(false); return
    }
    const { data, error } = await supabase.rpc('fn_pm_preco_sugerido', {
      p_company_id: empresa, p_servico_id: servicoSel || null, p_tipo: null, p_margem_pct: margem,
    })
    if (error) { setMsg({ tipo: 'erro', texto: `Não foi possível calcular: ${error.message}` }) }
    else { setResultado(data as Resultado) }
    setCalculando(false)
  }, [empresa, servicoSel, margemInput])

  const salvarMargem = useCallback(async () => {
    if (!empresa) return
    const margem = Number(margemInput.replace(',', '.'))
    if (!Number.isFinite(margem) || margem < 0 || margem >= 100) {
      setMsg({ tipo: 'erro', texto: 'Informe a margem-alvo (0 a 99,9) para salvar.' }); return
    }
    setSalvando(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_pm_margem_alvo_salvar', {
      p_company_id: empresa, p_servico_id: servicoSel || null, p_margem_pct: margem, p_observacao: null,
    })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setMsg({ tipo: 'erro', texto: `Não foi possível salvar: ${error?.message ?? r?.erro ?? 'erro'}` }) }
    else {
      setMsg({ tipo: 'ok', texto: servicoSel ? 'Margem-alvo do serviço salva.' : 'Margem-alvo geral da empresa salva.' })
      await carregar()
    }
    setSalvando(false)
  }, [empresa, servicoSel, margemInput, carregar])

  const excluirMargem = useCallback(async (m: Margem) => {
    if (!empresa) return
    if (!window.confirm(`Excluir a margem-alvo de "${m.servico_nome}"? A tela volta a usar a margem geral ou o padrão.`)) return
    const { data, error } = await supabase.rpc('fn_pm_margem_alvo_excluir', { p_id: m.id })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setMsg({ tipo: 'erro', texto: `Não foi possível excluir: ${error?.message ?? r?.erro ?? 'erro'}` }) }
    else { setMsg({ tipo: 'ok', texto: 'Margem-alvo excluída.' }); await carregar() }
  }, [empresa, carregar])

  const usarNaProposta = useCallback(() => {
    if (!resultado?.preco_sugerido) return
    const q = new URLSearchParams({ preco: String(resultado.preco_sugerido) })
    if (servicoSel) q.set('servico_id', servicoSel)
    router.push(`/dashboard/pm/propostas?${q.toString()}`)
  }, [router, resultado, servicoSel])

  const nomeServicoSel = useMemo(() => servicos.find((s) => s.id === servicoSel)?.nome ?? 'Toda a carteira', [servicos, servicoSel])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🧮 P&amp;M · Comercial</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center' }}>Preço sugerido<AjudaCampo chave="pm.ia_preco.tela" /></h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>O preço sai do custo real de jobs parecidos (horas × custo/hora) e da margem que você quer — com base em dado, não em achismo.</p>
        </header>

        {/* Simular preço */}
        <section style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: '16px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ flex: '1 1 240px', minWidth: 200 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>Serviço<AjudaCampo chave="pm.ia_preco.servico" /></span>
              <select value={servicoSel} onChange={(e) => setServicoSel(e.target.value)} data-testid="iapreco-servico"
                style={{ width: '100%', minHeight: 42, border: `1px solid ${BORDA}`, borderRadius: 8, padding: '6px 10px', fontSize: 14, background: '#fff', marginTop: 4 }}>
                <option value="">Toda a carteira (média geral)</option>
                {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
            <label style={{ flex: '0 1 180px', minWidth: 150 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>Margem-alvo (%)<AjudaCampo chave="pm.ia_preco.margem" /></span>
              <input type="number" inputMode="decimal" min={0} max={99.9} step="0.5" placeholder="usa a cadastrada" value={margemInput}
                onChange={(e) => setMargemInput(e.target.value)} data-testid="iapreco-margem"
                style={{ width: '100%', minHeight: 42, border: `1px solid ${BORDA}`, borderRadius: 8, padding: '6px 10px', fontSize: 14, marginTop: 4 }} />
            </label>
            <button type="button" onClick={() => void sugerir()} disabled={calculando} data-testid="iapreco-sugerir"
              style={{ background: ESPRESSO, color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', minHeight: 42, fontWeight: 700, fontSize: 14, cursor: calculando ? 'default' : 'pointer', opacity: calculando ? 0.6 : 1 }}>
              {calculando ? 'Calculando…' : 'Sugerir preço'}
            </button>
          </div>
          {msg && <div data-testid="iapreco-msg" style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: msg.tipo === 'ok' ? GREEN : RED }}>{msg.texto}</div>}
        </section>

        {/* Resultado */}
        {resultado && (
          resultado.fonte_custo === 'sem_custo' ? (
            <section data-testid="iapreco-sem-custo" style={{ background: '#FFF7E6', border: `1px solid ${DOURADO}`, borderRadius: 14, padding: '16px', marginBottom: 16, fontSize: 13 }}>
              <b>Ainda não dá para sugerir um preço para {nomeServicoSel}.</b> Não há custo apurado nem estimado nos jobs
              semelhantes. Aponte as horas dos jobs e cadastre o custo/hora da equipe (tela Equipe) — aí o preço fecha no custo real.
              <div style={{ marginTop: 8 }}><a href="/dashboard/pm/equipe" style={{ color: ESPRESSO, fontWeight: 700 }}>Abrir a tela Equipe →</a></div>
            </section>
          ) : (
            <section style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10 }}>
                <Kpi l="Preço sugerido" v={brl(resultado.preco_sugerido)} cor={DOURADO} grande ajuda="pm.ia_preco.preco_sugerido" testid="iapreco-preco" />
                <Kpi l="Custo base" v={brl(resultado.custo_base)} ajuda="pm.ia_preco.custo_base" testid="iapreco-custo" />
                <Kpi l="Lucro estimado" v={brl(resultado.lucro_estimado)} cor={GREEN} ajuda="pm.ia_preco.lucro" testid="iapreco-lucro" />
                <Kpi l="Markup" v={resultado.markup_pct == null ? '—' : `${resultado.markup_pct.toFixed(1)}%`} ajuda="pm.ia_preco.markup" testid="iapreco-markup" />
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5, color: TEXTM }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>Horas médias: <b style={{ color: ESPRESSO, marginLeft: 4 }}>{resultado.horas_media == null ? '—' : `${resultado.horas_media.toLocaleString('pt-BR')} h`}</b><AjudaCampo chave="pm.ia_preco.horas" /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>Valor médio praticado: <b style={{ color: ESPRESSO, marginLeft: 4 }}>{brl(resultado.valor_medio_praticado)}</b> <span style={{ marginLeft: 3 }}>({resultado.n_jobs_valor} job{resultado.n_jobs_valor === 1 ? '' : 's'})</span><AjudaCampo chave="pm.ia_preco.valor_praticado" /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>Base histórica: <b style={{ color: ESPRESSO, marginLeft: 4 }}>{resultado.n_jobs_real} com custo real · {resultado.n_jobs_estimado} estimado</b><AjudaCampo chave="pm.ia_preco.n_jobs" /></span>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: resultado.fonte_custo === 'estimado' ? YELLOW : TEXTM }}>
                Margem {resultado.margem_pct.toLocaleString('pt-BR')}% ({FONTE_MARGEM[resultado.fonte_margem]}) · base de {FONTE_CUSTO[resultado.fonte_custo]}.
              </div>
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={usarNaProposta} disabled={!resultado.preco_sugerido} data-testid="iapreco-usar-proposta"
                  style={{ display: 'inline-flex', alignItems: 'center', background: DOURADO, color: '#3a2a06', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                  Usar na proposta →<AjudaCampo chave="pm.ia_preco.usar_proposta" />
                </button>
              </div>
            </section>
          )
        )}

        {/* Margens-alvo (CRUD) */}
        <section style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: '16px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'inline-flex', alignItems: 'center' }}>Margens-alvo<AjudaCampo chave="pm.ia_preco.margem_alvo_lista" /></h2>
            <button type="button" onClick={() => void salvarMargem()} disabled={salvando} data-testid="iapreco-salvar-margem"
              style={{ display: 'inline-flex', alignItems: 'center', background: ESPRESSO, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.6 : 1, minHeight: 40 }}>
              {salvando ? 'Salvando…' : `Salvar ${servicoSel ? 'do serviço' : 'geral'} (${margemInput || '—'}%)`}<AjudaCampo chave="pm.ia_preco.margem_alvo_salvar" />
            </button>
          </div>
          <p style={{ fontSize: 12, color: TEXTM, margin: '6px 0 12px' }}>Escolha o serviço e a margem acima; &quot;Salvar&quot; grava para aquele serviço (ou para a empresa toda, se nenhum serviço estiver escolhido).</p>
          {loading ? <div style={{ color: TEXTM, padding: 12 }}>Carregando…</div>
            : margens.length === 0 ? <div style={{ color: TEXTM, fontSize: 13, padding: 12, border: `1px dashed ${BORDA}`, borderRadius: 10 }}>Nenhuma margem-alvo cadastrada — a tela usa 30% como padrão.</div>
            : (
              <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
                  <thead style={{ background: OFFWHITE }}><tr><Th>Serviço</Th><Th>Margem</Th><Th>Ação</Th></tr></thead>
                  <tbody>
                    {margens.map((m) => (
                      <tr key={m.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`iapreco-margem-${m.servico_id ?? 'geral'}`}>
                        <Td><b>{m.servico_nome}</b></Td>
                        <Td>{Number(m.margem_pct).toLocaleString('pt-BR')}%</Td>
                        <Td>
                          <button type="button" onClick={() => { setServicoSel(m.servico_id ?? ''); setMargemInput(String(m.margem_pct)) }} style={{ background: 'none', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: ESPRESSO, cursor: 'pointer', marginRight: 6, minHeight: 34 }}>Editar</button>
                          <button type="button" onClick={() => void excluirMargem(m)} data-testid={`iapreco-excluir-${m.servico_id ?? 'geral'}`} style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: `1px solid ${RED}`, borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: RED, cursor: 'pointer', minHeight: 34 }}>Excluir<AjudaCampo chave="pm.ia_preco.margem_alvo_excluir" /></button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      </div>
    </div>
  )
}

function Kpi({ l, v, cor, grande, ajuda, testid }: { l: string; v: string; cor?: string; grande?: boolean; ajuda?: string; testid?: string }) {
  return <div data-testid={testid} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>{l}{ajuda && <AjudaCampo chave={ajuda} />}</div>
    <div style={{ fontSize: grande ? 26 : 20, fontWeight: 800, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM }}>{children}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <td style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
