'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada, usePropriedade, usePainelRebanho } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'
const GREEN = '#5C8D3F'
const YELLOW = '#C8941A'
const RED = '#C44536'

type Aba = 'painel' | 'animais' | 'lotes' | 'piquetes'

type Animal = {
  id: string
  identificacao: string | null
  categoria: string
  sexo: 'M' | 'F' | null
  raca: string | null
  peso_entrada_kg: number | null
  lote_id: string | null
  area_atual_id: string | null
  status: string
  origem: string
}
type Lote = { id: string; codigo: string; fase: string | null; modo: string; status: string }
type Piquete = { id: string; nome: string; area_ha: number | null; capacidade_ua: number | null }

const CATEGORIAS = ['matriz','touro','bezerro','bezerra','garrote','novilha','boi_magro','boi_gordo','descarte','outro'] as const

export default function RebanhoPage() {
  const { companyId } = useEmpresaSelecionada()
  const { propriedade, loading: loadingProp } = usePropriedade(companyId)
  const propriedadeId = propriedade?.id ?? null
  const [refresh, setRefresh] = useState(0)
  const [aba, setAba] = useState<Aba>('painel')

  const { data: painel, loading: loadingPainel } = usePainelRebanho(companyId, propriedadeId, refresh)

  const [animais, setAnimais] = useState<Animal[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [piquetes, setPiquetes] = useState<Piquete[]>([])
  const [contagemLote, setContagemLote] = useState<Record<string, number>>({})
  const [contagemArea, setContagemArea] = useState<Record<string, number>>({})

  const reloadDados = useCallback(async () => {
    if (!companyId || !propriedadeId) return
    const [a, l, p] = await Promise.all([
      supabase.from('erp_pec_animal')
        .select('id,identificacao,categoria,sexo,raca,peso_entrada_kg,lote_id,area_atual_id,status,origem')
        .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo')
        .order('identificacao', { nullsFirst: false }).limit(2000),
      supabase.from('erp_pec_lote')
        .select('id,codigo,fase,modo,status')
        .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('status', 'ativo').order('codigo'),
      supabase.from('erp_pec_area')
        .select('id,nome,area_ha,capacidade_ua')
        .eq('company_id', companyId).eq('propriedade_id', propriedadeId).eq('ativo', true).eq('tipo', 'piquete').order('nome'),
    ])
    const animList = (a.data ?? []) as Animal[]
    const loteList = (l.data ?? []) as Lote[]
    const piqList = (p.data ?? []) as Piquete[]
    setAnimais(animList)
    setLotes(loteList)
    setPiquetes(piqList)
    const cl: Record<string, number> = {}
    const ca: Record<string, number> = {}
    animList.forEach((an) => {
      if (an.lote_id) cl[an.lote_id] = (cl[an.lote_id] ?? 0) + 1
      if (an.area_atual_id) ca[an.area_atual_id] = (ca[an.area_atual_id] ?? 0) + 1
    })
    setContagemLote(cl)
    setContagemArea(ca)
  }, [companyId, propriedadeId])
  useEffect(() => { reloadDados() }, [reloadDados, refresh])

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60 }} className="p-6 text-sm min-h-screen">
      Selecione uma empresa específica para abrir a pecuária.
    </div>
  )
  if (loadingProp) return <div style={{ background: BG }} className="p-6 text-sm min-h-screen" />
  if (!propriedade) return (
    <div style={{ background: BG, color: ESP60 }} className="p-6 text-sm min-h-screen">
      Esta empresa ainda não tem propriedade cadastrada.
    </div>
  )

  return (
    <div style={{ background: BG, minHeight: '100%', color: ESP }} className="p-4 sm:p-6">
      <header className="max-w-6xl mx-auto mb-4">
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: GOLD }}>🐂 Pecuária · {propriedade.nome}</div>
        <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Rebanho &amp; Cadastro</h1>
      </header>

      <nav className="max-w-6xl mx-auto flex gap-1 mb-4 overflow-x-auto" style={{ borderBottom: `1px solid ${LINE}` }}>
        {(['painel','animais','lotes','piquetes'] as Aba[]).map((a) => (
          <button key={a} onClick={() => setAba(a)} className="px-4 py-2.5 text-sm whitespace-nowrap"
            style={{ color: aba === a ? GOLD : ESP60, fontWeight: aba === a ? 600 : 400,
              borderBottom: aba === a ? `2px solid ${GOLD}` : '2px solid transparent', marginBottom: -1 }}>
            {a === 'painel' ? 'Painel' : a === 'animais' ? 'Animais' : a === 'lotes' ? 'Lotes' : 'Piquetes'}
          </button>
        ))}
      </nav>

      <div className="max-w-6xl mx-auto">
        {aba === 'painel' && <Painel painel={painel} loading={loadingPainel} />}
        {aba === 'animais' && <Animais
          companyId={companyId} propriedadeId={propriedadeId!}
          animais={animais} lotes={lotes} piquetes={piquetes}
          onReload={() => setRefresh((r) => r + 1)} />}
        {aba === 'lotes' && <Lotes
          companyId={companyId} propriedadeId={propriedadeId!}
          lotes={lotes} contagem={contagemLote}
          onReload={() => setRefresh((r) => r + 1)} />}
        {aba === 'piquetes' && <Piquetes
          companyId={companyId} propriedadeId={propriedadeId!}
          piquetes={piquetes} contagem={contagemArea}
          onReload={() => setRefresh((r) => r + 1)} />}
      </div>
    </div>
  )
}

