'use client'
// Painel Contrato + IPS (CVM 19) para a ficha 360°. clienteId + perfil do contexto (sem dropdown).
// Mesmo backend: fn_wealth_contrato_consultoria_salvar / fn_wealth_ips_criar / _aprovar / _obter.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ESP, GOLD, LINE, MUT, fmtData, Pizza, LegendaClasses, inpStyle, Toast } from '../wealth-ui'

const CLASSES: Array<[string, string]> = [
  ['renda_fixa_pos', 'RF Pós-fixada'], ['renda_fixa_pre', 'RF Prefixada'], ['renda_fixa_inflacao', 'RF Inflação'],
  ['renda_variavel', 'Renda Variável'], ['fundos_imob', 'Fundos Imob.'], ['exterior', 'Exterior'], ['alternativos', 'Alternativos'],
]
const RISCO_KEYS = new Set(['renda_variavel', 'exterior', 'alternativos'])
const tetoPerfil = (p: string) => ({ conservador: 20, moderado: 40, arrojado: 70 } as Record<string, number>)[(p || '').toLowerCase()] ?? 100

type Alocacao = Record<string, number>
type Template = { perfil_risco: string; alocacao_alvo: Alocacao | null; benchmark: string | null; frequencia_rebalanceamento: string | null }
type Contrato = { id: string; tipo: string | null; data_inicio: string | null; data_fim: string | null; honorario_tipo: string | null; honorario_valor: number | null; honorario_pct: number | null; status: string | null; documento_url: string | null }
type Coerencia = { risco_pct: number; teto_perfil: number; soma_pct: number; coerente: boolean; soma_ok: boolean; aviso: string | null }
type IpsRow = { id: string; versao: number; perfil_risco: string | null; ativo: boolean; aprovado_em: string | null; alocacao_alvo: Alocacao | null; benchmark: string | null; frequencia_rebalanceamento: string | null; objetivo_principal: string | null; horizonte_investimento: string | null; restricoes_texto: string | null }
type HistItem = { id: string; versao: number; perfil_risco: string | null; ativo: boolean; aprovado_em: string | null; created_at: string }
type IpsData = { ok: boolean; ativo: IpsRow | null; aprovador_atual: boolean; historico: HistItem[] }

function Badge({ texto }: { texto: string }) {
  const map: Record<string, [string, string]> = { vigente: ['#E6F0E6', '#2F5D2F'], rascunho: ['#F3EBDD', '#7A4A0F'], encerrado: ['#EFE7E7', '#6B4A4A'] }
  const [bg, fg] = map[texto] ?? ['#F3EBDD', '#7A4A0F']
  return <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold capitalize" style={{ background: bg, color: fg }}>{texto}</span>
}
function Campo({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <label className={`block ${full ? 'sm:col-span-2' : ''}`}><span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUT }}>{label}</span><div className="mt-1">{children}</div></label>
}

