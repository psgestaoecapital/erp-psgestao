'use client'
// WEALTH · Contratos + IPS (CVM 19). Formaliza a consultoria (termo) e cria o IPS (política de investimento)
// a partir do perfil do Suitability. Aprovação EXCLUSIVA do consultor habilitado CVM 19 (o André):
// fn_wealth_ips_obter.aprovador_atual controla a visibilidade/ativação do botão "Aprovar".
// Backend: fn_wealth_contrato_consultoria_salvar / fn_wealth_ips_criar / fn_wealth_ips_aprovar / fn_wealth_ips_obter.
// Identidade PS (Espresso/dourado); coerência perfil × alocação vem do servidor (fonte única, RD-52).
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', GOLD = '#C8941A', BG = '#FAF7F2', LINE = 'rgba(61,35,20,0.12)', MUT = 'rgba(61,35,20,0.6)'
const fmtData = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—')

// Classes de ativo do IPS (mesma nomenclatura dos wealth_ips_templates). "risco" = RV + exterior + alternativos.
const CLASSES: Array<[string, string]> = [
  ['renda_fixa_pos', 'RF Pós-fixada'],
  ['renda_fixa_pre', 'RF Prefixada'],
  ['renda_fixa_inflacao', 'RF Inflação'],
  ['renda_variavel', 'Renda Variável'],
  ['fundos_imob', 'Fundos Imob.'],
  ['exterior', 'Exterior'],
  ['alternativos', 'Alternativos'],
]
const RISCO_KEYS = new Set(['renda_variavel', 'exterior', 'alternativos'])
const CORES: Record<string, string> = {
  renda_fixa_pos: '#6B4A2B', renda_fixa_pre: '#8A5A2B', renda_fixa_inflacao: '#A67C52',
  renda_variavel: '#C8941A', fundos_imob: '#D8B98C', exterior: '#E0B24A', alternativos: '#3D2314',
}
// espelho do teto de risco da fn_wealth_ips_coerencia (preview vivo; a fonte da verdade é o servidor)
const tetoPerfil = (p: string) => ({ conservador: 20, moderado: 40, arrojado: 70 } as Record<string, number>)[(p || '').toLowerCase()] ?? 100

type Cli = { id: string; nome: string; perfil_risco: string | null }
type Alocacao = Record<string, number>
type Template = { perfil_risco: string; alocacao_alvo: Alocacao | null; benchmark: string | null; frequencia_rebalanceamento: string | null }
type Contrato = {
  id: string; tipo: string | null; data_inicio: string | null; data_fim: string | null;
  honorario_tipo: string | null; honorario_valor: number | null; honorario_pct: number | null;
  status: string | null; documento_url: string | null
}
type Coerencia = { risco_pct: number; teto_perfil: number; soma_pct: number; coerente: boolean; soma_ok: boolean; aviso: string | null }
type IpsRow = {
  id: string; versao: number; perfil_risco: string | null; ativo: boolean; aprovado_por: string | null;
  aprovado_em: string | null; alocacao_alvo: Alocacao | null; benchmark: string | null;
  frequencia_rebalanceamento: string | null; objetivo_principal: string | null; horizonte_investimento: string | null;
  restricoes_texto: string | null
}
type HistItem = { id: string; versao: number; perfil_risco: string | null; ativo: boolean; aprovado_por: string | null; aprovado_em: string | null; created_at: string }
type IpsData = { ok: boolean; ativo: IpsRow | null; aprovador_atual: boolean; historico: HistItem[] }

