'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada, usePropriedade } from '@/lib/agro/usePecuaria'
import { parseNumBR, parseDataBR } from '@/lib/num'

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
// RPC fn_pec_manejo_painel retorna um JSONB. Aceita ambos schemas:
// (a) deployado em prod: pesados_30d, sem_pesagem, total_pesagens, peso_medio_categoria, reproducao
// (b) migration #449 (talvez nao deployada): pct_pesados_30d, total, gmd_medio_rebanho, peso_medio_por_categoria, repro_distribuicao
type CategoriaPeso = { categoria: string; peso_medio: number; n: number }
type Painel = {
  pesados_30d?: number; sem_pesagem?: number; total_pesagens?: number
  pct_pesados_30d?: number; total?: number; gmd_medio_rebanho?: number | null
  peso_medio_categoria?: CategoriaPeso[]
  peso_medio_por_categoria?: CategoriaPeso[]
  reproducao?: Record<string, number> | null
  repro_distribuicao?: Record<string, number> | null
  ok?: boolean
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
  const [totalPesagens, setTotalPesagens] = useState<number | null>(null)
  useEffect(() => {
    if (!companyId || !propriedadeId) return
    let alive = true
    setLoading(true)
    ;(async () => {
      const [r1, r2] = await Promise.all([
        supabase.rpc('fn_pec_manejo_painel', { p_company_id: companyId, p_propriedade_id: propriedadeId }),
        supabase.from('erp_pec_pesagem').select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId),
      ])
      if (!alive) return
      setData(r1.data as Painel)
      setTotalPesagens(r2.count ?? 0)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [companyId, propriedadeId, refresh])

  if (loading) return <div className="text-sm" style={{ color: ESP60 }}>Carregando…</div>
  if (!data) return <div className="text-sm" style={{ color: ESP60 }}>Sem dados de painel.</div>

  // Defensivos: tolera ambos schemas de RPC.
  const pesados30d = Number(data.pesados_30d ?? 0)
  const semPesagem = Number(data.sem_pesagem ?? 0)
  const totalPesagensVal = Number(data.total_pesagens ?? totalPesagens ?? 0)
  const totalAnimais = Number(data.total ?? 0) // pode nao existir
  const pctPesados = data.pct_pesados_30d != null
    ? Number(data.pct_pesados_30d)
    : (totalAnimais > 0 ? Math.round((pesados30d / totalAnimais) * 1000) / 10 : null)
  const gmdMedio = data.gmd_medio_rebanho ?? null
  const pesoCategorias: CategoriaPeso[] = data.peso_medio_categoria ?? data.peso_medio_por_categoria ?? []
  const repro = data.reproducao ?? data.repro_distribuicao ?? {}
  const totalRepro = Object.values(repro).reduce((s, v) => s + Number(v ?? 0), 0)
  const Card = ({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) => (
    <div className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-3xl font-bold" style={{ color: color ?? ESP }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: ESP60 }}>{label}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color: ESP60 }}>{sub}</div>}
    </div>
  )
  const gmdColor = gmdMedio == null ? ESP : gmdMedio < 0.5 ? RED : gmdMedio < 0.8 ? YELLOW : GREEN
  const pctColor = pctPesados == null ? ESP : pctPesados < 30 ? RED : pctPesados < 70 ? YELLOW : GREEN

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Pesados (30d)" value={pesados30d} color={pctColor} sub={pctPesados != null ? `${pctPesados}% do rebanho` : undefined} />
        <Card label="Total pesagens" value={totalPesagensVal} sub="histórico desta propriedade" />
        <Card label="Sem pesagem" value={semPesagem} sub={totalAnimais > 0 ? `${totalAnimais} animais ativos` : undefined} />
        <Card label="GMD médio (kg/dia)" value={gmdMedio ?? '—'} color={gmdColor} sub="entre as 2 últimas pesagens" />
      </div>

      <section className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="text-sm font-semibold mb-3" style={{ color: ESP }}>Peso médio por categoria</div>
        {pesoCategorias.length === 0 ? (
          <div className="text-xs" style={{ color: ESP60 }}>Sem pesagens registradas ainda.</div>
        ) : (
          <div className="space-y-2">
            {pesoCategorias.map((c) => {
              const max = Math.max(...pesoCategorias.map((x) => Number(x.peso_medio) || 0), 1)
              const pesoNum = Number(c.peso_medio) || 0
              return (
                <div key={c.categoria} className="flex items-center gap-3">
                  <span className="text-xs capitalize w-28 shrink-0" style={{ color: ESP }}>{c.categoria.replace('_', ' ')}</span>
                  <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: BG }}>
                    <div style={{ width: `${(pesoNum / max) * 100}%`, background: GOLD, height: '100%' }} />
                  </div>
                  <span className="text-sm font-semibold w-20 text-right" style={{ color: ESP }}>{pesoNum} kg</span>
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
          <div className="text-xs" style={{ color: ESP60 }}>—</div>
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
  const [pesagensRecentes, setPesagensRecentes] = useState<Array<{ id: string; animal_id: string; identificacao: string | null; peso_kg: number; data: string }>>([])
  const inpRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const carregarRecentes = useCallback(async () => {
    if (!companyId || !propriedadeId) return
    const { data } = await supabase.from('erp_pec_pesagem')
      .select('id, animal_id, peso_kg, data, erp_pec_animal(identificacao)')
      .eq('company_id', companyId).eq('propriedade_id', propriedadeId)
      .order('created_at', { ascending: false }).limit(15)
    type Row = { id: string; animal_id: string; peso_kg: number; data: string; erp_pec_animal: { identificacao: string | null } | Array<{ identificacao: string | null }> | null }
    const rows = ((data as unknown as Row[]) ?? [])
    setPesagensRecentes(rows.map((r) => {
      const an = Array.isArray(r.erp_pec_animal) ? r.erp_pec_animal[0] : r.erp_pec_animal
      return {
        id: r.id, animal_id: r.animal_id, peso_kg: Number(r.peso_kg), data: r.data,
        identificacao: an?.identificacao ?? null,
      }
    }))
  }, [companyId, propriedadeId])
  useEffect(() => { carregarRecentes() }, [carregarRecentes])

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
      await Promise.all([carregarAnimais(), carregarRecentes()])
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

      {/* PESAGEM-LOTE: importação por planilha (somada ao manual acima). Herda Data/Método/Lote/Piquete da tela. */}
      <ImportarPesagem
        companyId={companyId}
        propriedadeId={propriedadeId}
        dataTela={data}
        metodoTela={metodo}
        lotes={lotes}
        areas={areas}
        filtroLote={filtroLote}
        filtroArea={filtroArea}
        onImported={async () => { await carregarRecentes(); onDone() }}
      />

      <section className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="p-3 text-sm font-semibold border-b" style={{ color: ESP, borderColor: LINE }}>
          Pesagens recentes ({pesagensRecentes.length})
        </div>
        {pesagensRecentes.length === 0 ? (
          <div className="p-4 text-xs text-center" style={{ color: ESP60 }}>Nenhuma pesagem registrada ainda nesta propriedade.</div>
        ) : pesagensRecentes.map((p) => (
          <div key={p.id} className="flex items-center justify-between p-3 text-sm" style={{ borderTop: `1px solid ${LINE}` }}>
            <div>
              <span className="font-semibold" style={{ color: ESP }}>{p.identificacao || '(sem brinco)'}</span>
              <span className="text-xs ml-2" style={{ color: ESP60 }}>{p.data}</span>
            </div>
            <span className="font-semibold" style={{ color: GOLD }}>{p.peso_kg} kg</span>
          </div>
        ))}
      </section>
    </div>
  )
}

// ───────── Importar pesagem por planilha (PESAGEM-LOTE) ─────────
const METODOS_PESAGEM = ['balanca', 'visual', 'fita', 'estimado']
type NivelP = 'ok' | 'aviso' | 'erro'
interface LinhaPesagem {
  n: number
  brinco: string; peso: string; pesoNum: number | null; data: string; metodo: string; lote: string; piquete: string; observacao: string
  animalId: string | null
  nivel: NivelP
  msgs: string[]
}

// PESAGEM-MODELO: normaliza rótulo de cabeçalho (sem acento/caixa/'*'/espaços extras) p/ casar
// tanto o modelo PS novo ("Brinco *","Peso (kg) *","Método","Observação") quanto o cru antigo.
function normHeader(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\*/g, '').trim()
}
// Assinatura (brinco|peso) das 3 linhas de exemplo do modelo PS — p/ avisar se não foram apagadas.
const EXEMPLOS_MODELO = new Set(['645|412,5', '646|398,0', '002- t|455,2'])

// parseNumBR/parseDataBR vêm da fonte única @/lib/num (RD-52) — mesmos parsers do
// FIX-PESAGEM-VÍRGULA, agora compartilhados com a migração financeira.
// Faixa sã p/ peso bovino (kg) — fora disso vira erro no preview (provável vírgula perdida).
const PESO_MAX_KG = 2000
// Exibe o peso JÁ parseado, em pt-BR (432.9 → "432,9 kg") — o operador vê o que será gravado.
function fmtPesoBR(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 }) + ' kg'
}

function ImportarPesagem({
  companyId, propriedadeId, dataTela, metodoTela, lotes, areas, filtroLote, filtroArea, onImported,
}: {
  companyId: string; propriedadeId: string; dataTela: string; metodoTela: string
  lotes: Lote[]; areas: Area[]; filtroLote: string; filtroArea: string; onImported: () => void
}) {
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<LinhaPesagem[]>([])
  const [parseErro, setParseErro] = useState<string | null>(null)
  const [soValidas, setSoValidas] = useState(false)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<{ criadas: number; ignoradas: number; erros: { linha: number; brinco: string; motivo: string }[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const cont = useMemo(() => {
    let ok = 0, aviso = 0, erro = 0
    for (const l of linhas) { if (l.nivel === 'erro') erro++; else if (l.nivel === 'aviso') aviso++; else ok++ }
    return { ok, aviso, erro }
  }, [linhas])

  async function onArquivo(file: File) {
    setParseErro(null); setResultado(null); setLinhas([])
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const wsName = wb.SheetNames.find((n) => n.toLowerCase().startsWith('pesagem')) ?? wb.SheetNames[0]
      const matriz = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wsName], { header: 1, raw: false, defval: '' })
      // Cabeçalho tolerante (RD-53): casa tanto o modelo PS ("Brinco *","Peso (kg) *","Método"…)
      // quanto o cru antigo ("brinco","peso_kg"…). Detecta a linha por conter brinco + peso.
      const idxHeader = matriz.findIndex((row) => {
        const hs = row.map((c) => normHeader(String(c)))
        return hs.some((h) => h.includes('brinco')) && hs.some((h) => h.includes('peso'))
      })
      if (idxHeader < 0) { setParseErro('Não achei o cabeçalho (linha com "Brinco" e "Peso"). Use o modelo.'); return }
      const header = matriz[idxHeader].map((c) => normHeader(String(c)))
      const idxOf = (pred: (h: string) => boolean) => header.findIndex(pred)
      const ci = {
        brinco: idxOf((h) => h.includes('brinco')),
        peso: idxOf((h) => h.includes('peso')),
        data: idxOf((h) => h.includes('data')),
        metodo: idxOf((h) => h.includes('metodo')),
        lote: idxOf((h) => h.includes('lote')),
        piquete: idxOf((h) => h.includes('piquete')),
        observacao: idxOf((h) => h.includes('observ')),
      }

      // resolve brincos: TODOS os animais ativos da propriedade (multi-tenant por company+propriedade)
      const { data: ans } = await supabase.from('erp_pec_animal')
        .select('id, identificacao')
        .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo')
      const norm = (s: string) => (s ?? '').trim().toLowerCase()
      const mapBrinco = new Map<string, string>()
      for (const a of (ans ?? []) as Array<{ id: string; identificacao: string | null }>) {
        if (a.identificacao) mapBrinco.set(norm(a.identificacao), a.id)
      }
      const lotesCod = new Set(lotes.map((l) => norm(l.codigo)))
      const areasNome = new Set(areas.map((a) => norm(a.nome)))
      const loteTela = lotes.find((l) => l.id === filtroLote)?.codigo ?? ''
      const piqueteTela = areas.find((a) => a.id === filtroArea)?.nome ?? ''

      const parsed: LinhaPesagem[] = []
      for (let i = idxHeader + 1; i < matriz.length; i++) {
        const row = matriz[i]
        if (!row || row.every((c) => String(c ?? '').trim() === '')) continue
        const get = (j: number) => (j >= 0 ? String(row[j] ?? '').trim() : '')
        const brinco = get(ci.brinco)
        if (brinco.toUpperCase().startsWith('EX-')) continue

        // herança da tela quando a célula vem vazia
        const dataRaw = get(ci.data) || dataTela
        const metodo = (get(ci.metodo) || metodoTela).toLowerCase()
        const lote = get(ci.lote) || loteTela
        const piquete = get(ci.piquete) || piqueteTela
        const observacao = get(ci.observacao)
        const pesoRaw = get(ci.peso)

        // Pula a linha 2 (DICAS) do modelo PS: logo após o cabeçalho, o brinco é um texto descritivo
        // (longo / "Identificação…/Ex:/opcional"). Um brinco real é curto, então isto não pega dado válido.
        if (i === idxHeader + 1 && (brinco.length > 20 || /identifica|cadastro|ex:|vazio =|opcional/i.test(brinco))) continue

        const erros: string[] = []; const avisos: string[] = []
        let animalId: string | null = null

        if (!brinco) erros.push('Falta brinco')
        else { animalId = mapBrinco.get(norm(brinco)) ?? null; if (!animalId) erros.push(`Brinco "${brinco}" não encontrado`) }

        const pesoNum = parseNumBR(pesoRaw)
        if (pesoNum == null || pesoNum <= 0) erros.push('Peso inválido (numérico > 0)')
        else if (pesoNum > PESO_MAX_KG) erros.push(`Peso fora da faixa (${fmtPesoBR(pesoNum)}) — confira a vírgula`)

        if (!METODOS_PESAGEM.includes(metodo)) erros.push(`Método inválido (${metodo})`)

        const dataNorm = parseDataBR(dataRaw)
        if (!dataNorm) erros.push('Data inválida (use AAAA-MM-DD ou DD/MM/AAAA)')

        if (lote && !lotesCod.has(norm(lote))) avisos.push('Lote não encontrado (ignorado)')
        if (piquete && !areasNome.has(norm(piquete))) avisos.push('Piquete não encontrado (ignorado)')
        // Exemplos do modelo PS não apagados → avisa (não bloqueia — o operador decide).
        if (EXEMPLOS_MODELO.has(`${norm(brinco)}|${pesoRaw}`)) avisos.push('Linha de exemplo do modelo — confira/apague antes de importar')

        parsed.push({
          n: i + 1, brinco, peso: pesoRaw, pesoNum, data: dataNorm ?? dataRaw, metodo, lote, piquete, observacao,
          animalId, nivel: erros.length ? 'erro' : avisos.length ? 'aviso' : 'ok', msgs: [...erros, ...avisos],
        })
      }
      if (parsed.length === 0) { setParseErro('Nenhuma linha de dados (fora as de exemplo).'); return }

      // Aviso de duplicidade: já existe pesagem do mesmo animal+data? (não bloqueia — pesagem é evento)
      const validas = parsed.filter((l) => l.animalId && l.nivel !== 'erro')
      if (validas.length > 0) {
        const ids = Array.from(new Set(validas.map((l) => l.animalId!)))
        const datas = Array.from(new Set(validas.map((l) => l.data)))
        const { data: jaExiste } = await supabase.from('erp_pec_pesagem')
          .select('animal_id, data')
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId)
          .in('animal_id', ids).in('data', datas)
        const setDup = new Set(((jaExiste ?? []) as Array<{ animal_id: string; data: string }>).map((r) => `${r.animal_id}|${r.data}`))
        for (const l of parsed) {
          if (l.animalId && l.nivel !== 'erro' && setDup.has(`${l.animalId}|${l.data}`)) {
            if (l.nivel === 'ok') l.nivel = 'aviso'
            l.msgs.push('Já existe pesagem deste brinco nesta data')
          }
        }
      }

      setLinhas(parsed); setNomeArquivo(file.name)
    } catch (e) {
      setParseErro((e as Error)?.message ?? 'Falha ao ler o arquivo')
    }
  }

  async function importar() {
    const grava = linhas.filter((l) => l.nivel !== 'erro')
    if (grava.length === 0) return
    setImportando(true)
    let criadas = 0, ignoradas = 0
    const erros: { linha: number; brinco: string; motivo: string }[] = []
    for (const l of grava) {
      if (!l.animalId) { ignoradas++; erros.push({ linha: l.n, brinco: l.brinco, motivo: 'animal não resolvido' }); continue }
      const { error } = await supabase.rpc('fn_pec_pesagem_registrar', {
        p_company_id: companyId, p_propriedade_id: propriedadeId, p_animal_id: l.animalId,
        p_data: l.data, p_peso_kg: l.pesoNum, p_metodo: l.metodo,
        p_observacao: l.observacao || null, p_id: null,
      })
      if (error) { ignoradas++; erros.push({ linha: l.n, brinco: l.brinco, motivo: error.message }) }
      else criadas++
    }
    setImportando(false)
    setResultado({ criadas, ignoradas, erros })
    if (criadas > 0) onImported()
  }

  const podeImportar = linhas.length > 0 && !importando && (soValidas ? cont.ok + cont.aviso > 0 : cont.erro === 0)

  return (
    <section className="rounded-2xl p-4 space-y-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-sm font-semibold" style={{ color: ESP }}>Importar planilha</div>
      <div className="flex flex-wrap items-center gap-2">
        <a href="/modelos/MODELO_importacao_pesagem_PS.xlsx" download="MODELO_importacao_pesagem_PS.xlsx"
          className="rounded-xl px-3 py-2 text-sm font-semibold border inline-block" style={{ borderColor: GOLD, color: GOLD }}>
          Baixar modelo
        </a>
        <button type="button" onClick={() => inputRef.current?.click()}
          className="rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: ESP, color: '#fff' }}>
          {nomeArquivo ? 'Trocar arquivo' : 'Subir planilha'}
        </button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onArquivo(f); e.target.value = '' }} />
        {nomeArquivo && <span className="text-xs" style={{ color: ESP60 }}>{nomeArquivo} · {linhas.length} linha(s)</span>}
      </div>

      {parseErro && <div className="rounded-xl p-3 text-sm" style={{ background: '#FCEBEB', color: RED }}>{parseErro}</div>}

      {linhas.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2 text-xs" style={{ color: ESP60 }}>
            <span>🟢 {cont.ok} ok · 🟡 {cont.aviso} aviso(s) · 🔴 {cont.erro} erro(s)</span>
            {cont.erro > 0 && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={soValidas} onChange={(e) => setSoValidas(e.target.checked)} />
                Importar só as válidas ({cont.ok + cont.aviso})
              </label>
            )}
          </div>
          <div className="rounded-xl overflow-auto max-h-72" style={{ border: `1px solid ${LINE}` }}>
            <table className="w-full text-xs">
              <thead style={{ background: BG, color: ESP60 }}>
                <tr>
                  <th className="text-left px-2 py-1.5">#</th><th className="text-left px-2 py-1.5">st</th>
                  <th className="text-left px-2 py-1.5">brinco</th><th className="text-right px-2 py-1.5">peso</th>
                  <th className="text-left px-2 py-1.5">data</th><th className="text-left px-2 py-1.5">método</th>
                  <th className="text-left px-2 py-1.5">mensagens</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td className="px-2 py-1 opacity-50">{l.n}</td>
                    <td className="px-2 py-1">{l.nivel === 'erro' ? '🔴' : l.nivel === 'aviso' ? '🟡' : '🟢'}</td>
                    <td className="px-2 py-1 font-medium" style={{ color: ESP }}>{l.brinco}</td>
                    <td className="px-2 py-1 text-right tabular-nums" title={l.peso ? `planilha: ${l.peso}` : undefined}>{l.pesoNum != null ? fmtPesoBR(l.pesoNum) : (l.peso || '—')}</td>
                    <td className="px-2 py-1">{l.data}</td>
                    <td className="px-2 py-1">{l.metodo}</td>
                    <td className="px-2 py-1" style={{ color: ESP60 }}>{l.msgs.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => void importar()} disabled={!podeImportar}
            className="w-full rounded-xl py-3 text-sm font-semibold"
            style={{ background: GOLD, color: '#fff', opacity: podeImportar ? 1 : 0.5 }}>
            {importando ? 'Importando…' : 'Importar pesagens'}
          </button>
        </>
      )}

      {resultado && (
        <div className="rounded-xl p-3 text-sm" style={{ background: '#EAF5DC', color: ESP }}>
          <b>{resultado.criadas}</b> pesagem(ns) criada(s){resultado.ignoradas > 0 && <> · <b>{resultado.ignoradas}</b> ignorada(s)</>}
          {resultado.erros.length > 0 && (
            <ul className="mt-1 list-disc pl-5" style={{ color: RED }}>
              {resultado.erros.slice(0, 8).map((e, i) => <li key={i}>linha {e.linha} ({e.brinco}): {e.motivo}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
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
