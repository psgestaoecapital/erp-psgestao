'use client'
// HB3 · Cronograma da obra — lista + Gantt (desktop e celular), tarefas com datas, % e predecessora, linha de base.
// Usa as funções da fatia 1 (fn_obra_tarefa_salvar/excluir, fn_obra_tarefa_dependencia_salvar, fn_obra_cronograma_linha_base).
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const DIA = 86400000
const dt = (s: string) => new Date(`${s}T12:00:00`).getTime()
const fmt = (s: string) => s.split('-').reverse().slice(0, 2).join('/')

type Tarefa = { id: string; nome: string; inicio: string; fim: string; percentual: number; inicio_base: string | null; fim_base: string | null; ordem: number }
type Dep = { tarefa_id: string; predecessora_id: string; defasagem_dias: number }
type Form = { id?: string; nome: string; inicio: string; fim: string; percentual: string; predecessora: string }
const VAZIO: Form = { nome: '', inicio: '', fim: '', percentual: '0', predecessora: '' }

export default function CronogramaObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<string>('')
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [deps, setDeps] = useState<Dep[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const o = await supabase.from('projetos_obras').select('numero, nome').eq('id', id).maybeSingle()
    if (o.error || !o.data) { setLoading(false); setErro('Obra não encontrada ou sem acesso.'); return }
    setObra(`${o.data.numero}${o.data.nome ? ` — ${o.data.nome}` : ''}`)
    const t = await supabase.from('projetos_obra_tarefa').select('id, nome, inicio, fim, percentual, inicio_base, fim_base, ordem')
      .eq('obra_id', id).is('excluido_em', null).order('ordem').order('inicio')
    if (t.error) { setLoading(false); setErro(t.error.message); return }
    const lista = (t.data ?? []) as Tarefa[]
    setTarefas(lista)
    const ids = lista.map((x) => x.id)
    if (ids.length) {
      const d = await supabase.from('projetos_obra_tarefa_dependencia').select('tarefa_id, predecessora_id, defasagem_dias').in('tarefa_id', ids).is('excluido_em', null)
      setDeps((d.data ?? []) as Dep[])
    } else setDeps([])
    setLoading(false)
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const { min, total } = useMemo(() => {
    if (!tarefas.length) return { min: 0, total: 1 }
    const datas = tarefas.flatMap((t) => [dt(t.inicio), dt(t.fim), t.inicio_base ? dt(t.inicio_base) : dt(t.inicio), t.fim_base ? dt(t.fim_base) : dt(t.fim)])
    const mn = Math.min(...datas), mx = Math.max(...datas)
    return { min: mn, total: Math.max(DIA, mx - mn + DIA) }
  }, [tarefas])
  const nomePor = useMemo(() => new Map(tarefas.map((t) => [t.id, t.nome])), [tarefas])
  const predDe = (tid: string) => deps.find((d) => d.tarefa_id === tid)?.predecessora_id ?? ''
  const hoje = Date.now()
  const atrasada = (t: Tarefa) => t.percentual < 100 && dt(t.fim) + DIA < hoje

  function abrir(t?: Tarefa) {
    setAviso(null)
    setForm(t ? { id: t.id, nome: t.nome, inicio: t.inicio, fim: t.fim, percentual: String(t.percentual), predecessora: predDe(t.id) } : { ...VAZIO })
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.nome.trim()) { setAviso('Dê um nome à tarefa.'); return }
    if (!form.inicio || !form.fim) { setAviso('Informe o início e o fim.'); return }
    if (form.fim < form.inicio) { setAviso('O fim não pode ser antes do início.'); return }
    const pct = Number(form.percentual)
    if (!(pct >= 0 && pct <= 100)) { setAviso('O percentual vai de 0 a 100.'); return }
    setSalvando(true); setAviso(null)
    const r = await supabase.rpc('fn_obra_tarefa_salvar', {
      p_obra_id: id,
      p_dados: { id: form.id ?? '', nome: form.nome.trim(), inicio: form.inicio, fim: form.fim, percentual: pct, ordem: form.id ? undefined : tarefas.length },
    })
    if (r.error) { setSalvando(false); setAviso(r.error.message); return }
    const tid = (r.data as { id: string }).id
    if (form.predecessora && form.predecessora !== predDe(tid)) {
      const d = await supabase.rpc('fn_obra_tarefa_dependencia_salvar', { p_tarefa_id: tid, p_predecessora_id: form.predecessora, p_defasagem: 0 })
      if (d.error) { setSalvando(false); setAviso(d.error.message); await carregar(); return }
    }
    setSalvando(false); setForm(null); await carregar()
  }

  async function excluir(t: Tarefa) {
    if (!window.confirm(`Excluir a tarefa "${t.nome}"? As ligações dela com outras tarefas também saem.`)) return
    const r = await supabase.rpc('fn_obra_tarefa_excluir', { p_id: t.id })
    if (r.error) { setErro(r.error.message); return }
    await carregar()
  }

  async function linhaBase() {
    if (!window.confirm('Gravar as datas atuais como linha de base? A anterior será substituída.')) return
    const r = await supabase.rpc('fn_obra_cronograma_linha_base', { p_obra_id: id })
    if (r.error) { setErro(r.error.message); return }
    await carregar()
  }

  const btn = { border: `1px solid ${LINE}`, background: '#fff', color: ESP, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', minHeight: 40 } as const
  const btnPri = { ...btn, background: ESP, color: '#fff', border: `1px solid ${ESP}` } as const
  const inp = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, background: '#fff', color: ESP, width: '100%', minHeight: 40 } as const
  const rot = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: MUT } as const

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }} data-testid="hub-cronograma-obra">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 12px' }}>Cronograma{obra ? ` · ${obra}` : ''}</h1>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
          : erro ? <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 10, padding: 14, fontSize: 13 }}>{erro}</div>
          : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button style={btnPri} data-testid="cron-nova" onClick={() => abrir()}>+ Nova tarefa</button>
                <button style={btn} data-testid="cron-linha-base" disabled={!tarefas.length} onClick={() => void linhaBase()}>Gravar linha de base</button>
                <AjudaCampo chave="projetos.cronograma.linha_base" />
              </div>

              {tarefas.length === 0 ? (
                <div data-testid="cron-vazio" style={{ background: '#fff', border: `0.5px dashed ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center', color: MUT, fontSize: 13 }}>
                  Esta obra ainda não tem cronograma. Comece pela primeira etapa — por exemplo, “Mobilização”.
                  <div style={{ marginTop: 12 }}><button style={btnPri} onClick={() => abrir()}>Criar a primeira tarefa</button></div>
                </div>
              ) : (
                <div data-testid="cron-lista" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tarefas.map((t) => {
                    const left = ((dt(t.inicio) - min) / total) * 100
                    const w = Math.max(1.5, ((dt(t.fim) - dt(t.inicio) + DIA) / total) * 100)
                    const lb = t.inicio_base && t.fim_base ? { l: ((dt(t.inicio_base) - min) / total) * 100, w: Math.max(1.5, ((dt(t.fim_base) - dt(t.inicio_base) + DIA) / total) * 100) } : null
                    const pred = predDe(t.id)
                    return (
                      <div key={t.id} data-testid="cron-tarefa" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{t.nome}</div>
                          <div style={{ fontSize: 11.5, color: atrasada(t) ? VERM : MUT }}>
                            {fmt(t.inicio)} → {fmt(t.fim)} · {t.percentual}%{atrasada(t) ? ' · atrasada' : ''}
                          </div>
                        </div>
                        {pred && <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>Depois de: {nomePor.get(pred) ?? '—'}</div>}
                        <div style={{ position: 'relative', height: lb ? 26 : 16, background: BG, borderRadius: 6, margin: '8px 0' }} aria-label="Barra do cronograma">
                          {lb && <div title="Linha de base" style={{ position: 'absolute', top: 18, height: 5, left: `${lb.l}%`, width: `${lb.w}%`, background: LINE, borderRadius: 3 }} />}
                          <div style={{ position: 'absolute', top: 2, height: 14, left: `${left}%`, width: `${w}%`, background: atrasada(t) ? '#E8B4B4' : '#E9D9B0', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${t.percentual}%`, height: '100%', background: atrasada(t) ? VERM : VERDE }} />
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button style={btn} onClick={() => abrir(t)}>Editar</button>
                          <button style={{ ...btn, color: VERM }} onClick={() => void excluir(t)}>Excluir</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

        {form && (
          <div role="dialog" aria-modal="true" data-testid="cron-form" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}>
            <form onSubmit={(e) => void salvar(e)} style={{ background: '#fff', width: '100%', maxWidth: 520, borderRadius: '16px 16px 0 0', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '92vh', overflow: 'auto' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: ESP }}>{form.id ? 'Editar tarefa' : 'Nova tarefa'}</div>
              <label style={rot}><span>Nome da tarefa<AjudaCampo chave="projetos.cronograma.nome" /></span>
                <input style={inp} data-testid="cron-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={rot}><span>Início<AjudaCampo chave="projetos.cronograma.inicio" /></span>
                  <input style={inp} type="date" data-testid="cron-inicio" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} /></label>
                <label style={rot}><span>Fim<AjudaCampo chave="projetos.cronograma.fim" /></span>
                  <input style={inp} type="date" data-testid="cron-fim" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} /></label>
              </div>
              <label style={rot}><span>Percentual concluído<AjudaCampo chave="projetos.cronograma.percentual" /></span>
                <input style={inp} type="number" min={0} max={100} step={1} data-testid="cron-pct" value={form.percentual} onChange={(e) => setForm({ ...form, percentual: e.target.value })} /></label>
              <label style={rot}><span>Começa depois de<AjudaCampo chave="projetos.cronograma.predecessora" /></span>
                <select style={inp} data-testid="cron-pred" value={form.predecessora} onChange={(e) => setForm({ ...form, predecessora: e.target.value })}>
                  <option value="">Nenhuma</option>
                  {tarefas.filter((t) => t.id !== form.id).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select></label>
              {aviso && <div data-testid="cron-aviso" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 12.5 }}>{aviso}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" style={btn} onClick={() => setForm(null)}>Cancelar</button>
                <button type="submit" style={btnPri} disabled={salvando} data-testid="cron-salvar">{salvando ? 'Salvando…' : 'Salvar'}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
