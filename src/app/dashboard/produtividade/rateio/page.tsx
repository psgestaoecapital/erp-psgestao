'use client'

// Custeio por kg · fatia F4 — RATEIO ADMINISTRATIVO por posto. A despesa administrativa do mês (que não é de um posto
// específico) é distribuída entre os postos por um critério (horas de mão de obra, kg produzido ou nº de pessoas),
// virando R$/h administrativo por posto — que a F6 (custo por kg) soma ao custo do posto. Genérico para qualquer planta.
// Front puro sobre fn_prod_rateio_admin_get/_salvar/_distribuir (RD-97). Soma das parcelas = base (provado RD-38).

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/produtividade/rateio'
const Aj = ({ k }: { k: string }) => <AjudaCampo chave={k} rota={ROTA} />

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF',
  cream: '#F0ECE3', border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB',
}
const inp: React.CSSProperties = { padding: '8px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.esp, outline: 'none', width: '100%' }
const btn = (on = true): React.CSSProperties => ({ padding: '9px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: on ? 'pointer' : 'not-allowed', background: on ? C.gold : C.espL, color: C.white })

type Plant = { id: string; nome_planta: string }
type Config = { id: string | null; competencia: string; base_valor: number; base_origem: 'digitado' | 'financeiro'; criterio: 'horas_mo' | 'kg' | 'pessoas'; observacao: string | null }
type LinhaRateio = { posto_id: string; posto_numero: string; posto_atividade: string; horas_operacao_mes: number | null; pessoas: number; kg: number; peso: number; rateio_rs_mes: number; rateio_rs_hora: number | null }
type DistResp = { ok: boolean; competencia: string; base_valor: number; criterio: string; total_peso: number; postos: LinhaRateio[]; aviso: string | null }

const CRIT: Record<Config['criterio'], string> = { horas_mo: 'Horas de mão de obra (pessoas × horas)', kg: 'Kg produzido no mês', pessoas: 'Nº de pessoas' }
const mesAtual = () => new Date().toISOString().slice(0, 7) // yyyy-MM
const compToDate = (m: string) => `${m}-01`
const brl = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const brlH = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} /h`)
const nf = (n: number | null, d = 1) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: d }))

export default function RateioPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: C.espM, background: C.bg, minHeight: '100vh' }}>Carregando…</div>}><Inner /></Suspense>
}

function Inner() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null

  const [plants, setPlants] = useState<Plant[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [mes, setMes] = useState<string>(mesAtual())

  const [base, setBase] = useState<string>('')
  const [origem, setOrigem] = useState<Config['base_origem']>('digitado')
  const [criterio, setCriterio] = useState<Config['criterio']>('horas_mo')
  const [obs, setObs] = useState<string>('')
  const [salvando, setSalvando] = useState(false)

  const [dist, setDist] = useState<DistResp | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const flash = useCallback((m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }, [])
  const flashErr = useCallback((m: string) => { setErro(m); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* */ } window.setTimeout(() => setErro(null), 6000) }, [])

  useEffect(() => {
    if (!companyId) { setPlants([]); setPlantId(null); return }
    void (async () => {
      const { data } = await supabase.from('industrial_plants').select('id, nome_planta').eq('company_id', companyId).eq('is_active', true).order('nome_planta')
      const ps = (data as Plant[]) ?? []
      setPlants(ps); setPlantId((prev) => prev && ps.some((p) => p.id === prev) ? prev : (ps[0]?.id ?? null))
    })()
  }, [companyId])

  // carrega a config salva do mês
  useEffect(() => {
    if (!companyId || !plantId) return
    void (async () => {
      const { data, error } = await supabase.rpc('fn_prod_rateio_admin_get', { p_company_id: companyId, p_plant_id: plantId, p_competencia: compToDate(mes) })
      if (error) return
      const cfg = (data as { ok: boolean; config: Config } | null)?.config
      if (cfg) { setBase(cfg.base_valor ? String(cfg.base_valor) : ''); setOrigem(cfg.base_origem ?? 'digitado'); setCriterio(cfg.criterio ?? 'horas_mo'); setObs(cfg.observacao ?? '') }
    })()
  }, [companyId, plantId, mes])

  const carregarDist = useCallback(async () => {
    if (!companyId || !plantId) { setDist(null); return }
    setCarregando(true)
    try {
      const { data, error } = await supabase.rpc('fn_prod_rateio_admin_distribuir', { p_company_id: companyId, p_plant_id: plantId, p_competencia: compToDate(mes) })
      if (error) { flashErr(erroAmigavel(error, 'Não foi possível calcular o rateio. Tente de novo.')); setDist(null); return }
      setDist(data as unknown as DistResp)
    } finally { setCarregando(false) }
  }, [companyId, plantId, mes, flashErr])
  useEffect(() => { void carregarDist() }, [carregarDist])

  const podeSalvar = Boolean(companyId && plantId && base.trim() && !salvando)

  async function salvar() {
    if (!companyId || !plantId) { flashErr('Selecione a planta primeiro.'); return }
    const v = Number(base.replace(/\./g, '').replace(',', '.'))
    if (!(v >= 0) || Number.isNaN(v)) { flashErr('Informe a despesa administrativa do mês (um valor em reais, zero ou mais).'); return }
    setSalvando(true)
    try {
      const { data, error } = await supabase.rpc('fn_prod_rateio_admin_salvar', {
        p_company_id: companyId, p_plant_id: plantId, p_competencia: compToDate(mes),
        p_base_valor: v, p_base_origem: origem, p_criterio: criterio, p_observacao: obs.trim() || null,
      })
      if (error) { flashErr(erroAmigavel(error, 'Não foi possível salvar o rateio. Tente de novo.')); return }
      const r = data as { ok: boolean; erro?: string } | null
      if (!r?.ok) { flashErr(r?.erro === 'base_invalida' ? 'A despesa do mês precisa ser zero ou mais.' : 'Não consegui salvar o rateio.'); return }
      flash('Rateio SALVO — distribuição recalculada')
      await carregarDist()
    } finally { setSalvando(false) }
  }

  const totalRateio = useMemo(() => (dist?.postos ?? []).reduce((s, l) => s + (l.rateio_rs_mes || 0), 0), [dist])

  if (!companyId) return <Aviso texto="Selecione uma empresa específica no topo — o rateio é por planta." />
  if (plants.length === 0) return <Aviso texto="Esta empresa não tem planta industrial cadastrada. Cadastre a planta antes de ratear." />

  const semPeso = dist?.aviso === 'sem_peso'
  const baseZerada = dist?.aviso === 'base_zerada'

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px clamp(14px, 4vw, 40px) 60px', color: C.esp }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Indústria · Custeio por kg</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 0' }}>Rateio administrativo</h1>
        <p style={{ color: C.espM, fontSize: 13, margin: '6px 0 4px', lineHeight: 1.5, maxWidth: 680 }}>
          Distribua a despesa administrativa do mês entre os postos. O resultado é o <b>R$/h administrativo</b> de cada posto — que entra no custo do posto e, na próxima fatia, no custo por kg do produto final.
        </p>
        <div style={{ fontSize: 12.5, margin: '2px 0 14px' }}>
          <Link href="/dashboard/produtividade/custos-posto" style={{ color: C.goldD, fontWeight: 700, textDecoration: 'none' }}>← Custos do posto</Link>
        </div>

        {msg && <div style={{ background: C.greenBg, color: C.green, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
        {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {/* Base do mês */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 16px 18px', marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Base do mês</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            {plants.length > 1 && (
              <label data-ajuda="prod.rateio.planta" style={{ fontSize: 12, color: C.espM }}>Planta
                <select value={plantId ?? ''} onChange={(e) => setPlantId(e.target.value)} style={inp}>
                  {plants.map((p) => <option key={p.id} value={p.id}>{p.nome_planta}</option>)}
                </select>
              </label>
            )}
            <label data-ajuda="prod.rateio.competencia" style={{ fontSize: 12, color: C.espM }}>Mês de referência<Aj k="prod.rateio.competencia" />
              <input data-testid="rateio-mes" type="month" value={mes} onChange={(e) => setMes(e.target.value || mesAtual())} style={inp} />
            </label>
            <label data-ajuda="prod.rateio.base" style={{ fontSize: 12, color: C.espM }}>Despesa administrativa do mês (R$)<Aj k="prod.rateio.base" />
              <input data-testid="rateio-base" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} placeholder="ex.: 48.000,00" style={inp} />
            </label>
            <label data-ajuda="prod.rateio.origem" style={{ fontSize: 12, color: C.espM }}>Origem da base<Aj k="prod.rateio.origem" />
              <select data-testid="rateio-origem" value={origem} onChange={(e) => setOrigem(e.target.value as Config['base_origem'])} style={inp}>
                <option value="digitado">Digitada por mim</option>
                <option value="financeiro">Puxar do financeiro (em breve)</option>
              </select>
            </label>
            <label data-ajuda="prod.rateio.criterio" style={{ fontSize: 12, color: C.espM }}>Critério de distribuição<Aj k="prod.rateio.criterio" />
              <select data-testid="rateio-criterio" value={criterio} onChange={(e) => setCriterio(e.target.value as Config['criterio'])} style={inp}>
                {(Object.keys(CRIT) as Config['criterio'][]).map((c) => <option key={c} value={c}>{CRIT[c]}</option>)}
              </select>
            </label>
            <label data-ajuda="prod.rateio.observacao" style={{ fontSize: 12, color: C.espM, gridColumn: '1 / -1' }}>Observação<Aj k="prod.rateio.observacao" />
              <input data-testid="rateio-obs" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="opcional — o que entrou / ficou de fora da base" style={inp} />
            </label>
          </div>
          {origem === 'financeiro' && (
            <div style={{ fontSize: 11.5, color: C.amber, background: C.amberBg, borderRadius: 8, padding: '7px 10px', marginTop: 10 }}>
              Puxar a base do financeiro da GE (somar as despesas administrativas do DRE) chega na próxima fatia. Por enquanto, informe o valor acima.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            <button data-testid="rateio-salvar" onClick={() => void salvar()} disabled={!podeSalvar} style={btn(podeSalvar)}>{salvando ? 'Salvando…' : 'Salvar e recalcular'}</button>
            <span style={{ fontSize: 11.5, color: C.espM }}>A soma das parcelas é sempre igual à despesa do mês.</span>
          </div>
        </div>

        {/* Distribuição */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Rateio por posto<Aj k="prod.rateio.resultado" /></div>
          {carregando && <span style={{ fontSize: 12, color: C.espM }}>calculando…</span>}
        </div>

        {baseZerada ? (
          <div data-testid="rateio-base-zero" style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '24px 16px', textAlign: 'center', color: C.espM }}>
            Informe a <b style={{ color: C.esp }}>despesa administrativa do mês</b> acima e salve para ver a distribuição por posto.
          </div>
        ) : semPeso ? (
          <div data-testid="rateio-sem-peso" style={{ background: C.amberBg, border: `1px solid ${C.amber}44`, borderRadius: 12, padding: '18px 16px', color: C.esp, fontSize: 13 }}>
            Nenhum posto tem <b>{CRIT[criterio].toLowerCase()}</b> neste mês, então não dá para distribuir por esse critério. Escolha outro critério (ex.: nº de pessoas) ou cadastre as horas / o apontamento do mês.
          </div>
        ) : (dist?.postos?.length ?? 0) === 0 ? (
          <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '24px 16px', textAlign: 'center', color: C.espM }}>
            Esta planta não tem postos ativos. Cadastre os postos em <Link href="/dashboard/produtividade" style={{ color: C.goldD, fontWeight: 700 }}>Produtividade → Postos</Link>.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', background: C.white, border: `1px solid ${C.border}`, borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr style={{ background: C.cream, color: C.espM, textAlign: 'left' }}>
                  <Th>Posto</Th><Th right>Pessoas</Th><Th right>Horas/mês</Th><Th right>Kg/mês</Th>
                  <Th right>Peso</Th><Th right>Rateio R$/mês</Th><Th right>Rateio R$/h</Th>
                </tr>
              </thead>
              <tbody>
                {(dist?.postos ?? []).map((l) => (
                  <tr key={l.posto_id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <Td><b style={{ color: C.esp }}>{l.posto_numero}</b> <span style={{ color: C.espL }}>· {l.posto_atividade}</span></Td>
                    <Td right>{l.pessoas || <span style={{ color: C.espL }}>0</span>}</Td>
                    <Td right>{l.horas_operacao_mes == null ? <span style={{ color: C.espL }}>—</span> : nf(l.horas_operacao_mes)}</Td>
                    <Td right>{l.kg ? nf(l.kg) : <span style={{ color: C.espL }}>—</span>}</Td>
                    <Td right>{nf(l.peso, 2)}</Td>
                    <Td right><b>{brl(l.rateio_rs_mes)}</b></Td>
                    <Td right>{l.rateio_rs_hora == null ? <span style={{ color: C.espL }}>—</span> : brlH(l.rateio_rs_hora)}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.border}`, background: C.goldBg }}>
                  <Td><b>Total</b></Td><Td right /><Td right /><Td right /><Td right>{nf(dist?.total_peso ?? 0, 2)}</Td>
                  <Td right><b>{brl(totalRateio)}</b></Td><Td right />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th style={{ padding: '9px 12px', fontWeight: 700, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: '9px 12px', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{children}</td>
}
function Aviso({ texto }: { texto: string }) { return <div style={{ background: C.bg, minHeight: '100vh', padding: 28, color: C.espM, fontSize: 14 }}>{texto}</div> }
