'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Plus, Trash2, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useEmpresaSelecionada, usePropriedade } from '@/lib/agro/usePecuaria'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.6)'
const GREEN = '#5C8D3F'
const RED = '#C44536'

type Area = { id: string; nome: string; tipo: string }
type Lote = { id: string; codigo: string; fase: string | null; modo: string }
type Modo = 'folha' | 'avulso' | 'lote'
type LinhaLote = { identificacao: string; sisbov: string; peso: string }
const LINHA_LOTE_VAZIA: LinhaLote = { identificacao: '', sisbov: '', peso: '' }

const CATEGORIAS = [
  { v: 'matriz', l: 'Matriz', sexoDefault: 'F' },
  { v: 'touro', l: 'Touro', sexoDefault: 'M' },
  { v: 'bezerro', l: 'Bezerro', sexoDefault: 'M' },
  { v: 'bezerra', l: 'Bezerra', sexoDefault: 'F' },
  { v: 'garrote', l: 'Garrote', sexoDefault: 'M' },
  { v: 'novilha', l: 'Novilha', sexoDefault: 'F' },
  { v: 'boi_magro', l: 'Boi magro', sexoDefault: 'M' },
  { v: 'boi_gordo', l: 'Boi gordo', sexoDefault: 'M' },
  { v: 'descarte', l: 'Descarte', sexoDefault: 'F' },
  { v: 'outro', l: 'Outro', sexoDefault: 'F' },
] as const

const RACAS_SUGESTAO = ['Nelore', 'Angus', 'Red Angus', 'Cruzada', 'Brangus', 'Senepol']

const sexoDefaultDeCategoria = (cat: string): 'M' | 'F' =>
  (CATEGORIAS.find((c) => c.v === cat)?.sexoDefault as 'M' | 'F') ?? 'F'

type Cabecalho = {
  area_atual_id: string
  lote_id: string
  categoria: string
  origem: 'nascido' | 'comprado'
  data_entrada: string
  contraparte_nome: string
}
type Linha = {
  identificacao: string
  ano_nasc: string
  raca: string
  estado: '' | 'prenha' | 'vazia'
  observacao: string
  sexo: 'M' | 'F'
}

const LINHA_VAZIA: Linha = { identificacao: '', ano_nasc: '', raca: '', estado: '', observacao: '', sexo: 'F' }