// ───────── Painel ─────────
function Painel({ painel, loading }: { painel: ReturnType<typeof usePainelRebanho>['data']; loading: boolean }) {
  if (loading) return <div className="text-sm" style={{ color: ESP60 }}>Carregando…</div>
  if (!painel) return null
  const maxQtd = painel.por_categoria.reduce((m, c) => Math.max(m, c.qtd), 1)
  const Card = ({ label, value }: { label: string; value: number | string }) => (
    <div className="rounded-2xl p-4 shadow-sm" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="text-3xl font-bold" style={{ color: ESP }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: ESP60 }}>{label}</div>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Cabeças ativas" value={painel.total_cabecas} />
        <Card label="Lotes ativos" value={painel.lotes_ativos} />
        <Card label="Piquetes / áreas" value={painel.areas} />
        <Card label="Propriedades" value={painel.propriedades} />
      </div>
      <section className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <div className="text-sm font-semibold mb-3" style={{ color: ESP }}>Composição por categoria</div>
        {painel.por_categoria.length === 0 ? (
          <div className="text-xs" style={{ color: ESP60 }}>Sem animais cadastrados ainda.</div>
        ) : (
          <div className="space-y-2">
            {painel.por_categoria.map((c) => (
              <div key={c.categoria} className="flex items-center gap-3">
                <span className="text-xs capitalize w-28 shrink-0" style={{ color: ESP }}>{c.categoria.replace('_', ' ')}</span>
                <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: BG }}>
                  <div style={{ width: `${(c.qtd / maxQtd) * 100}%`, background: GOLD, height: '100%' }} />
                </div>
                <span className="text-sm font-semibold w-12 text-right" style={{ color: ESP }}>{c.qtd}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ───────── Animais ─────────
function Animais({
  companyId, propriedadeId, animais, lotes, piquetes, onReload,
}: {
  companyId: string; propriedadeId: string
  animais: Animal[]; lotes: Lote[]; piquetes: Piquete[]
  onReload: () => void
}) {
  const [busca, setBusca] = useState('')
  const [fCat, setFCat] = useState('todos')
  const [fLote, setFLote] = useState('todos')
  const [fPiq, setFPiq] = useState('todos')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [acao, setAcao] = useState<null | { tipo: 'mover' | 'vender' | 'morte' | 'identificar' | 'novo'; alvos?: string[] }>(null)

  const nomeLote = (id: string | null) => lotes.find((l) => l.id === id)?.codigo ?? '—'
  const nomePiq = (id: string | null) => piquetes.find((p) => p.id === id)?.nome ?? '—'

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return animais.filter((a) => {
      if (fCat !== 'todos' && a.categoria !== fCat) return false
      if (fLote !== 'todos' && a.lote_id !== fLote) return false
      if (fPiq !== 'todos' && a.area_atual_id !== fPiq) return false
      if (q && !(a.identificacao ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [animais, busca, fCat, fLote, fPiq])

  const toggle = (id: string) => {
    const n = new Set(sel)
    if (n.has(id)) n.delete(id); else n.add(id)
    setSel(n)
  }
  const limparSel = () => setSel(new Set())

  const inp = 'rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input className={inp} placeholder="Buscar por brinco/identificação" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className={inp} value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="todos">Categoria · todas</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
        <select className={inp} value={fLote} onChange={(e) => setFLote(e.target.value)}>
          <option value="todos">Lote · todos</option>
          {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
        </select>
        <select className={inp} value={fPiq} onChange={(e) => setFPiq(e.target.value)}>
          <option value="todos">Piquete · todos</option>
          {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <span className="text-xs" style={{ color: ESP60 }}>{filtrados.length} de {animais.length}</span>
        <div className="flex-1" />
        <button onClick={() => setAcao({ tipo: 'novo' })} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>+ Novo animal</button>
      </div>

      {sel.size > 0 && (
        <div className="flex flex-wrap gap-2 items-center rounded-xl p-2" style={{ background: '#FFF7E0', border: `1px solid ${GOLD}` }}>
          <span className="text-xs font-semibold" style={{ color: ESP }}>{sel.size} selecionado(s)</span>
          <button onClick={() => setAcao({ tipo: 'mover', alvos: Array.from(sel) })} className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: ESP, color: '#fff' }}>Mover</button>
          <button onClick={() => setAcao({ tipo: 'vender', alvos: Array.from(sel) })} className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: GOLD, color: '#fff' }}>Vender</button>
          <button onClick={() => setAcao({ tipo: 'morte', alvos: Array.from(sel) })} className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: '#fff', border: `1px solid ${RED}`, color: RED }}>Morte</button>
          <button onClick={limparSel} className="text-xs px-3 py-1 rounded-lg" style={{ color: ESP60 }}>Limpar</button>
        </div>
      )}

      <div className="hidden md:block rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <table className="w-full text-sm">
          <thead className="text-xs" style={{ background: BG, color: ESP60 }}>
            <tr>
              <th className="p-2 text-center w-8"><input type="checkbox" checked={sel.size > 0 && sel.size === filtrados.length} onChange={(e) => setSel(e.target.checked ? new Set(filtrados.map((a) => a.id)) : new Set())} /></th>
              <th className="text-left p-2">Identificação</th>
              <th className="text-left p-2">Categoria</th>
              <th className="text-left p-2">Lote</th>
              <th className="text-left p-2">Piquete</th>
              <th className="text-right p-2">Peso entrada</th>
              <th className="p-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((a) => (
              <tr key={a.id} style={{ borderTop: `1px solid ${LINE}` }}>
                <td className="p-2 text-center"><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} /></td>
                <td className="p-2">{a.identificacao ?? <span style={{ color: ESP60 }}>— <button onClick={() => setAcao({ tipo: 'identificar', alvos: [a.id] })} title="Identificar" style={{ color: GOLD }}>📷</button></span>}</td>
                <td className="p-2"><span className="text-[11px] px-2 py-0.5 rounded-full capitalize" style={{ background: BG, color: ESP }}>{a.categoria.replace('_', ' ')}</span></td>
                <td className="p-2 text-xs">{nomeLote(a.lote_id)}</td>
                <td className="p-2 text-xs">{nomePiq(a.area_atual_id)}</td>
                <td className="p-2 text-right text-xs">{a.peso_entrada_kg ?? '—'}{a.peso_entrada_kg ? ' kg' : ''}</td>
                <td className="p-2">
                  <div className="flex gap-1 justify-center">
                    <button onClick={() => setAcao({ tipo: 'mover', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: BG, color: ESP }}>Mover</button>
                    <button onClick={() => setAcao({ tipo: 'vender', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: GOLD, color: '#fff' }}>Vender</button>
                    <button onClick={() => setAcao({ tipo: 'morte', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: '#fff', border: `1px solid ${RED}`, color: RED }}>Morte</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <div className="md:hidden space-y-2">
        {filtrados.map((a) => (
          <div key={a.id} className="rounded-2xl p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="font-semibold" style={{ color: ESP }}>
                  <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} className="mr-2" />
                  {a.identificacao ?? <span style={{ color: ESP60 }}>(sem brinco)</span>}
                </div>
                <div className="text-xs capitalize" style={{ color: ESP60 }}>
                  {a.categoria.replace('_', ' ')} · {a.sexo === 'M' ? 'macho' : 'fêmea'}
                </div>
                <div className="text-xs mt-1" style={{ color: ESP60 }}>
                  {nomeLote(a.lote_id)} · {nomePiq(a.area_atual_id)}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => setAcao({ tipo: 'mover', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: BG, color: ESP }}>Mover</button>
                <button onClick={() => setAcao({ tipo: 'vender', alvos: [a.id] })} className="text-[10px] px-2 py-1 rounded" style={{ background: GOLD, color: '#fff' }}>Vender</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {acao && <AcaoModal companyId={companyId} propriedadeId={propriedadeId} acao={acao}
        lotes={lotes} piquetes={piquetes} onClose={() => setAcao(null)}
        onDone={() => { setAcao(null); limparSel(); onReload() }} />}
    </div>
  )
}

// ───────── Modal de Ações ─────────
function AcaoModal({
  companyId, propriedadeId, acao, lotes, piquetes, onClose, onDone,
}: {
  companyId: string; propriedadeId: string
  acao: { tipo: 'mover' | 'vender' | 'morte' | 'identificar' | 'novo'; alvos?: string[] }
  lotes: Lote[]; piquetes: Piquete[]; onClose: () => void; onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // mover
  const [loteDestId, setLoteDestId] = useState('')
  const [areaDestId, setAreaDestId] = useState('')
  // vender
  const [valor, setValor] = useState('')
  const [contraparte, setContraparte] = useState('')
  const [peso, setPeso] = useState('')
  // morte
  const [obs, setObs] = useState('')
  // identificar
  const [identificacao, setIdentificacao] = useState('')
  // novo
  const [novo, setNovo] = useState({ categoria: 'bezerro', sexo: 'M', lote_id: '', area_atual_id: '', peso: '', identificacao: '' })

  const hoje = new Date().toISOString().slice(0, 10)

  const executar = async () => {
    setBusy(true); setErro(null)
    try {
      if (acao.tipo === 'novo') {
        const { error } = await supabase.rpc('fn_pec_animal_salvar', {
          p_company_id: companyId, p_propriedade_id: propriedadeId,
          p_categoria: novo.categoria, p_sexo: novo.sexo,
          p_lote_id: novo.lote_id || null, p_area_atual_id: novo.area_atual_id || null,
          p_peso_entrada_kg: novo.peso ? Number(novo.peso) : null,
          p_identificacao: novo.identificacao || null,
          p_origem: 'comprado',
        })
        if (error) throw error
        onDone(); return
      }
      const alvos = acao.alvos ?? []
      if (acao.tipo === 'identificar') {
        for (const id of alvos) {
          const { error } = await supabase.rpc('fn_pec_animal_salvar', {
            p_company_id: companyId, p_propriedade_id: propriedadeId,
            p_id: id, p_identificacao: identificacao,
          })
          if (error) throw error
        }
        onDone(); return
      }
      for (const id of alvos) {
        const params: Record<string, unknown> = {
          p_company_id: companyId, p_propriedade_id: propriedadeId,
          p_animal_id: id, p_data: hoje,
        }
        if (acao.tipo === 'mover') {
          params.p_tipo = 'transferencia'
          params.p_lote_destino_id = loteDestId || null
          params.p_area_destino_id = areaDestId || null
        } else if (acao.tipo === 'vender') {
          params.p_tipo = 'venda'
          params.p_valor = valor ? Number(valor) : null
          params.p_contraparte_nome = contraparte || null
          params.p_peso_kg = peso ? Number(peso) : null
        } else if (acao.tipo === 'morte') {
          params.p_tipo = 'morte'
          params.p_observacao = obs || null
        }
        const { error } = await supabase.rpc('fn_pec_movimentacao_registrar', params)
        if (error) throw error
      }
      onDone()
    } catch (e) {
      setErro((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const titulo: Record<string, string> = {
    mover: 'Mover animal(is)', vender: 'Vender animal(is)', morte: 'Registrar morte',
    identificar: 'Identificar animal', novo: 'Novo animal',
  }
  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'

  return (
    <div onClick={onClose} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(61,35,20,0.45)', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-md" style={{ background: '#fff' }}>
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: GOLD, fontWeight: 600 }}>Ação</div>
        <h3 className="text-lg font-semibold mb-3" style={{ color: ESP, fontFamily: 'ui-serif,Georgia,serif' }}>{titulo[acao.tipo]}</h3>
        {(acao.alvos?.length ?? 0) > 0 && (
          <div className="text-xs mb-3" style={{ color: ESP60 }}>{acao.alvos!.length} animal(is) selecionado(s)</div>
        )}

        <div className="space-y-2">
          {acao.tipo === 'mover' && (<>
            <select className={inp} value={loteDestId} onChange={(e) => setLoteDestId(e.target.value)}>
              <option value="">Lote destino — manter</option>
              {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
            </select>
            <select className={inp} value={areaDestId} onChange={(e) => setAreaDestId(e.target.value)}>
              <option value="">Piquete destino — manter</option>
              {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </>)}
          {acao.tipo === 'vender' && (<>
            <input className={inp} placeholder="Comprador" value={contraparte} onChange={(e) => setContraparte(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} type="number" inputMode="decimal" placeholder="Valor (R$)" value={valor} onChange={(e) => setValor(e.target.value)} />
              <input className={inp} type="number" inputMode="decimal" placeholder="Peso (kg)" value={peso} onChange={(e) => setPeso(e.target.value)} />
            </div>
          </>)}
          {acao.tipo === 'morte' && (
            <textarea className={inp} placeholder="Observação (causa, etc)" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
          )}
          {acao.tipo === 'identificar' && (
            <input className={inp} placeholder="Identificação / brinco" value={identificacao} onChange={(e) => setIdentificacao(e.target.value)} />
          )}
          {acao.tipo === 'novo' && (<>
            <input className={inp} placeholder="Identificação / brinco (opcional)" value={novo.identificacao} onChange={(e) => setNovo({ ...novo, identificacao: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={novo.categoria} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
              <select className={inp} value={novo.sexo} onChange={(e) => setNovo({ ...novo, sexo: e.target.value })}>
                <option value="M">Macho</option><option value="F">Fêmea</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={novo.lote_id} onChange={(e) => setNovo({ ...novo, lote_id: e.target.value })}>
                <option value="">Lote — opcional</option>
                {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
              </select>
              <select className={inp} value={novo.area_atual_id} onChange={(e) => setNovo({ ...novo, area_atual_id: e.target.value })}>
                <option value="">Piquete — opcional</option>
                {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <input className={inp} type="number" inputMode="decimal" placeholder="Peso de entrada (kg)" value={novo.peso} onChange={(e) => setNovo({ ...novo, peso: e.target.value })} />
          </>)}
        </div>

        {erro && (
          <div className="mt-2 text-xs rounded-lg p-2" style={{ background: '#FCEBEB', color: RED }}>{erro}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>Cancelar</button>
          <button onClick={executar} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────── Lotes ─────────
function Lotes({
  companyId, propriedadeId, lotes, contagem, onReload,
}: {
  companyId: string; propriedadeId: string; lotes: Lote[]; contagem: Record<string, number>; onReload: () => void
}) {
  const [novo, setNovo] = useState<{ codigo: string; modo: string; fase: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const salvar = async () => {
    if (!novo?.codigo) return
    setBusy(true)
    await supabase.rpc('fn_pec_lote_salvar', {
      p_company_id: companyId, p_propriedade_id: propriedadeId,
      p_codigo: novo.codigo, p_modo: novo.modo, p_fase: novo.fase || null,
    })
    setBusy(false); setNovo(null); onReload()
  }
  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm font-semibold" style={{ color: ESP }}>{lotes.length} lote(s) ativo(s)</span>
        <button onClick={() => setNovo({ codigo: '', modo: 'pasto', fase: '' })} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>+ Novo lote</button>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        {lotes.length === 0 && <div className="p-6 text-center text-sm" style={{ color: ESP60 }}>Sem lotes.</div>}
        {lotes.map((l, i) => (
          <div key={l.id} className="flex items-center justify-between p-3" style={{ borderTop: i ? `1px solid ${LINE}` : 'none' }}>
            <div>
              <div className="font-semibold" style={{ color: ESP }}>{l.codigo}</div>
              <div className="text-xs capitalize" style={{ color: ESP60 }}>{l.modo}{l.fase ? ` · ${l.fase}` : ''}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: GOLD }}>{contagem[l.id] ?? 0}</div>
              <div className="text-[10px]" style={{ color: ESP60 }}>cabeças</div>
            </div>
          </div>
        ))}
      </div>

      {novo && (
        <div onClick={() => setNovo(null)} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(61,35,20,0.45)', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-sm" style={{ background: '#fff' }}>
            <h3 className="text-lg font-semibold mb-3" style={{ color: ESP, fontFamily: 'ui-serif,Georgia,serif' }}>Novo lote</h3>
            <div className="space-y-2">
              <input className={inp} placeholder="Código (ex.: Lote A)" value={novo.codigo} onChange={(e) => setNovo({ ...novo, codigo: e.target.value })} />
              <select className={inp} value={novo.modo} onChange={(e) => setNovo({ ...novo, modo: e.target.value })}>
                <option value="pasto">Pasto</option>
                <option value="semiconfinamento">Semiconfinamento</option>
                <option value="confinamento">Confinamento</option>
              </select>
              <select className={inp} value={novo.fase} onChange={(e) => setNovo({ ...novo, fase: e.target.value })}>
                <option value="">Fase — opcional</option>
                <option value="cria">Cria</option><option value="recria">Recria</option>
                <option value="engorda">Engorda</option><option value="terminacao">Terminação</option>
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNovo(null)} className="px-4 py-2 rounded-xl text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>Cancelar</button>
              <button onClick={salvar} disabled={busy || !novo.codigo} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ───────── Piquetes ─────────
function Piquetes({
  companyId, propriedadeId, piquetes, contagem, onReload,
}: {
  companyId: string; propriedadeId: string; piquetes: Piquete[]; contagem: Record<string, number>; onReload: () => void
}) {
  const [novo, setNovo] = useState<{ nome: string; area_ha: string; capacidade_ua: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const salvar = async () => {
    if (!novo?.nome) return
    setBusy(true)
    await supabase.rpc('fn_pec_area_salvar', {
      p_company_id: companyId, p_propriedade_id: propriedadeId,
      p_nome: novo.nome, p_tipo: 'piquete',
      p_area_ha: novo.area_ha ? Number(novo.area_ha) : null,
      p_capacidade_ua: novo.capacidade_ua ? Number(novo.capacidade_ua) : null,
    })
    setBusy(false); setNovo(null); onReload()
  }
  const ocupacaoCor = (cab: number, cap: number | null) => {
    if (!cap || cap <= 0) return ESP60
    const r = cab / cap
    if (r >= 1) return RED
    if (r >= 0.8) return YELLOW
    return GREEN
  }
  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm font-semibold" style={{ color: ESP }}>{piquetes.length} piquete(s)</span>
        <button onClick={() => setNovo({ nome: '', area_ha: '', capacidade_ua: '' })} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>+ Novo piquete</button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {piquetes.map((p) => {
          const cab = contagem[p.id] ?? 0
          const cor = ocupacaoCor(cab, p.capacidade_ua)
          return (
            <div key={p.id} className="rounded-2xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
              <div className="font-semibold" style={{ color: ESP }}>{p.nome}</div>
              <div className="text-xs mt-1" style={{ color: ESP60 }}>
                {p.area_ha ? `${p.area_ha} ha` : 'sem área'}{p.capacidade_ua ? ` · ${p.capacidade_ua} UA` : ''}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-lg font-bold" style={{ color: cor }}>{cab}</span>
                <span className="text-xs" style={{ color: ESP60 }}>cabeças{p.capacidade_ua ? ` / ${p.capacidade_ua}` : ''}</span>
              </div>
              {p.capacidade_ua && p.capacidade_ua > 0 && (
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: BG }}>
                  <div style={{ width: `${Math.min(100, (cab / p.capacidade_ua) * 100)}%`, background: cor, height: '100%' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {novo && (
        <div onClick={() => setNovo(null)} className="fixed inset-0 flex items-center justify-center p-4" style={{ background: 'rgba(61,35,20,0.45)', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-2xl p-5 w-full max-w-sm" style={{ background: '#fff' }}>
            <h3 className="text-lg font-semibold mb-3" style={{ color: ESP, fontFamily: 'ui-serif,Georgia,serif' }}>Novo piquete</h3>
            <div className="space-y-2">
              <input className={inp} placeholder="Nome (ex.: Piquete 1)" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className={inp} type="number" inputMode="decimal" placeholder="Área (ha)" value={novo.area_ha} onChange={(e) => setNovo({ ...novo, area_ha: e.target.value })} />
                <input className={inp} type="number" inputMode="decimal" placeholder="Capacidade UA" value={novo.capacidade_ua} onChange={(e) => setNovo({ ...novo, capacidade_ua: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNovo(null)} className="px-4 py-2 rounded-xl text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>Cancelar</button>
              <button onClick={salvar} disabled={busy || !novo.nome} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