export function ContratoIpsPanel({ clienteId, perfil, onChange }: { clienteId: string; perfil: string | null; onChange?: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [cForm, setCForm] = useState<Partial<Contrato>>({})
  const [ips, setIps] = useState<IpsData | null>(null)
  const [editorOn, setEditorOn] = useState(false)
  const [aloc, setAloc] = useState<Alocacao>({})
  const [ipsCampos, setIpsCampos] = useState({ objetivo_principal: '', horizonte_investimento: '', restricoes_texto: '', benchmark: '', frequencia_rebalanceamento: '' })
  const [ultimaCoer, setUltimaCoer] = useState<Coerencia | null>(null)
  const [rascunhoId, setRascunhoId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setEditorOn(false); setUltimaCoer(null); setRascunhoId(null)
    const [{ data: tpl }, { data: contr }, { data: ipsData }] = await Promise.all([
      supabase.from('wealth_ips_templates').select('perfil_risco, alocacao_alvo, benchmark, frequencia_rebalanceamento'),
      supabase.from('wealth_contrato_consultoria').select('id, tipo, data_inicio, data_fim, honorario_tipo, honorario_valor, honorario_pct, status, documento_url').eq('client_id', clienteId).order('criado_em', { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc('fn_wealth_ips_obter', { p_client_id: clienteId }),
    ])
    setTemplates((tpl ?? []) as Template[])
    setContrato((contr ?? null) as Contrato | null)
    setCForm((contr ?? { tipo: 'consultoria_cvm19', honorario_tipo: 'fee_fixo', status: 'rascunho' }) as Partial<Contrato>)
    setIps((ipsData ?? null) as IpsData | null)
  }, [clienteId])
  useEffect(() => { const t = setTimeout(() => { void carregar() }, 0); return () => clearTimeout(t) }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  async function salvarContrato() {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_contrato_consultoria_salvar', {
      p_campos: { id: contrato?.id ?? null, client_id: clienteId, tipo: cForm.tipo ?? 'consultoria_cvm19',
        data_inicio: cForm.data_inicio ?? null, data_fim: cForm.data_fim ?? null, honorario_tipo: cForm.honorario_tipo ?? null,
        honorario_valor: cForm.honorario_valor != null ? String(cForm.honorario_valor) : null,
        honorario_pct: cForm.honorario_pct != null ? String(cForm.honorario_pct) : null,
        status: cForm.status ?? 'rascunho', documento_url: cForm.documento_url ?? null } })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Termo de consultoria salvo.'); await carregar(); onChange?.()
  }

  function abrirEditor() {
    const base = ips?.ativo?.alocacao_alvo ?? templates.find((t) => t.perfil_risco === perfil)?.alocacao_alvo ?? {}
    const seed: Alocacao = {}
    for (const [k] of CLASSES) seed[k] = Number(base[k] ?? 0)
    setAloc(seed)
    const tpl = templates.find((t) => t.perfil_risco === perfil)
    setIpsCampos({ objetivo_principal: ips?.ativo?.objetivo_principal ?? '', horizonte_investimento: ips?.ativo?.horizonte_investimento ?? '', restricoes_texto: ips?.ativo?.restricoes_texto ?? '', benchmark: ips?.ativo?.benchmark ?? tpl?.benchmark ?? '', frequencia_rebalanceamento: ips?.ativo?.frequencia_rebalanceamento ?? tpl?.frequencia_rebalanceamento ?? '' })
    setUltimaCoer(null); setRascunhoId(null); setEditorOn(true)
  }

  const soma = useMemo(() => Object.values(aloc).reduce((a, b) => a + (Number(b) || 0), 0), [aloc])
  const risco = useMemo(() => CLASSES.reduce((a, [k]) => a + (RISCO_KEYS.has(k) ? Number(aloc[k]) || 0 : 0), 0), [aloc])
  const teto = tetoPerfil(perfil ?? '')
  const somaOk = Math.abs(soma - 100) <= 0.5
  const riscoOk = risco <= teto

  async function criarIps() {
    if (!perfil) { setToast('Cliente sem perfil — faça o Suitability primeiro.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_ips_criar', { p_client_id: clienteId, p_template_id: null,
      p_campos: { alocacao_alvo: aloc, objetivo_principal: ipsCampos.objetivo_principal || null, horizonte_investimento: ipsCampos.horizonte_investimento || null, restricoes_texto: ipsCampos.restricoes_texto || null, benchmark: ipsCampos.benchmark || null, frequencia_rebalanceamento: ipsCampos.frequencia_rebalanceamento || null } })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; ips_id?: string; versao?: number; coerencia?: Coerencia } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setUltimaCoer(j.coerencia ?? null); setRascunhoId(j.ips_id ?? null)
    setToast(`IPS v${j.versao} criado como rascunho (aguarda aprovação CVM 19).`)
    await carregar(); onChange?.(); setEditorOn(false)
  }

  async function aprovarIps(ipsId: string) {
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_ips_aprovar', { p_ips_id: ipsId })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; coerencia?: Coerencia } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setUltimaCoer(j.coerencia ?? null); setToast('IPS aprovado e ativado.'); setRascunhoId(null)
    await carregar(); onChange?.()
  }

  const ipsAtivo = ips?.ativo ?? null
  const podeAprovar = ips?.aprovador_atual === true
  const rascunhos = (ips?.historico ?? []).filter((h) => !h.ativo && !h.aprovado_em)

  return (
    <div className="grid gap-4">
      {!perfil && (
        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: '#E7C9A0', background: '#FFF6E9', color: '#7A4A0F' }}>
          Cliente sem perfil de risco. Faça o <strong>Suitability</strong> antes de criar o IPS.
        </div>
      )}

      <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ color: ESP, fontFamily: 'serif' }}>Termo de consultoria</h3>
          <Badge texto={contrato?.status ?? 'rascunho'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Tipo"><select value={cForm.tipo ?? 'consultoria_cvm19'} onChange={(e) => setCForm((f) => ({ ...f, tipo: e.target.value }))} style={inpStyle}><option value="consultoria_cvm19">Consultoria (CVM 19)</option><option value="gestao_discricionaria">Gestão discricionária</option></select></Campo>
          <Campo label="Situação"><select value={cForm.status ?? 'rascunho'} onChange={(e) => setCForm((f) => ({ ...f, status: e.target.value }))} style={inpStyle}><option value="rascunho">Rascunho</option><option value="vigente">Vigente</option><option value="encerrado">Encerrado</option></select></Campo>
          <Campo label="Início"><input type="date" value={cForm.data_inicio ?? ''} onChange={(e) => setCForm((f) => ({ ...f, data_inicio: e.target.value }))} style={inpStyle} /></Campo>
          <Campo label="Fim (opcional)"><input type="date" value={cForm.data_fim ?? ''} onChange={(e) => setCForm((f) => ({ ...f, data_fim: e.target.value }))} style={inpStyle} /></Campo>
          <Campo label="Honorário"><select value={cForm.honorario_tipo ?? 'fee_fixo'} onChange={(e) => setCForm((f) => ({ ...f, honorario_tipo: e.target.value }))} style={inpStyle}><option value="fee_fixo">Fee fixo (R$)</option><option value="percentual_aum">Percentual sobre AUM (%)</option><option value="misto">Misto</option></select></Campo>
          <Campo label={cForm.honorario_tipo === 'percentual_aum' ? 'Percentual (% a.a.)' : 'Valor (R$)'}>
            {cForm.honorario_tipo === 'percentual_aum'
              ? <input type="number" step="0.01" value={cForm.honorario_pct ?? ''} onChange={(e) => setCForm((f) => ({ ...f, honorario_pct: e.target.value === '' ? null : Number(e.target.value) }))} style={inpStyle} />
              : <input type="number" step="0.01" value={cForm.honorario_valor ?? ''} onChange={(e) => setCForm((f) => ({ ...f, honorario_valor: e.target.value === '' ? null : Number(e.target.value) }))} style={inpStyle} />}
          </Campo>
          <Campo label="Documento (URL, opcional)" full><input type="url" placeholder="https://…" value={cForm.documento_url ?? ''} onChange={(e) => setCForm((f) => ({ ...f, documento_url: e.target.value }))} style={inpStyle} /></Campo>
        </div>
        <div className="mt-4"><button onClick={() => void salvarContrato()} disabled={busy} className="rounded-lg px-4 py-2.5 font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>{contrato ? 'Salvar alterações' : 'Salvar termo'}</button></div>
      </section>

      <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-lg" style={{ color: ESP, fontFamily: 'serif' }}>Política de Investimento (IPS)</h3>
          {ipsAtivo ? <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: '#E6F0E6', color: '#2F5D2F' }}>v{ipsAtivo.versao} · aprovado {fmtData(ipsAtivo.aprovado_em)}</span> : <Badge texto="sem IPS aprovado" />}
        </div>
        {ipsAtivo ? (
          <div className="grid gap-4 sm:grid-cols-2 items-center">
            <Pizza aloc={ipsAtivo.alocacao_alvo ?? {}} />
            <div>
              <LegendaClasses aloc={ipsAtivo.alocacao_alvo ?? {}} />
              <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: LINE, color: MUT }}>
                {ipsAtivo.benchmark && <div>Benchmark: {ipsAtivo.benchmark}</div>}
                {ipsAtivo.frequencia_rebalanceamento && <div>Rebalanceamento: {ipsAtivo.frequencia_rebalanceamento}</div>}
                {ipsAtivo.objetivo_principal && <div>Objetivo: {ipsAtivo.objetivo_principal}</div>}
              </div>
            </div>
          </div>
        ) : <p className="text-sm" style={{ color: MUT }}>Nenhum IPS ativo. Crie a partir do perfil e envie para aprovação.</p>}
        {!editorOn && perfil && (
          <div className="mt-4"><button onClick={abrirEditor} disabled={busy} className="rounded-lg px-4 py-2.5 font-semibold border" style={{ borderColor: GOLD, color: ESP, background: '#FFF9EE', opacity: busy ? 0.6 : 1 }}>{ipsAtivo ? 'Nova versão do IPS' : 'Criar IPS a partir do perfil'}</button></div>
        )}
      </section>

      {editorOn && (
        <section className="rounded-xl border p-5" style={{ borderColor: GOLD, background: '#fff' }}>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-base font-semibold" style={{ color: ESP }}>Alocação-alvo · perfil <span className="capitalize">{perfil}</span></h4>
            <button onClick={() => setEditorOn(false)} className="text-sm" style={{ color: MUT }}>Cancelar</button>
          </div>
          <p className="text-xs mb-4" style={{ color: MUT }}>Semeado pelo template do perfil. A soma precisa fechar em 100%.</p>
          <div className="grid gap-4 sm:grid-cols-2 items-start">
            <Pizza aloc={aloc} />
            <div className="grid gap-2">
              {CLASSES.map(([k, lbl]) => (
                <label key={k} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2" style={{ color: ESP }}>{lbl}{RISCO_KEYS.has(k) && <span title="conta como risco" style={{ color: GOLD }}>▲</span>}</span>
                  <span className="flex items-center gap-1"><input type="number" min={0} max={100} step={1} value={aloc[k] ?? 0} onChange={(e) => setAloc((a) => ({ ...a, [k]: Math.max(0, Number(e.target.value) || 0) }))} className="w-20 rounded border p-1.5 text-right" style={{ borderColor: LINE, color: ESP }} /><span style={{ color: MUT }}>%</span></span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: somaOk ? LINE : '#E7B4B4', background: somaOk ? '#fff' : '#FCEEEE' }}><span style={{ color: MUT }}>Soma</span> <strong style={{ color: somaOk ? ESP : '#7A1F1F' }}>{soma}%</strong>{!somaOk && <span style={{ color: '#7A1F1F' }}> — deve fechar em 100%</span>}</div>
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: riscoOk ? LINE : '#E7B4B4', background: riscoOk ? '#fff' : '#FCEEEE' }}><span style={{ color: MUT }}>Risco (RV+ext+alt)</span> <strong style={{ color: riscoOk ? ESP : '#7A1F1F' }}>{risco}%</strong><span style={{ color: MUT }}> · teto {teto}%</span>{!riscoOk && <span style={{ color: '#7A1F1F' }}> — acima do perfil</span>}</div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo label="Objetivo principal"><input value={ipsCampos.objetivo_principal} onChange={(e) => setIpsCampos((c) => ({ ...c, objetivo_principal: e.target.value }))} style={inpStyle} /></Campo>
            <Campo label="Horizonte"><input placeholder="ex.: 5 anos" value={ipsCampos.horizonte_investimento} onChange={(e) => setIpsCampos((c) => ({ ...c, horizonte_investimento: e.target.value }))} style={inpStyle} /></Campo>
            <Campo label="Benchmark"><input placeholder="ex.: CDI + 2%" value={ipsCampos.benchmark} onChange={(e) => setIpsCampos((c) => ({ ...c, benchmark: e.target.value }))} style={inpStyle} /></Campo>
            <Campo label="Frequência de rebalanceamento"><input placeholder="ex.: semestral" value={ipsCampos.frequencia_rebalanceamento} onChange={(e) => setIpsCampos((c) => ({ ...c, frequencia_rebalanceamento: e.target.value }))} style={inpStyle} /></Campo>
            <Campo label="Restrições (texto)" full><textarea rows={2} value={ipsCampos.restricoes_texto} onChange={(e) => setIpsCampos((c) => ({ ...c, restricoes_texto: e.target.value }))} style={{ ...inpStyle, resize: 'vertical' }} /></Campo>
          </div>
          {!riscoOk && <div className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: '#E7C9A0', background: '#FFF6E9', color: '#7A4A0F' }}>⚠ Alocação de risco ({risco}%) acima do teto do perfil {perfil} ({teto}%). Pode salvar o rascunho — o aprovador CVM 19 verá o alerta.</div>}
          <div className="mt-4"><button onClick={() => void criarIps()} disabled={busy || !somaOk} className="rounded-lg px-4 py-2.5 font-semibold" style={{ background: somaOk ? GOLD : 'rgba(200,148,26,0.4)', color: '#fff', opacity: busy ? 0.6 : 1, cursor: somaOk ? 'pointer' : 'not-allowed' }}>Salvar rascunho do IPS</button>{!somaOk && <span className="ml-3 text-sm" style={{ color: MUT }}>Ajuste a soma para 100%.</span>}</div>
        </section>
      )}

      {ultimaCoer && (
        <section className="rounded-xl border p-4 text-sm" style={{ borderColor: ultimaCoer.coerente && ultimaCoer.soma_ok ? '#BFD9BF' : '#E7C9A0', background: ultimaCoer.coerente && ultimaCoer.soma_ok ? '#F0F7F0' : '#FFF6E9' }}>
          <div className="font-semibold mb-1" style={{ color: ESP }}>Coerência (servidor)</div>
          <div style={{ color: MUT }}>Risco {ultimaCoer.risco_pct}% · teto {ultimaCoer.teto_perfil}% · soma {ultimaCoer.soma_pct}%</div>
          {ultimaCoer.aviso ? <div className="mt-1" style={{ color: '#7A4A0F' }}>⚠ {ultimaCoer.aviso}</div> : <div className="mt-1" style={{ color: '#2F5D2F' }}>✓ Alocação coerente com o perfil.</div>}
        </section>
      )}

      {rascunhos.length > 0 && (
        <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
          <h4 className="text-base font-semibold mb-1" style={{ color: ESP }}>Aguardando aprovação (CVM 19)</h4>
          {!podeAprovar && <p className="text-xs mb-3" style={{ color: MUT }}>Somente o consultor habilitado CVM 19 pode aprovar.</p>}
          <ul className="divide-y" style={{ borderColor: LINE }}>
            {rascunhos.map((h) => (
              <li key={h.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm" style={{ color: ESP }}>IPS v{h.versao} <span style={{ color: MUT }}>· criado {fmtData(h.created_at)}</span>{h.id === rascunhoId && <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: '#FFF9EE', color: GOLD }}>novo</span>}<span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: '#F3EBDD', color: '#7A4A0F' }}>rascunho</span></span>
                {podeAprovar ? <button onClick={() => void aprovarIps(h.id)} disabled={busy} className="rounded-lg px-3.5 py-2 text-sm font-semibold" style={{ background: ESP, color: '#fff', opacity: busy ? 0.6 : 1 }}>Aprovar e ativar</button> : <span className="text-xs" style={{ color: MUT }}>aguarda André</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(ips?.historico?.length ?? 0) > 0 && (
        <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
          <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: MUT }}>Histórico do IPS</div>
          <ul className="divide-y" style={{ borderColor: LINE }}>
            {(ips?.historico ?? []).map((h) => (
              <li key={h.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span style={{ color: ESP, fontWeight: h.ativo ? 700 : 400 }}>{h.ativo ? '● ' : '○ '}v{h.versao} <span className="capitalize" style={{ color: MUT }}>· {h.perfil_risco ?? '—'}</span></span>
                <span style={{ color: MUT }}>{h.ativo ? `ativo · aprovado ${fmtData(h.aprovado_em)}` : (h.aprovado_em ? `aprovado ${fmtData(h.aprovado_em)}` : 'rascunho')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Toast msg={toast} />
    </div>
  )
}
