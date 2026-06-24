'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada, usePropriedade } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'
const GREEN = '#5C8D3F'
const YELLOW = '#C8941A'
const RED = '#C44536'

type Aba = 'painel' | 'pesagem' | 'reproducao'
type Animal = { id: string; identificacao: string | null; categoria: string; sexo: 'M' | 'F' | null; lote_id: string | null; area_atual_id: string | null }
type Lote = { id: string; codigo: string }
type Area = { id: string; nome: string; tipo: string }
type Painel = {
  ok: boolean; total: number; pesados_30d: number; pct_pesados_30d: number; sem_pesagem: number
  peso_medio_por_categoria: Array<{ categoria: string; peso_medio: number; n: number }>
  gmd_medio_rebanho: number | null
  repro_distribuicao: Record<string, number>
}
type UltimoPeso = { peso_kg: number; data: string; gmd_anterior: number | null }
type EstadoRepro = { estado: string; data: string }

export default function ManejoPage() {
  const { companyId } = useEmpresaSelecionada()
  const { propriedade, loading: loadingProp } = usePropriedade(companyId)
  const propriedadeId = propriedade?.id ?? null
  const [aba, setAba] = useState<Aba>('painel')
  const [refresh, setRefresh] = useState(0)

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60, minHeight: '100%' }} className="p-6 text-sm">
      Selecione uma empresa especifica para abrir o manejo.
    </div>
  )
  if (loadingProp) return <div style={{ background: BG }} className="p-6" />
  if (!propriedade) return (
    <div style={{ background: BG, color: ESP60, minHeight: '100%' }} className="p-6 text-sm">
      Esta empresa nao tem propriedade cadastrada.
    </div>
  )

  return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6">
      <header className="max-w-5xl mx-auto mb-4">
        <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: GOLD }}>⚖️ Pecuária · {propriedade.nome}</div>
        <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Manejo &amp; Pesagem</h1>
      </header>

      <nav className="max-w-5xl mx-auto flex gap-1 mb-4 overflow-x-auto" style={{ borderBottom: `1px solid ${LINE}` }}>
        {(['painel', 'pesagem', 'reproducao'] as Aba[]).map((a) => (
          <button key={a} onClick={() => setAba(a)} className="px-4 py-2.5 text-sm whitespace-nowrap"
            style={{ color: aba === a ? GOLD : ESP60, fontWeight: aba === a ? 600 : 400,
              borderBottom: aba === a ? `2px solid ${GOLD}` : '2px solid transparent', marginBottom: -1 }}>
            {a === 'painel' ? 'Painel' : a === 'pesagem' ? 'Pesagem' : 'Reprodução'}
          </button>
        ))}
      </nav>

      <div className="max-w-5xl mx-auto">
        {aba === 'painel' && <Painel companyId={companyId} propriedadeId={propriedadeId!} refresh={refresh} />}
        {aba === 'pesagem' && <Pesagem companyId={companyId} propriedadeId={propriedadeId!} onDone={() => setRefresh((r) => r + 1)} />}
        {aba === 'reproducao' && <Reproducao companyId={companyId} propriedadeId={propriedadeId!} onDone={() => setRefresh((r) => r + 1)} />}
      </div>
    </div>
  )
}