export default function ContratosIpsPage() {
  const { companyIds } = useCompanyIds()
  const empresa = companyIds[0] ?? null

  const [clientes, setClientes] = useState<Cli[]>([])
  const [selId, setSelId] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // contrato
  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [cForm, setCForm] = useState<Partial<Contrato>>({})

  // IPS
  const [ips, setIps] = useState<IpsData | null>(null)
  const [editorOn, setEditorOn] = useState(false)
  const [aloc, setAloc] = useState<Alocacao>({})
  const [ipsCampos, setIpsCampos] = useState({ objetivo_principal: '', horizonte_investimento: '', restricoes_texto: '', benchmark: '', frequencia_rebalanceamento: '' })
  const [ultimaCoer, setUltimaCoer] = useState<Coerencia | null>(null)
  const [rascunhoId, setRascunhoId] = useState<string | null>(null)

  const carregarClientes = useCallback(async () => {
    if (!empresa) { setClientes([]); setLoading(false); return }
    setLoading(true)
    const [{ data: cli }, { data: tpl }] = await Promise.all([
      supabase.from('wealth_clients').select('id, nome, perfil_risco').eq('company_id', empresa).order('nome'),
      supabase.from('wealth_ips_templates').select('perfil_risco, alocacao_alvo, benchmark, frequencia_rebalanceamento'),
    ])
    setClientes((cli ?? []) as Cli[])
    setTemplates((tpl ?? []) as Template[])
    setLoading(false)
  }, [empresa])
  useEffect(() => { const t = setTimeout(() => { void carregarClientes() }, 0); return () => clearTimeout(t) }, [carregarClientes])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const selCli = useMemo(() => clientes.find((c) => c.id === selId) ?? null, [clientes, selId])

  const carregarCliente = useCallback(async (id: string) => {
    setEditorOn(false); setUltimaCoer(null); setRascunhoId(null)
    if (!id) { setContrato(null); setCForm({}); setIps(null); return }
    const [{ data: contr }, { data: ipsData }] = await Promise.all([
      supabase.from('wealth_contrato_consultoria').select('id, tipo, data_inicio, data_fim, honorario_tipo, honorario_valor, honorario_pct, status, documento_url').eq('client_id', id).order('criado_em', { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc('fn_wealth_ips_obter', { p_client_id: id }),
    ])
    setContrato((contr ?? null) as Contrato | null)
    setCForm((contr ?? { tipo: 'consultoria_cvm19', honorario_tipo: 'fee_fixo', status: 'rascunho' }) as Partial<Contrato>)
    setIps((ipsData ?? null) as IpsData | null)
  }, [])
  useEffect(() => { const t = setTimeout(() => { void carregarCliente(selId) }, 0); return () => clearTimeout(t) }, [selId, carregarCliente])

  async function salvarContrato() {
    if (!selId) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_contrato_consultoria_salvar', {
      p_campos: {
        id: contrato?.id ?? null, client_id: selId,
        tipo: cForm.tipo ?? 'consultoria_cvm19',
        data_inicio: cForm.data_inicio ?? null, data_fim: cForm.data_fim ?? null,
        honorario_tipo: cForm.honorario_tipo ?? null,
        honorario_valor: cForm.honorario_valor != null ? String(cForm.honorario_valor) : null,
        honorario_pct: cForm.honorario_pct != null ? String(cForm.honorario_pct) : null,
        status: cForm.status ?? 'rascunho', documento_url: cForm.documento_url ?? null,
      },
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Termo de consultoria salvo.')
    await carregarCliente(selId)
  }

  // seed do editor a partir do template do perfil (ou do IPS ativo, se houver)
  function abrirEditor() {
    const perfil = selCli?.perfil_risco ?? ''
    const base = ips?.ativo?.alocacao_alvo ?? templates.find((t) => t.perfil_risco === perfil)?.alocacao_alvo ?? {}
    const seed: Alocacao = {}
    for (const [k] of CLASSES) seed[k] = Number(base[k] ?? 0)
    setAloc(seed)
    const tpl = templates.find((t) => t.perfil_risco === perfil)
    setIpsCampos({
      objetivo_principal: ips?.ativo?.objetivo_principal ?? '',
      horizonte_investimento: ips?.ativo?.horizonte_investimento ?? '',
      restricoes_texto: ips?.ativo?.restricoes_texto ?? '',
      benchmark: ips?.ativo?.benchmark ?? tpl?.benchmark ?? '',
      frequencia_rebalanceamento: ips?.ativo?.frequencia_rebalanceamento ?? tpl?.frequencia_rebalanceamento ?? '',
    })
    setUltimaCoer(null); setRascunhoId(null); setEditorOn(true)
  }

  const soma = useMemo(() => Object.values(aloc).reduce((a, b) => a + (Number(b) || 0), 0), [aloc])
  const risco = useMemo(() => CLASSES.reduce((a, [k]) => a + (RISCO_KEYS.has(k) ? Number(aloc[k]) || 0 : 0), 0), [aloc])
  const teto = tetoPerfil(selCli?.perfil_risco ?? '')
  const somaOk = Math.abs(soma - 100) <= 0.5
  const riscoOk = risco <= teto

  async function criarIps() {
    if (!selId || !selCli) return
    if (!selCli.perfil_risco) { setToast('Cliente sem perfil — faça o Suitability primeiro.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_ips_criar', {
      p_client_id: selId, p_template_id: null,
      p_campos: {
        alocacao_alvo: aloc,
        objetivo_principal: ipsCampos.objetivo_principal || null,
        horizonte_investimento: ipsCampos.horizonte_investimento || null,
        restricoes_texto: ipsCampos.restricoes_texto || null,
        benchmark: ipsCampos.benchmark || null,
        frequencia_rebalanceamento: ipsCampos.frequencia_rebalanceamento || null,
      },
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; ips_id?: string; versao?: number; coerencia?: Coerencia } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setUltimaCoer(j.coerencia ?? null)
    setRascunhoId(j.ips_id ?? null)
    setToast(`IPS v${j.versao} criado como rascunho (aguarda aprovação CVM 19).`)
    await carregarCliente(selId)
    setEditorOn(false)
  }

  async function aprovarIps(ipsId: string) {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_ips_aprovar', { p_ips_id: ipsId })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; coerencia?: Coerencia } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setUltimaCoer(j.coerencia ?? null)
    setToast('IPS aprovado e ativado.')
    setRascunhoId(null)
    await carregarCliente(selId)
  }

  if (!empresa) return <Shell><p style={{ color: MUT }}>Selecione uma empresa no topo.</p></Shell>

  const ipsAtivo = ips?.ativo ?? null
  const podeAprovar = ips?.aprovador_atual === true
  // rascunhos pendentes de aprovação (versões não-ativas sem aprovação): o recém-criado + qualquer draft do histórico
  const rascunhos = (ips?.historico ?? []).filter((h) => !h.ativo && !h.aprovado_em)

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-sm uppercase tracking-wider font-semibold" style={{ color: GOLD }}>Wealth · Compliance</p>
        <h1 className="text-3xl md:text-4xl" style={{ color: ESP, fontFamily: 'serif' }}>Contratos + IPS</h1>
        <p className="mt-1" style={{ color: MUT }}>Termo de consultoria e Política de Investimento (CVM 19) · aprovação exclusiva do consultor habilitado.</p>
      </header>

      {loading ? <p style={{ color: MUT }}>Carregando…</p> : (
        <>
          <label className="block mb-5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUT }}>Cliente</span>
            <select value={selId} onChange={(e) => setSelId(e.target.value)}
              className="mt-1 block w-full max-w-md rounded-lg border p-2.5"
              style={{ borderColor: LINE, background: '#fff', color: ESP }}>
              <option value="">Selecione um cliente…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.perfil_risco ? ` · ${c.perfil_risco}` : ' · sem perfil'}</option>)}
            </select>
          </label>

          {selCli && (
            <div className="grid gap-4">
              {!selCli.perfil_risco && (
                <div className="rounded-xl border p-4 text-sm" style={{ borderColor: '#E7C9A0', background: '#FFF6E9', color: '#7A4A0F' }}>
                  Este cliente ainda não tem perfil de risco. Faça o <strong>Suitability</strong> antes de criar o IPS.
                </div>
              )}

              {/* ─── Termo de consultoria ─────────────────────────────────────── */}
              <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg" style={{ color: ESP, fontFamily: 'serif' }}>Termo de consultoria</h2>
                  <Badge texto={contrato?.status ?? 'rascunho'} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo label="Tipo">
                    <select value={cForm.tipo ?? 'consultoria_cvm19'} onChange={(e) => setCForm((f) => ({ ...f, tipo: e.target.value }))} style={inp}>
                      <option value="consultoria_cvm19">Consultoria (CVM 19)</option>
                      <option value="gestao_discricionaria">Gestão discricionária</option>
                    </select>
                  </Campo>
                  <Campo label="Situação">
                    <select value={cForm.status ?? 'rascunho'} onChange={(e) => setCForm((f) => ({ ...f, status: e.target.value }))} style={inp}>
                      <option value="rascunho">Rascunho</option>
                      <option value="vigente">Vigente</option>
                      <option value="encerrado">Encerrado</option>
                    </select>
                  </Campo>
                  <Campo label="Início">
                    <input type="date" value={cForm.data_inicio ?? ''} onChange={(e) => setCForm((f) => ({ ...f, data_inicio: e.target.value }))} style={inp} />
                  </Campo>
                  <Campo label="Fim (opcional)">
                    <input type="date" value={cForm.data_fim ?? ''} onChange={(e) => setCForm((f) => ({ ...f, data_fim: e.target.value }))} style={inp} />
                  </Campo>
                  <Campo label="Honorário">
                    <select value={cForm.honorario_tipo ?? 'fee_fixo'} onChange={(e) => setCForm((f) => ({ ...f, honorario_tipo: e.target.value }))} style={inp}>
                      <option value="fee_fixo">Fee fixo (R$)</option>
                      <option value="percentual_aum">Percentual sobre AUM (%)</option>
                      <option value="misto">Misto</option>
                    </select>
                  </Campo>
                  <Campo label={cForm.honorario_tipo === 'percentual_aum' ? 'Percentual (% a.a.)' : 'Valor (R$)'}>
                    {cForm.honorario_tipo === 'percentual_aum' ? (
                      <input type="number" step="0.01" value={cForm.honorario_pct ?? ''} onChange={(e) => setCForm((f) => ({ ...f, honorario_pct: e.target.value === '' ? null : Number(e.target.value) }))} style={inp} />
                    ) : (
                      <input type="number" step="0.01" value={cForm.honorario_valor ?? ''} onChange={(e) => setCForm((f) => ({ ...f, honorario_valor: e.target.value === '' ? null : Number(e.target.value) }))} style={inp} />
                    )}
                  </Campo>
                  <Campo label="Documento (URL, opcional)" full>
                    <input type="url" placeholder="https://…" value={cForm.documento_url ?? ''} onChange={(e) => setCForm((f) => ({ ...f, documento_url: e.target.value }))} style={inp} />
                  </Campo>
                </div>
                <div className="mt-4">
                  <button onClick={() => void salvarContrato()} disabled={busy}
                    className="rounded-lg px-4 py-2.5 font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
                    {contrato ? 'Salvar alterações' : 'Salvar termo'}
                  </button>
                </div>
              </section>

              {/* ─── IPS ativo ─────────────────────────────────────────────────── */}
              <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-lg" style={{ color: ESP, fontFamily: 'serif' }}>Política de Investimento (IPS)</h2>
                  {ipsAtivo
                    ? <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: '#E6F0E6', color: '#2F5D2F' }}>v{ipsAtivo.versao} · aprovado {fmtData(ipsAtivo.aprovado_em)}</span>
                    : <Badge texto="sem IPS aprovado" />}
                </div>

                {ipsAtivo ? (
                  <div className="grid gap-4 sm:grid-cols-2 items-center">
                    <Pizza aloc={ipsAtivo.alocacao_alvo ?? {}} />
                    <div className="grid gap-1.5 text-sm">
                      {CLASSES.map(([k, lbl]) => {
                        const v = Number(ipsAtivo.alocacao_alvo?.[k] ?? 0)
                        if (!v) return null
                        return (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2" style={{ color: ESP }}>
                              <i style={{ width: 10, height: 10, borderRadius: 3, background: CORES[k], display: 'inline-block' }} />{lbl}
                            </span>
                            <span style={{ color: MUT }}>{v}%</span>
                          </div>
                        )
                      })}
                      <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: LINE, color: MUT }}>
                        {ipsAtivo.benchmark && <div>Benchmark: {ipsAtivo.benchmark}</div>}
                        {ipsAtivo.frequencia_rebalanceamento && <div>Rebalanceamento: {ipsAtivo.frequencia_rebalanceamento}</div>}
                        {ipsAtivo.objetivo_principal && <div>Objetivo: {ipsAtivo.objetivo_principal}</div>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: MUT }}>Nenhum IPS ativo. Crie a partir do perfil do cliente e envie para aprovação.</p>
                )}

                {!editorOn && selCli.perfil_risco && (
                  <div className="mt-4">
                    <button onClick={abrirEditor} disabled={busy}
                      className="rounded-lg px-4 py-2.5 font-semibold border" style={{ borderColor: GOLD, color: ESP, background: '#FFF9EE', opacity: busy ? 0.6 : 1 }}>
                      {ipsAtivo ? 'Nova versão do IPS' : 'Criar IPS a partir do perfil'}
                    </button>
                  </div>
                )}
              </section>

              {/* ─── Editor de alocação (soma 100%, coerência viva) ───────────── */}
              {editorOn && (
                <section className="rounded-xl border p-5" style={{ borderColor: GOLD, background: '#fff' }}>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-semibold" style={{ color: ESP }}>Alocação-alvo · perfil <span className="capitalize">{selCli.perfil_risco}</span></h3>
                    <button onClick={() => setEditorOn(false)} className="text-sm" style={{ color: MUT }}>Cancelar</button>
                  </div>
                  <p className="text-xs mb-4" style={{ color: MUT }}>Semeado pelo template do perfil. Ajuste os pesos — a soma precisa fechar em 100%.</p>

                  <div className="grid gap-4 sm:grid-cols-2 items-start">
                    <Pizza aloc={aloc} />
                    <div className="grid gap-2">
                      {CLASSES.map(([k, lbl]) => (
                        <label key={k} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2" style={{ color: ESP }}>
                            <i style={{ width: 10, height: 10, borderRadius: 3, background: CORES[k], display: 'inline-block' }} />
                            {lbl}{RISCO_KEYS.has(k) && <span title="conta como risco" style={{ color: GOLD }}>▲</span>}
                          </span>
                          <span className="flex items-center gap-1">
                            <input type="number" min={0} max={100} step={1} value={aloc[k] ?? 0}
                              onChange={(e) => setAloc((a) => ({ ...a, [k]: Math.max(0, Number(e.target.value) || 0) }))}
                              className="w-20 rounded border p-1.5 text-right" style={{ borderColor: LINE, color: ESP }} />
                            <span style={{ color: MUT }}>%</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* medidores */}
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border p-3 text-sm" style={{ borderColor: somaOk ? LINE : '#E7B4B4', background: somaOk ? '#fff' : '#FCEEEE' }}>
                      <span style={{ color: MUT }}>Soma</span> <strong style={{ color: somaOk ? ESP : '#7A1F1F' }}>{soma}%</strong>
                      {!somaOk && <span style={{ color: '#7A1F1F' }}> — deve fechar em 100%</span>}
                    </div>
                    <div className="rounded-lg border p-3 text-sm" style={{ borderColor: riscoOk ? LINE : '#E7B4B4', background: riscoOk ? '#fff' : '#FCEEEE' }}>
                      <span style={{ color: MUT }}>Risco (RV+ext+alt)</span> <strong style={{ color: riscoOk ? ESP : '#7A1F1F' }}>{risco}%</strong>
                      <span style={{ color: MUT }}> · teto {teto}%</span>
                      {!riscoOk && <span style={{ color: '#7A1F1F' }}> — acima do perfil</span>}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Campo label="Objetivo principal"><input value={ipsCampos.objetivo_principal} onChange={(e) => setIpsCampos((c) => ({ ...c, objetivo_principal: e.target.value }))} style={inp} /></Campo>
                    <Campo label="Horizonte"><input placeholder="ex.: 5 anos" value={ipsCampos.horizonte_investimento} onChange={(e) => setIpsCampos((c) => ({ ...c, horizonte_investimento: e.target.value }))} style={inp} /></Campo>
                    <Campo label="Benchmark"><input placeholder="ex.: CDI + 2%" value={ipsCampos.benchmark} onChange={(e) => setIpsCampos((c) => ({ ...c, benchmark: e.target.value }))} style={inp} /></Campo>
                    <Campo label="Frequência de rebalanceamento"><input placeholder="ex.: semestral" value={ipsCampos.frequencia_rebalanceamento} onChange={(e) => setIpsCampos((c) => ({ ...c, frequencia_rebalanceamento: e.target.value }))} style={inp} /></Campo>
                    <Campo label="Restrições (texto)" full><textarea rows={2} value={ipsCampos.restricoes_texto} onChange={(e) => setIpsCampos((c) => ({ ...c, restricoes_texto: e.target.value }))} style={{ ...inp, resize: 'vertical' }} /></Campo>
                  </div>

                  {!riscoOk && (
                    <div className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: '#E7C9A0', background: '#FFF6E9', color: '#7A4A0F' }}>
                      ⚠ Alocação de risco ({risco}%) acima do teto do perfil <span className="capitalize">{selCli.perfil_risco}</span> ({teto}%). Você ainda pode salvar o rascunho — o aprovador CVM 19 verá o alerta.
                    </div>
                  )}

                  <div className="mt-4">
                    <button onClick={() => void criarIps()} disabled={busy || !somaOk}
                      className="rounded-lg px-4 py-2.5 font-semibold" style={{ background: somaOk ? GOLD : 'rgba(200,148,26,0.4)', color: '#fff', opacity: busy ? 0.6 : 1, cursor: somaOk ? 'pointer' : 'not-allowed' }}>
                      Salvar rascunho do IPS
                    </button>
                    {!somaOk && <span className="ml-3 text-sm" style={{ color: MUT }}>Ajuste a soma para 100% para salvar.</span>}
                  </div>
                </section>
              )}

              {/* ─── Coerência retornada pelo servidor (fonte única) ──────────── */}
              {ultimaCoer && (
                <section className="rounded-xl border p-4 text-sm" style={{ borderColor: ultimaCoer.coerente && ultimaCoer.soma_ok ? '#BFD9BF' : '#E7C9A0', background: ultimaCoer.coerente && ultimaCoer.soma_ok ? '#F0F7F0' : '#FFF6E9' }}>
                  <div className="font-semibold mb-1" style={{ color: ESP }}>Coerência (servidor)</div>
                  <div style={{ color: MUT }}>Risco {ultimaCoer.risco_pct}% · teto {ultimaCoer.teto_perfil}% · soma {ultimaCoer.soma_pct}%</div>
                  {ultimaCoer.aviso
                    ? <div className="mt-1" style={{ color: '#7A4A0F' }}>⚠ {ultimaCoer.aviso}</div>
                    : <div className="mt-1" style={{ color: '#2F5D2F' }}>✓ Alocação coerente com o perfil.</div>}
                </section>
              )}

              {/* ─── Rascunhos aguardando aprovação (botão só para o André) ──── */}
              {rascunhos.length > 0 && (
                <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                  <h3 className="text-base font-semibold mb-1" style={{ color: ESP }}>Aguardando aprovação (CVM 19)</h3>
                  {!podeAprovar && (
                    <p className="text-xs mb-3" style={{ color: MUT }}>Somente o consultor habilitado CVM 19 pode aprovar. Você pode criar e revisar rascunhos.</p>
                  )}
                  <ul className="divide-y" style={{ borderColor: LINE }}>
                    {rascunhos.map((h) => (
                      <li key={h.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-sm" style={{ color: ESP }}>
                          IPS v{h.versao} <span style={{ color: MUT }}>· criado {fmtData(h.created_at)}</span>
                          {h.id === rascunhoId && <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: '#FFF9EE', color: GOLD }}>novo</span>}
                          <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: '#F3EBDD', color: '#7A4A0F' }}>rascunho</span>
                        </span>
                        {podeAprovar ? (
                          <button onClick={() => void aprovarIps(h.id)} disabled={busy}
                            className="rounded-lg px-3.5 py-2 text-sm font-semibold" style={{ background: ESP, color: '#fff', opacity: busy ? 0.6 : 1 }}>
                            Aprovar e ativar
                          </button>
                        ) : (
                          <span className="text-xs" style={{ color: MUT }}>aguarda André</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ─── Histórico de versões ─────────────────────────────────────── */}
              {(ips?.historico?.length ?? 0) > 0 && (
                <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                  <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: MUT }}>Histórico do IPS</div>
                  <ul className="divide-y" style={{ borderColor: LINE }}>
                    {(ips?.historico ?? []).map((h) => (
                      <li key={h.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                        <span style={{ color: ESP, fontWeight: h.ativo ? 700 : 400 }}>
                          {h.ativo ? '● ' : '○ '}v{h.versao} <span className="capitalize" style={{ color: MUT }}>· {h.perfil_risco ?? '—'}</span>
                        </span>
                        <span style={{ color: MUT }}>
                          {h.ativo ? `ativo · aprovado ${fmtData(h.aprovado_em)}` : (h.aprovado_em ? `aprovado ${fmtData(h.aprovado_em)}` : 'rascunho')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </Shell>
  )
}

// ── Pizza (conic-gradient, sem dependência) ──────────────────────────────────
function Pizza({ aloc }: { aloc: Alocacao }) {
  const entradas = CLASSES.map(([k, lbl]) => [k, lbl, Number(aloc[k] ?? 0)] as const).filter(([, , v]) => v > 0)
  const total = entradas.reduce((a, [, , v]) => a + v, 0) || 1
  let acc = 0
  const stops = entradas.map(([k, , v]) => {
    const ini = (acc / total) * 360; acc += v; const fim = (acc / total) * 360
    return `${CORES[k]} ${ini}deg ${fim}deg`
  }).join(', ')
  return (
    <div className="flex items-center justify-center">
      <div style={{ width: 168, height: 168, borderRadius: '50%', background: entradas.length ? `conic-gradient(${stops})` : LINE, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 34, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ fontSize: 11, color: MUT }}>total</span>
          <span style={{ fontSize: 20, color: ESP, fontWeight: 700 }}>{total === 1 && entradas.length === 0 ? 0 : Math.round(total)}%</span>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUT }}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Badge({ texto }: { texto: string }) {
  const map: Record<string, [string, string]> = {
    vigente: ['#E6F0E6', '#2F5D2F'], rascunho: ['#F3EBDD', '#7A4A0F'], encerrado: ['#EFE7E7', '#6B4A4A'],
  }
  const [bg, fg] = map[texto] ?? ['#F3EBDD', '#7A4A0F']
  return <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold capitalize" style={{ background: bg, color: fg }}>{texto}</span>
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ background: BG, minHeight: '100vh' }}><div className="container mx-auto p-4 md:p-6 max-w-4xl">{children}</div></div>
}

const inp: CSSProperties = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: '0.55rem 0.6rem', background: '#fff', color: ESP, fontSize: 14 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