export default function CadastrarRebanho() {
  const router = useRouter()
  const { companyId } = useEmpresaSelecionada()
  const { propriedade, loading: loadingProp } = usePropriedade(companyId)
  const propriedadeId = propriedade?.id ?? null

  const [modo, setModo] = useState<Modo>('folha')
  const [areas, setAreas] = useState<Area[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [loadingSel, setLoadingSel] = useState(true)

  const hoje = new Date().toISOString().slice(0, 10)
  const [cab, setCab] = useState<Cabecalho>({
    area_atual_id: '',
    lote_id: '',
    categoria: 'matriz',
    origem: 'nascido',
    data_entrada: hoje,
    contraparte_nome: '',
  })
  const [linha, setLinha] = useState<Linha>({ ...LINHA_VAZIA, sexo: sexoDefaultDeCategoria('matriz') })
  const [linhas, setLinhas] = useState<Linha[]>([])
  // modo LOTE (cadastro em massa): quantidade + identificação individual OU coletiva + peso
  const [loteQtd, setLoteQtd] = useState('')
  const [loteSexo, setLoteSexo] = useState<'M' | 'F'>('M')
  const [loteRaca, setLoteRaca] = useState('')
  const [identificarInd, setIdentificarInd] = useState(false)
  const [pesoModo, setPesoModo] = useState<'medio' | 'total'>('medio')
  const [pesoLote, setPesoLote] = useState('')
  const [gridLote, setGridLote] = useState<LinhaLote[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const idRef = useRef<HTMLInputElement>(null)
  const anoRef = useRef<HTMLInputElement>(null)

  // Quando categoria muda, ajusta sexo default da linha em construção
  useEffect(() => {
    setLinha((l) => ({ ...l, sexo: sexoDefaultDeCategoria(cab.categoria) }))
  }, [cab.categoria])

  // Carrega áreas + lotes
  useEffect(() => {
    if (!companyId || !propriedadeId) return
    let alive = true
    setLoadingSel(true)
    ;(async () => {
      const [a, l] = await Promise.all([
        supabase.from('erp_pec_area').select('id, nome, tipo')
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId)
          .eq('ativo', true).order('nome'),
        supabase.from('erp_pec_lote').select('id, codigo, fase, modo')
          .eq('company_id', companyId).eq('propriedade_id', propriedadeId)
          .eq('status', 'ativo').order('codigo'),
      ])
      if (!alive) return
      setAreas((a.data as Area[]) ?? [])
      setLotes((l.data as Lote[]) ?? [])
      setLoadingSel(false)
    })()
    return () => { alive = false }
  }, [companyId, propriedadeId])

  const adicionarLinha = () => {
    setLinhas((arr) => [...arr, linha])
    setLinha({ ...LINHA_VAZIA, sexo: sexoDefaultDeCategoria(cab.categoria) })
    idRef.current?.focus()
  }
  const removerLinha = (ix: number) => setLinhas((arr) => arr.filter((_, i) => i !== ix))

  // grade individual do lote: cresce/encolhe com a quantidade (preserva o que já foi digitado)
  const loteQtdNum = Math.max(0, Math.min(5000, parseInt(loteQtd || '0', 10) || 0))
  useEffect(() => {
    if (!identificarInd) return
    setGridLote((g) => {
      if (g.length === loteQtdNum) return g
      if (g.length < loteQtdNum) return [...g, ...Array.from({ length: loteQtdNum - g.length }, () => ({ ...LINHA_LOTE_VAZIA }))]
      return g.slice(0, loteQtdNum)
    })
  }, [loteQtdNum, identificarInd])
  const setGridCampo = (ix: number, campo: keyof LinhaLote, v: string) =>
    setGridLote((g) => g.map((r, i) => (i === ix ? { ...r, [campo]: v } : r)))

  const cabecalhoValido = useMemo(
    () => !!(cab.area_atual_id && cab.categoria && cab.origem && cab.data_entrada),
    [cab],
  )
  const podeSalvarFolha = cabecalhoValido && linhas.length > 0
  const podeSalvarAvulso = cabecalhoValido

  const montarObservacao = (l: Linha): string | null => {
    const partes: string[] = []
    if (l.estado === 'prenha') partes.push('Prenha')
    else if (l.estado === 'vazia') partes.push('Vazia')
    if (l.observacao.trim()) partes.push(l.observacao.trim())
    return partes.length ? partes.join('; ') : null
  }
  const anoParaData = (ano: string): string | null => {
    const a = Number(ano)
    if (!a || a < 1900 || a > 2100) return null
    return `${a}-01-01`
  }

  const salvar = async () => {
    if (!companyId || !propriedadeId) return
    setBusy(true); setMsg(null)
    try {
      const itens: Linha[] = modo === 'folha' ? linhas : [linha]
      let criados = 0
      const erros: string[] = []
      for (const it of itens) {
        const { error } = await supabase.rpc('fn_pec_animal_salvar', {
          p_company_id: companyId,
          p_propriedade_id: propriedadeId,
          p_identificacao: it.identificacao.trim() || null,
          p_sexo: it.sexo,
          p_categoria: cab.categoria,
          p_raca: it.raca.trim() || null,
          p_data_nascimento: anoParaData(it.ano_nasc),
          p_origem: cab.origem,
          p_data_entrada: cab.data_entrada,
          p_peso_entrada_kg: null,
          p_lote_id: cab.lote_id || null,
          p_area_atual_id: cab.area_atual_id || null,
          p_sisbov: null,
          p_mae_id: null,
          p_contraparte_nome: cab.origem === 'comprado' ? (cab.contraparte_nome.trim() || null) : null,
          p_observacao: montarObservacao(it),
          p_id: null,
        })
        if (error) erros.push(`${it.identificacao || 'sem id'}: ${error.message}`)
        else criados++
      }
      if (criados > 0) {
        setMsg({ tipo: 'ok', texto: `CRIOU ${criados} registro${criados === 1 ? '' : 's'}${erros.length ? ` · ${erros.length} com erro` : ''}` })
        if (modo === 'folha') setLinhas([])
        else setLinha({ ...LINHA_VAZIA, sexo: sexoDefaultDeCategoria(cab.categoria) })
      } else {
        setMsg({ tipo: 'erro', texto: erros[0] ?? 'Nenhum registro criado.' })
      }
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const podeSalvarLote = cabecalhoValido && loteQtdNum >= 1
  const salvarLote = async () => {
    if (!companyId || !propriedadeId) return
    setBusy(true); setMsg(null)
    try {
      // peso do lote: coletivo → médio (se veio total, divide pela qtd); individual → cada linha
      let pesoMedio: number | null = null
      if (!identificarInd) {
        const p = Number((pesoLote || '').replace(',', '.'))
        if (p > 0) pesoMedio = pesoModo === 'total' ? Number((p / loteQtdNum).toFixed(2)) : p
      }
      const animais = identificarInd
        ? gridLote.map((r) => ({ identificacao: r.identificacao.trim() || null, sisbov: r.sisbov.trim() || null, peso_kg: r.peso.trim() === '' ? null : Number(r.peso.replace(',', '.')) }))
        : []
      const { data, error } = await supabase.rpc('fn_pec_animal_cadastrar_lote', {
        p_company_id: companyId, p_propriedade_id: propriedadeId, p_quantidade: loteQtdNum,
        p_categoria: cab.categoria, p_sexo: loteSexo, p_raca: loteRaca.trim() || null, p_origem: cab.origem,
        p_data_entrada: cab.data_entrada, p_lote_id: cab.lote_id || null, p_area_atual_id: cab.area_atual_id || null,
        p_contraparte_nome: cab.origem === 'comprado' ? (cab.contraparte_nome.trim() || null) : null,
        p_modo_identificacao: identificarInd ? 'individual' : 'coletivo',
        p_animais: animais, p_peso_medio_kg: pesoMedio, p_observacao: null,
      })
      const r = data as { ok?: boolean; erro?: string; criados?: number } | null
      if (error || !r?.ok) { setMsg({ tipo: 'erro', texto: error?.message || r?.erro || 'Falha ao cadastrar o lote' }); return }
      const loteCodigo = lotes.find((l) => l.id === cab.lote_id)?.codigo
      setMsg({ tipo: 'ok', texto: `${r.criados} animais cadastrados${loteCodigo ? ` no lote ${loteCodigo}` : ''}.` })
      setLoteQtd(''); setPesoLote(''); setGridLote([]); setLoteRaca('')
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60, minHeight: '100%' }} className="p-6 text-sm">
      Selecione uma empresa específica para cadastrar rebanho.
    </div>
  )
  if (loadingProp) return <div style={{ background: BG }} className="p-6" />
  if (!propriedade) return (
    <div style={{ background: BG, color: ESP60, minHeight: '100%' }} className="p-6 text-sm">
      Esta empresa não tem propriedade cadastrada.
    </div>
  )

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white px-3 py-2 text-sm text-[#3D2314]'
  const lbl = 'block text-[11px] uppercase tracking-wider mb-1 font-semibold'

  return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6">
      <header className="max-w-3xl mx-auto mb-4">
        <Link href="/dashboard/agro/rebanho" className="inline-flex items-center gap-1 text-sm mb-2" style={{ color: ESP60 }}>
          <ChevronLeft size={16} /> Voltar ao rebanho
        </Link>
        <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: GOLD }}>🐂 Cadastro · {propriedade.nome}</div>
        <h1 className="text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Lançar rebanho</h1>
        <p className="text-sm mt-1" style={{ color: ESP60 }}>
          Espelha a folha de campo: preenche o cabeçalho uma vez, lança as linhas rápido.
        </p>
      </header>

      <div className="max-w-3xl mx-auto">
        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={() => setModo('lote')} className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{ background: modo === 'lote' ? ESP : '#fff', color: modo === 'lote' ? '#fff' : ESP, border: `1px solid ${modo === 'lote' ? ESP : LINE}`, minWidth: 140 }}>
            ⚖️ Cadastrar em lote
          </button>
          <button onClick={() => setModo('folha')} className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{ background: modo === 'folha' ? ESP : '#fff', color: modo === 'folha' ? '#fff' : ESP, border: `1px solid ${modo === 'folha' ? ESP : LINE}`, minWidth: 140 }}>
            📋 Lançar folha
          </button>
          <button onClick={() => setModo('avulso')} className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{ background: modo === 'avulso' ? ESP : '#fff', color: modo === 'avulso' ? '#fff' : ESP, border: `1px solid ${modo === 'avulso' ? ESP : LINE}`, minWidth: 140 }}>
            🐮 Animal avulso
          </button>
        </div>

        <section className="rounded-2xl p-4 mb-4 space-y-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <div className="text-sm font-semibold mb-1" style={{ color: ESP }}>Cabeçalho do manejo</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Piquete / Área *</label>
              <select className={inp} value={cab.area_atual_id} onChange={(e) => setCab({ ...cab, area_atual_id: e.target.value })} disabled={loadingSel}>
                <option value="">— selecione —</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.nome} · {a.tipo.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Lote (opcional)</label>
              <select className={inp} value={cab.lote_id} onChange={(e) => setCab({ ...cab, lote_id: e.target.value })} disabled={loadingSel}>
                <option value="">— sem lote —</option>
                {lotes.map((l) => <option key={l.id} value={l.id}>{l.codigo}{l.fase ? ` · ${l.fase}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Categoria *</label>
              <select className={inp} value={cab.categoria} onChange={(e) => setCab({ ...cab, categoria: e.target.value })}>
                {CATEGORIAS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Origem *</label>
              <select className={inp} value={cab.origem} onChange={(e) => setCab({ ...cab, origem: e.target.value as 'nascido' | 'comprado' })}>
                <option value="nascido">Nascido</option>
                <option value="comprado">Comprado</option>
              </select>
            </div>
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Data de entrada *</label>
              <input type="date" className={inp} value={cab.data_entrada} onChange={(e) => setCab({ ...cab, data_entrada: e.target.value })} />
            </div>
            {cab.origem === 'comprado' && (
              <div>
                <label className={lbl} style={{ color: ESP60 }}>Fornecedor</label>
                <input className={inp} placeholder="Nome do vendedor" value={cab.contraparte_nome} onChange={(e) => setCab({ ...cab, contraparte_nome: e.target.value })} />
              </div>
            )}
          </div>
        </section>

        {modo === 'lote' && (
          <section className="rounded-2xl p-4 mb-4 space-y-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div className="text-sm font-semibold" style={{ color: ESP }}>Lote de animais</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={lbl} style={{ color: ESP60 }}>Quantidade *</label>
                <input className={inp} inputMode="numeric" placeholder="ex.: 50" value={loteQtd}
                  onChange={(e) => setLoteQtd(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div>
                <label className={lbl} style={{ color: ESP60 }}>Sexo</label>
                <select className={inp} value={loteSexo} onChange={(e) => setLoteSexo(e.target.value as 'M' | 'F')}>
                  <option value="M">Macho</option>
                  <option value="F">Fêmea</option>
                </select>
              </div>
              <div>
                <label className={lbl} style={{ color: ESP60 }}>Raça</label>
                <input className={inp} list="racas-sug-lote" placeholder="ex.: Nelore" value={loteRaca} onChange={(e) => setLoteRaca(e.target.value)} />
                <datalist id="racas-sug-lote">{RACAS_SUGESTAO.map((r) => <option key={r} value={r} />)}</datalist>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm mt-1" style={{ color: ESP }}>
              <input type="checkbox" checked={identificarInd} onChange={(e) => setIdentificarInd(e.target.checked)} />
              Identificar individualmente? <span style={{ color: ESP60 }}>(brinco/sisbov e peso de cada um)</span>
            </label>

            {!identificarInd ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl} style={{ color: ESP60 }}>Peso do lote (kg)</label>
                  <input className={inp} inputMode="decimal" placeholder="opcional" value={pesoLote}
                    onChange={(e) => setPesoLote(e.target.value.replace(/[^\d.,]/g, ''))} />
                </div>
                <div>
                  <label className={lbl} style={{ color: ESP60 }}>Esse peso é…</label>
                  <select className={inp} value={pesoModo} onChange={(e) => setPesoModo(e.target.value as 'medio' | 'total')}>
                    <option value="medio">Médio (por animal)</option>
                    <option value="total">Total (o sistema divide)</option>
                  </select>
                  {pesoModo === 'total' && loteQtdNum > 0 && Number((pesoLote || '').replace(',', '.')) > 0 && (
                    <div className="text-[11px] mt-1" style={{ color: ESP60 }}>
                      ≈ {(Number(pesoLote.replace(',', '.')) / loteQtdNum).toFixed(1)} kg por animal
                    </div>
                  )}
                </div>
              </div>
            ) : loteQtdNum > 0 ? (
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                <div className="grid grid-cols-[auto_1fr_1fr_88px] gap-2 px-3 py-2 text-[11px] font-semibold" style={{ color: ESP60, background: '#FAF7F2' }}>
                  <span>#</span><span>Brinco/ID</span><span>SISBOV</span><span>Peso kg</span>
                </div>
                <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                  {gridLote.map((r, ix) => (
                    <div key={ix} className="grid grid-cols-[auto_1fr_1fr_88px] gap-2 px-3 py-1.5 items-center" style={{ borderTop: `1px solid ${LINE}` }}>
                      <span className="text-xs" style={{ color: ESP60 }}>{ix + 1}</span>
                      <input className="rounded-lg border border-[#E7DECF] bg-white px-2 py-1 text-sm" placeholder="opcional"
                        value={r.identificacao} onChange={(e) => setGridCampo(ix, 'identificacao', e.target.value)} />
                      <input className="rounded-lg border border-[#E7DECF] bg-white px-2 py-1 text-sm" placeholder="opcional"
                        value={r.sisbov} onChange={(e) => setGridCampo(ix, 'sisbov', e.target.value)} />
                      <input className="rounded-lg border border-[#E7DECF] bg-white px-2 py-1 text-sm" inputMode="decimal" placeholder="kg"
                        value={r.peso} onChange={(e) => setGridCampo(ix, 'peso', e.target.value.replace(/[^\d.,]/g, ''))} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm" style={{ color: ESP60 }}>Informe a quantidade para abrir a lista de identificação.</div>
            )}
            <div className="text-[11px]" style={{ color: ESP60 }}>Preencha só os que têm brinco — os demais entram sem identificação. É tudo-ou-nada: se der erro, nenhum é criado.</div>
          </section>
        )}

        {modo !== 'lote' && (<>
        <section className="rounded-2xl p-4 mb-4 space-y-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          <div className="text-sm font-semibold" style={{ color: ESP }}>
            {modo === 'folha' ? `Linha (${linhas.length} adicionada${linhas.length === 1 ? '' : 's'})` : 'Animal'}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Nº ID (opcional)</label>
              <input
                ref={idRef}
                className={inp}
                inputMode="text"
                placeholder="brinco / marca"
                value={linha.identificacao}
                onChange={(e) => setLinha({ ...linha, identificacao: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); anoRef.current?.focus() }
                }}
              />
            </div>
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Ano nasc.</label>
              <input
                ref={anoRef}
                className={inp}
                inputMode="numeric"
                placeholder="AAAA"
                maxLength={4}
                value={linha.ano_nasc}
                onChange={(e) => setLinha({ ...linha, ano_nasc: e.target.value.replace(/\D/g, '') })}
              />
            </div>
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Raça</label>
              <input className={inp} list="racas-sug" placeholder="ex.: Nelore" value={linha.raca} onChange={(e) => setLinha({ ...linha, raca: e.target.value })} />
              <datalist id="racas-sug">
                {RACAS_SUGESTAO.map((r) => <option key={r} value={r} />)}
              </datalist>
            </div>
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Estado</label>
              <select className={inp} value={linha.estado} onChange={(e) => setLinha({ ...linha, estado: e.target.value as Linha['estado'] })}>
                <option value="">—</option>
                <option value="prenha">Prenha</option>
                <option value="vazia">Vazia</option>
              </select>
            </div>
            <div>
              <label className={lbl} style={{ color: ESP60 }}>Sexo</label>
              <select className={inp} value={linha.sexo} onChange={(e) => setLinha({ ...linha, sexo: e.target.value as 'M' | 'F' })}>
                <option value="F">Fêmea</option>
                <option value="M">Macho</option>
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className={lbl} style={{ color: ESP60 }}>Obs.</label>
              <input className={inp} value={linha.observacao} onChange={(e) => setLinha({ ...linha, observacao: e.target.value })} />
            </div>
          </div>

          {modo === 'folha' && (
            <button
              onClick={adicionarLinha}
              disabled={!cabecalhoValido}
              className="w-full mt-2 rounded-xl py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2"
              style={{ background: GOLD, color: '#fff', opacity: cabecalhoValido ? 1 : 0.6 }}
            >
              <Plus size={15} /> Adicionar linha
            </button>
          )}
        </section>

        {modo === 'folha' && linhas.length > 0 && (
          <section className="rounded-2xl overflow-hidden mb-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div className="p-3 text-sm font-semibold" style={{ color: ESP, borderBottom: `1px solid ${LINE}` }}>
              {linhas.length} linha{linhas.length === 1 ? '' : 's'} pronta{linhas.length === 1 ? '' : 's'} para salvar
            </div>
            {linhas.map((l, ix) => (
              <div key={ix} className="flex items-center justify-between p-3 text-sm" style={{ borderTop: ix ? `1px solid ${LINE}` : 'none' }}>
                <div>
                  <div className="font-semibold" style={{ color: ESP }}>
                    {l.identificacao || '(sem brinco)'} · {l.sexo === 'M' ? 'macho' : 'fêmea'}
                  </div>
                  <div className="text-xs" style={{ color: ESP60 }}>
                    {l.ano_nasc || '—'} · {l.raca || '—'}{l.estado ? ` · ${l.estado}` : ''}{l.observacao ? ` · ${l.observacao}` : ''}
                  </div>
                </div>
                <button onClick={() => removerLinha(ix)} style={{ color: RED }} title="Remover linha">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </section>
        )}
        </>)}

        {msg && (
          <div className="mb-3 rounded-xl p-3 text-sm" style={{
            background: msg.tipo === 'ok' ? '#EAF5DC' : '#FCEBEB',
            color: msg.tipo === 'ok' ? GREEN : RED,
            border: `1px solid ${msg.tipo === 'ok' ? GREEN : RED}`,
          }}>
            {msg.tipo === 'ok' ? '✓ ' : '✕ '}{msg.texto}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={modo === 'lote' ? salvarLote : salvar}
            disabled={busy || !(modo === 'lote' ? podeSalvarLote : modo === 'folha' ? podeSalvarFolha : podeSalvarAvulso)}
            className="flex-1 rounded-xl py-3 text-sm font-semibold inline-flex items-center justify-center gap-2"
            style={{ background: ESP, color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            <Check size={16} />
            {busy ? 'Salvando…' : modo === 'lote' ? `CADASTRAR ${loteQtdNum || ''} ${loteQtdNum === 1 ? 'ANIMAL' : 'ANIMAIS'}`.trim() : modo === 'folha' ? `CRIAR ${linhas.length} registro${linhas.length === 1 ? '' : 's'}` : 'CRIAR registro'}
          </button>
          {msg?.tipo === 'ok' && (
            <button
              onClick={() => router.push('/dashboard/agro/rebanho')}
              className="px-4 py-3 rounded-xl text-sm font-semibold"
              style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}
            >
              Ver rebanho
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