// ───────── Painel ─────────
function Painel({ companyId, propriedadeId, refresh }: { companyId: string; propriedadeId: string; refresh: number }) {
  const [data, setData] = useState<Painel | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!companyId || !propriedadeId) return
    let alive = true
    setLoading(true)
    ;(async () => {
      const { data: r } = await supabase.rpc('fn_pec_manejo_painel', { p_company_id: companyId, p_propriedade_id: propriedadeId })
      if (alive) { setData(r as Painel); setLoading(false) }
    })()
    return () => { alive = false }
  }, [companyId, propriedadeId, refresh])

  if (loading) return <div className="text-sm" style={{ color: ESP60 }}>Carregando…</div>
  if (!data?.ok) return <div className="text-sm" style={{ color: ESP60 }}>Sem dados de painel.</div>

  const repro = data.repro_distribuicao ?? {}
  const totalRepro = Object.values(repro).reduce((s, v) => s + Number(v ?? 0), 0)
  const Card = ({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) => (
    <div className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-3xl font-bold" style={{ color: color ?? ESP }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: ESP60 }}>{label}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color: ESP60 }}>{sub}</div>}
    </div>
  )
  const gmdColor = data.gmd_medio_rebanho == null ? ESP : data.gmd_medio_rebanho < 0.5 ? RED : data.gmd_medio_rebanho < 0.8 ? YELLOW : GREEN
  const pctColor = data.pct_pesados_30d < 30 ? RED : data.pct_pesados_30d < 70 ? YELLOW : GREEN

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="GMD médio (kg/dia)" value={data.gmd_medio_rebanho ?? '—'} color={gmdColor} sub="entre as 2 últimas pesagens" />
        <Card label="% rebanho pesado 30d" value={`${data.pct_pesados_30d}%`} color={pctColor} sub={`${data.pesados_30d} de ${data.total}`} />
        <Card label="Sem pesagem" value={data.sem_pesagem} />
        <Card label="Total ativo" value={data.total} />
      </div>

      <section className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="text-sm font-semibold mb-3" style={{ color: ESP }}>Peso médio por categoria</div>
        {(data.peso_medio_por_categoria ?? []).length === 0 ? (
          <div className="text-xs" style={{ color: ESP60 }}>Sem pesagens registradas ainda.</div>
        ) : (
          <div className="space-y-2">
            {data.peso_medio_por_categoria.map((c) => {
              const max = Math.max(...data.peso_medio_por_categoria.map((x) => x.peso_medio))
              return (
                <div key={c.categoria} className="flex items-center gap-3">
                  <span className="text-xs capitalize w-28 shrink-0" style={{ color: ESP }}>{c.categoria.replace('_', ' ')}</span>
                  <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: BG }}>
                    <div style={{ width: `${(c.peso_medio / max) * 100}%`, background: GOLD, height: '100%' }} />
                  </div>
                  <span className="text-sm font-semibold w-20 text-right" style={{ color: ESP }}>{c.peso_medio} kg</span>
                  <span className="text-xs w-10 text-right" style={{ color: ESP60 }}>n={c.n}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="text-sm font-semibold mb-3" style={{ color: ESP }}>Distribuição reprodutiva</div>
        {totalRepro === 0 ? (
          <div className="text-xs" style={{ color: ESP60 }}>Nenhum diagnóstico reprodutivo registrado.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(repro).map(([estado, n]) => {
              const cor = estado === 'prenha' ? GREEN : estado === 'vazia' ? YELLOW : estado === 'descarte_repro' ? RED : ESP
              return (
                <span key={estado} className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${cor}18`, color: cor, border: `1px solid ${cor}40` }}>
                  {estado.replace('_', ' ')} · {n}
                </span>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

// ───────── Pesagem batch ─────────
function Pesagem({ companyId, propriedadeId, onDone }: { companyId: string; propriedadeId: string; onDone: () => void }) {
  const hoje = new Date().toISOString().slice(0, 10)
  const [data, setData] = useState(hoje)
  const [metodo, setMetodo] = useState<'balanca' | 'fita' | 'visual' | 'estimado'>('balanca')
  const [lotes, setLotes] = useState<Lote[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [filtroLote, setFiltroLote] = useState('')
  const [filtroArea, setFiltroArea] = useState('')
  const [animais, setAnimais] = useState<Animal[]>([])
  const [ultimos, setUltimos] = useState<Record<string, UltimoPeso | null>>({})
  const [pesos, setPesos] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const inpRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    if (!companyId || !propriedadeId) return
    let alive = true
    ;(async () => {
      const [l, a] = await Promise.all([
        supabase.from('erp_pec_lote').select('id, codigo')
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo').order('codigo'),
        supabase.from('erp_pec_area').select('id, nome, tipo')
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('ativo', true).order('nome'),
      ])
      if (!alive) return
      setLotes((l.data as Lote[]) ?? [])
      setAreas((a.data as Area[]) ?? [])
    })()
    return () => { alive = false }
  }, [companyId, propriedadeId])

  const carregarAnimais = useCallback(async () => {
    if (!filtroLote && !filtroArea) { setAnimais([]); setUltimos({}); return }
    let q = supabase.from('erp_pec_animal')
      .select('id, identificacao, categoria, sexo, lote_id, area_atual_id')
      .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo')
    if (filtroLote) q = q.eq('lote_id', filtroLote)
    if (filtroArea) q = q.eq('area_atual_id', filtroArea)
    const { data } = await q.order('identificacao').limit(500)
    const lst = (data as Animal[]) ?? []
    setAnimais(lst)
    // Carrega o ultimo peso de cada animal (em paralelo)
    if (lst.length > 0) {
      const { data: pesagens } = await supabase.from('erp_pec_pesagem')
        .select('animal_id, peso_kg, data')
        .eq('company_id', companyId)
        .in('animal_id', lst.map((x) => x.id))
        .order('data', { ascending: false })
      const ult: Record<string, UltimoPeso | null> = {}
      for (const p of (pesagens ?? []) as Array<{ animal_id: string; peso_kg: number; data: string }>) {
        if (!ult[p.animal_id]) ult[p.animal_id] = { peso_kg: p.peso_kg, data: p.data, gmd_anterior: null }
      }
      setUltimos(ult)
    }
  }, [companyId, propriedadeId, filtroLote, filtroArea])
  useEffect(() => { carregarAnimais() }, [carregarAnimais])

  const setPeso = (id: string, v: string) => setPesos((p) => ({ ...p, [id]: v.replace(/[^0-9.,]/g, '').replace(',', '.') }))

  const salvar = async () => {
    setBusy(true); setMsg(null)
    const pendentes = animais.filter((a) => {
      const v = Number(pesos[a.id])
      return Number.isFinite(v) && v > 0
    })
    if (pendentes.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Preencha o peso de ao menos 1 animal.' })
      setBusy(false); return
    }
    let criados = 0; const erros: string[] = []
    for (const a of pendentes) {
      const { error } = await supabase.rpc('fn_pec_pesagem_registrar', {
        p_company_id: companyId, p_propriedade_id: propriedadeId, p_animal_id: a.id,
        p_data: data, p_peso_kg: Number(pesos[a.id]), p_metodo: metodo, p_observacao: null, p_id: null,
      })
      if (error) erros.push(`${a.identificacao || 'sem id'}: ${error.message}`)
      else criados++
    }
    setBusy(false)
    if (criados > 0) {
      setMsg({ tipo: 'ok', texto: `CRIOU ${criados} pesage${criados === 1 ? 'm' : 'ns'}${erros.length ? ` · ${erros.length} com erro` : ''}` })
      setPesos({})
      carregarAnimais()
      onDone()
    } else {
      setMsg({ tipo: 'erro', texto: erros[0] ?? 'Nenhuma pesagem criada.' })
    }
  }

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  return (
    <div className="space-y-3">
      <section className="rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 font-semibold" style={{ color: ESP60 }}>Data</label>
          <input type="date" className={inp} value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 font-semibold" style={{ color: ESP60 }}>Método</label>
          <select className={inp} value={metodo} onChange={(e) => setMetodo(e.target.value as typeof metodo)}>
            <option value="balanca">Balança</option>
            <option value="fita">Fita</option>
            <option value="visual">Visual</option>
            <option value="estimado">Estimado</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 font-semibold" style={{ color: ESP60 }}>Lote</label>
          <select className={inp} value={filtroLote} onChange={(e) => { setFiltroLote(e.target.value); if (e.target.value) setFiltroArea('') }}>
            <option value="">—</option>
            {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 font-semibold" style={{ color: ESP60 }}>Piquete</label>
          <select className={inp} value={filtroArea} onChange={(e) => { setFiltroArea(e.target.value); if (e.target.value) setFiltroLote('') }}>
            <option value="">—</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
        </div>
      </section>

      {animais.length === 0 ? (
        <div className="rounded-2xl p-6 text-center text-sm" style={{ background: '#fff', border: `1px dashed ${LINE}`, color: ESP60 }}>
          Selecione um lote ou piquete para carregar os animais.
        </div>
      ) : (
        <section className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <div className="p-3 flex items-center justify-between text-sm border-b" style={{ borderColor: LINE, color: ESP60 }}>
            <span>{animais.length} animal(is)</span>
            <span>{Object.values(pesos).filter((v) => Number(v) > 0).length} preenchido(s)</span>
          </div>
          {animais.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-3 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate" style={{ color: ESP }}>{a.identificacao || '(sem brinco)'}</div>
                <div className="text-xs capitalize" style={{ color: ESP60 }}>
                  {a.categoria.replace('_', ' ')}
                  {ultimos[a.id] && ` · último ${ultimos[a.id]?.peso_kg}kg em ${ultimos[a.id]?.data}`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <input
                  ref={(el) => { inpRefs.current[a.id] = el }}
                  inputMode="decimal"
                  placeholder="kg"
                  value={pesos[a.id] ?? ''}
                  onChange={(e) => setPeso(a.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const idx = animais.findIndex((x) => x.id === a.id)
                      const next = animais[idx + 1]
                      if (next) inpRefs.current[next.id]?.focus()
                    }
                  }}
                  className="w-24 text-right rounded-xl border border-[#E7DECF] bg-white px-2 py-2 text-sm text-[#3D2314]"
                />
                <span className="text-xs" style={{ color: ESP60 }}>kg</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {msg && (
        <div className="rounded-xl p-3 text-sm" style={{
          background: msg.tipo === 'ok' ? '#EAF5DC' : '#FCEBEB',
          color: msg.tipo === 'ok' ? GREEN : RED,
          border: `1px solid ${msg.tipo === 'ok' ? GREEN : RED}`,
        }}>
          {msg.tipo === 'ok' ? '✓ ' : '✕ '}{msg.texto}
        </div>
      )}

      <button onClick={salvar} disabled={busy || animais.length === 0}
        className="w-full rounded-xl py-3 text-sm font-semibold"
        style={{ background: ESP, color: '#fff', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Salvando…' : `CRIAR ${Object.values(pesos).filter((v) => Number(v) > 0).length} pesagens`}
      </button>
    </div>
  )
}

// ───────── Reproducao ─────────
function Reproducao({ companyId, propriedadeId, onDone }: { companyId: string; propriedadeId: string; onDone: () => void }) {
  const hoje = new Date().toISOString().slice(0, 10)
  const [matrizes, setMatrizes] = useState<Animal[]>([])
  const [estadoAtual, setEstadoAtual] = useState<Record<string, EstadoRepro | null>>({})
  const [diag, setDiag] = useState<Record<string, '' | 'prenha' | 'vazia' | 'iatf'>>({})
  const [data, setData] = useState(hoje)
  const [dgMetodo, setDgMetodo] = useState<'toque' | 'ecografia' | 'visual'>('toque')
  const [previsao, setPrevisao] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    const { data: a } = await supabase.from('erp_pec_animal')
      .select('id, identificacao, categoria, sexo, lote_id, area_atual_id')
      .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo')
      .in('categoria', ['matriz', 'novilha']).order('identificacao').limit(500)
    const lst = (a as Animal[]) ?? []
    setMatrizes(lst)
    if (lst.length > 0) {
      const { data: ev } = await supabase.from('erp_pec_repro_evento')
        .select('animal_id, estado, data')
        .eq('company_id', companyId)
        .in('animal_id', lst.map((x) => x.id))
        .order('data', { ascending: false })
      const ult: Record<string, EstadoRepro | null> = {}
      for (const e of (ev ?? []) as Array<{ animal_id: string; estado: string; data: string }>) {
        if (!ult[e.animal_id]) ult[e.animal_id] = { estado: e.estado, data: e.data }
      }
      setEstadoAtual(ult)
    }
  }, [companyId, propriedadeId])
  useEffect(() => { carregar() }, [carregar])

  const salvar = async () => {
    setBusy(true); setMsg(null)
    const itens = Object.entries(diag).filter(([, v]) => v !== '')
    if (itens.length === 0) { setMsg({ tipo: 'erro', texto: 'Marque o estado de ao menos 1 animal.' }); setBusy(false); return }
    let criados = 0; const erros: string[] = []
    for (const [animalId, estado] of itens) {
      const { error } = await supabase.rpc('fn_pec_repro_registrar', {
        p_company_id: companyId, p_propriedade_id: propriedadeId, p_animal_id: animalId,
        p_data: data, p_estado: estado, p_dg_metodo: dgMetodo, p_touro_id: null,
        p_previsao_parto: previsao || null, p_observacao: null, p_id: null,
      })
      if (error) erros.push(`${animalId.slice(0, 8)}: ${error.message}`); else criados++
    }
    setBusy(false)
    if (criados > 0) {
      setMsg({ tipo: 'ok', texto: `CRIOU ${criados} diagnóstico${criados === 1 ? '' : 's'}${erros.length ? ` · ${erros.length} com erro` : ''}` })
      setDiag({}); carregar(); onDone()
    } else {
      setMsg({ tipo: 'erro', texto: erros[0] ?? 'Nenhum diagnóstico criado.' })
    }
  }

  const corEstado = (est: string | undefined): string => {
    if (est === 'prenha') return GREEN
    if (est === 'vazia') return YELLOW
    if (est === 'descarte_repro') return RED
    return ESP60
  }

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  return (
    <div className="space-y-3">
      <section className="rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 font-semibold" style={{ color: ESP60 }}>Data</label>
          <input type="date" className={inp} value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 font-semibold" style={{ color: ESP60 }}>DG método</label>
          <select className={inp} value={dgMetodo} onChange={(e) => setDgMetodo(e.target.value as typeof dgMetodo)}>
            <option value="toque">Toque</option>
            <option value="ecografia">Ecografia</option>
            <option value="visual">Visual</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 font-semibold" style={{ color: ESP60 }}>Previsão de parto</label>
          <input type="date" className={inp} value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
        </div>
      </section>

      {matrizes.length === 0 ? (
        <div className="rounded-2xl p-6 text-center text-sm" style={{ background: '#fff', border: `1px dashed ${LINE}`, color: ESP60 }}>
          Sem matrizes/novilhas ativas.
        </div>
      ) : (
        <section className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <div className="p-3 text-sm border-b" style={{ borderColor: LINE, color: ESP60 }}>
            {matrizes.length} matriz(es)/novilha(s) · {Object.values(diag).filter((v) => v !== '').length} marcada(s)
          </div>
          {matrizes.map((a) => {
            const ult = estadoAtual[a.id]
            const cor = corEstado(ult?.estado)
            const v = diag[a.id] ?? ''
            return (
              <div key={a.id} className="flex items-center gap-2 p-3 text-sm flex-wrap" style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="flex-1 min-w-[140px]">
                  <div className="font-semibold" style={{ color: ESP }}>{a.identificacao || '(sem brinco)'}</div>
                  <div className="text-xs capitalize" style={{ color: ESP60 }}>
                    {a.categoria.replace('_', ' ')}
                    {ult && (<> · <span style={{ color: cor, fontWeight: 600 }}>{ult.estado}</span> em {ult.data}</>)}
                  </div>
                </div>
                <div className="flex gap-1">
                  {(['prenha', 'vazia', 'iatf'] as const).map((opt) => (
                    <button key={opt} type="button" onClick={() => setDiag((d) => ({ ...d, [a.id]: d[a.id] === opt ? '' : opt }))}
                      className="text-[11px] px-2 py-1 rounded-lg font-semibold capitalize"
                      style={{
                        background: v === opt ? (opt === 'prenha' ? GREEN : opt === 'vazia' ? YELLOW : ESP) : '#fff',
                        color: v === opt ? '#fff' : ESP,
                        border: `1px solid ${v === opt ? 'transparent' : LINE}`,
                      }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {msg && (
        <div className="rounded-xl p-3 text-sm" style={{
          background: msg.tipo === 'ok' ? '#EAF5DC' : '#FCEBEB',
          color: msg.tipo === 'ok' ? GREEN : RED,
          border: `1px solid ${msg.tipo === 'ok' ? GREEN : RED}`,
        }}>
          {msg.tipo === 'ok' ? '✓ ' : '✕ '}{msg.texto}
        </div>
      )}

      <button onClick={salvar} disabled={busy || matrizes.length === 0}
        className="w-full rounded-xl py-3 text-sm font-semibold"
        style={{ background: ESP, color: '#fff', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Salvando…' : `CRIAR ${Object.values(diag).filter((v) => v !== '').length} diagnósticos`}
      </button>
    </div>
  )
}
