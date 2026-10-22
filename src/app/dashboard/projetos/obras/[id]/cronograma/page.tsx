'use client'
// HB3 (fatia 2) · Cronograma da obra — tarefas, dependências, linha de base e barras no tempo.
// Lê projetos_obra_tarefa / projetos_obra_tarefa_dependencia (RLS por empresa) e grava só pelas funções com guarda (fatia 1).
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA_AJUDA = '/dashboard/projetos/obras/[id]/cronograma'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const DIA = 86400000

type Tarefa = { id: string; nome: string; inicio: string; fim: string; percentual: number; inicio_base: string | null; fim_base: string | null; ordem: number }
type Dep = { id: string; tarefa_id: string; predecessora_id: string; defasagem_dias: number }
type Form = { id: string | null; nome: string; inicio: string; fim: string; percentual: string; predecessora: string; defasagem: string }

const hoje = () => new Date().toISOString().slice(0, 10)
const vazio = (): Form => ({ id: null, nome: '', inicio: hoje(), fim: hoje(), percentual: '0', predecessora: '', defasagem: '0' })
const ms = (d: string) => new Date(d + 'T00:00:00').getTime()
const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
const dias = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DIA) + 1

export default function CronogramaObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [deps, setDeps] = useState<Dep[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const t = await supabase.from('projetos_obra_tarefa').select('id,nome,inicio,fim,percentual,inicio_base,fim_base,ordem')
      .eq('obra_id', id).is('excluido_em', null).order('ordem').order('inicio')
    if (t.error) { setLoading(false); setErro(t.error.message); return }
    const lista = (t.data ?? []) as Tarefa[]
    const ids = lista.map((x) => x.id)
    let d: Dep[] = []
    if (ids.length > 0) {
      const r = await supabase.from('projetos_obra_tarefa_dependencia').select('id,tarefa_id,predecessora_id,defasagem_dias')
        .in('tarefa_id', ids).is('excluido_em', null)
      if (r.error) { setLoading(false); setErro(r.error.message); return }
      d = (r.data ?? []) as Dep[]
    }
    setTarefas(lista); setDeps(d); setLoading(false)
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const nomePorId = useMemo(() => new Map(tarefas.map((t) => [t.id, t.nome])), [tarefas])
  const predDe = useCallback((tid: string) => deps.find((d) => d.tarefa_id === tid), [deps])

  // janela do gráfico: do primeiro início ao último fim (considera a linha de base)
  const janela = useMemo(() => {
    if (tarefas.length === 0) return null
    const pontos = tarefas.flatMap((t) => [t.inicio, t.fim, t.inicio_base, t.fim_base].filter(Boolean) as string[])
    const ini = pontos.reduce((a, b) => (a < b ? a : b)); const fim = pontos.reduce((a, b) => (a > b ? a : b))
    return { ini, fim, total: Math.max(1, dias(ini, fim)) }
  }, [tarefas])

  const avancoGeral = useMemo(() => {
    const peso = tarefas.reduce((s, t) => s + dias(t.inicio, t.fim), 0)
    return peso > 0 ? tarefas.reduce((s, t) => s + (dias(t.inicio, t.fim) * Number(t.percentual)) / 100, 0) / peso * 100 : 0
  }, [tarefas])
  const temBase = tarefas.some((t) => t.fim_base)
  const atrasadas = tarefas.filter((t) => t.fim_base && t.fim > t.fim_base).length

  function editar(t: Tarefa) {
    const p = predDe(t.id)
    setForm({ id: t.id, nome: t.nome, inicio: t.inicio, fim: t.fim, percentual: String(t.percentual), predecessora: p?.predecessora_id ?? '', defasagem: String(p?.defasagem_dias ?? 0) })
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.nome.trim()) { setErro('Informe o nome da tarefa.'); return }
    if (form.fim < form.inicio) { setErro('O fim não pode ser antes do início.'); return }
    const pct = Number(form.percentual)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setErro('O avanço deve ficar entre 0 e 100.'); return }
    setSalvando(true); setErro(null); setAviso(null)
    const dados: Record<string, unknown> = { nome: form.nome.trim(), inicio: form.inicio, fim: form.fim, percentual: pct }
    if (form.id) dados.id = form.id; else dados.ordem = tarefas.length
    const r = await supabase.rpc('fn_obra_tarefa_salvar', { p_obra_id: id, p_dados: dados })
    if (r.error) { setSalvando(false); setErro(r.error.message); return }
    const tid = (r.data as { id: string }).id
    if (form.predecessora) {
      const dr = await supabase.rpc('fn_obra_tarefa_dependencia_salvar', { p_tarefa_id: tid, p_predecessora_id: form.predecessora, p_defasagem: Number(form.defasagem) || 0 })
      if (dr.error) { setSalvando(false); setErro(dr.error.message === 'Dependência circular' ? 'Essa dependência cria um ciclo: a predecessora já depende desta tarefa.' : dr.error.message); await carregar(); return }
    }
    setSalvando(false); setForm(null); setAviso('Tarefa salva.'); await carregar()
  }

  async function excluir(t: Tarefa) {
    if (!window.confirm(`Excluir a tarefa "${t.nome}"? As dependências dela também saem.`)) return
    setErro(null); setAviso(null)
    const r = await supabase.rpc('fn_obra_tarefa_excluir', { p_id: t.id })
    if (r.error) { setErro(r.error.message); return }
    setAviso('Tarefa excluída.'); await carregar()
  }

  async function fixarBase() {
    if (!window.confirm('Fixar o cronograma atual como linha de base? Ela passa a ser a referência para medir atrasos.')) return
    setErro(null); setAviso(null)
    const r = await supabase.rpc('fn_obra_cronograma_linha_base', { p_obra_id: id })
    if (r.error) { setErro(r.error.message); return }
    setAviso('Linha de base fixada.'); await carregar()
  }

  const pos = (d: string) => (janela ? ((ms(d) - ms(janela.ini)) / DIA / janela.total) * 100 : 0)
  const larg = (a: string, b: string) => (janela ? (dias(a, b) / janela.total) * 100 : 0)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 12px' }}>Cronograma</h1>

        {erro && <div role="alert" style={{ background: '#FBEAEA', color: VERM, borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        {aviso && <div role="status" style={{ background: '#E8F6EC', color: VERDE, borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 12 }}>{aviso}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <button onClick={() => { setForm(vazio()); setErro(null); setAviso(null) }} style={btn(true)}>Nova tarefa</button>
          <AjudaCampo chave="projetos.cronograma.nova_tarefa" rota={ROTA_AJUDA} />
          <button onClick={() => void fixarBase()} disabled={tarefas.length === 0} style={btn(false)}>Fixar linha de base</button>
          <AjudaCampo chave="projetos.cronograma.linha_base" rota={ROTA_AJUDA} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : (
          <>
            {form && (
              <form onSubmit={(e) => void salvar(e)} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
                <label style={lbl}>Nome da tarefa <AjudaCampo chave="projetos.cronograma.nome" rota={ROTA_AJUDA} />
                  <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} required />
                </label>
                <label style={lbl}>Início <AjudaCampo chave="projetos.cronograma.inicio" rota={ROTA_AJUDA} />
                  <input type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} style={inp} required />
                </label>
                <label style={lbl}>Fim <AjudaCampo chave="projetos.cronograma.fim" rota={ROTA_AJUDA} />
                  <input type="date" value={form.fim} min={form.inicio} onChange={(e) => setForm({ ...form, fim: e.target.value })} style={inp} required />
                </label>
                <label style={lbl}>Avanço (%) <AjudaCampo chave="projetos.cronograma.percentual" rota={ROTA_AJUDA} />
                  <input type="number" min={0} max={100} step={1} value={form.percentual} onChange={(e) => setForm({ ...form, percentual: e.target.value })} style={inp} />
                </label>
                <label style={lbl}>Depende de <AjudaCampo chave="projetos.cronograma.predecessora" rota={ROTA_AJUDA} />
                  <select value={form.predecessora} onChange={(e) => setForm({ ...form, predecessora: e.target.value })} style={inp}>
                    <option value="">Nenhuma</option>
                    {tarefas.filter((t) => t.id !== form.id).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>
                </label>
                <label style={lbl}>Defasagem (dias) <AjudaCampo chave="projetos.cronograma.defasagem" rota={ROTA_AJUDA} />
                  <input type="number" step={1} value={form.defasagem} onChange={(e) => setForm({ ...form, defasagem: e.target.value })} style={inp} />
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <button type="submit" disabled={salvando} style={btn(true)}>{salvando ? 'Salvando…' : 'Salvar tarefa'}</button>
                  <button type="button" onClick={() => setForm(null)} style={btn(false)}>Cancelar</button>
                </div>
              </form>
            )}

            {tarefas.length === 0 ? (
              <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>Esta obra ainda não tem cronograma</div>
                <div style={{ fontSize: 12.5, color: MUT, marginTop: 6 }}>Comece pela primeira etapa: toque em &quot;Nova tarefa&quot; e informe nome, início e fim.</div>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
                  <Mini label="Tarefas" valor={String(tarefas.length)} />
                  <Mini label="Avanço geral" valor={`${avancoGeral.toFixed(0)}%`} cor={VERDE} />
                  <Mini label="Fora da linha de base" valor={temBase ? String(atrasadas) : '—'} cor={atrasadas > 0 ? VERM : ESP} />
                </div>

                <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, overflowX: 'auto' }}>
                  <div style={{ minWidth: 560 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUT, marginLeft: 160, marginBottom: 6 }}>
                      <span>{janela && fmt(janela.ini)}</span><span>{janela && fmt(janela.fim)}</span>
                    </div>
                    {tarefas.map((t) => {
                      const p = predDe(t.id)
                      const atras = !!t.fim_base && t.fim > t.fim_base
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: `0.5px solid ${LINE}` }}>
                          <div style={{ width: 152, flexShrink: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: ESP }}>{t.nome}</div>
                            <div style={{ fontSize: 10.5, color: MUT }}>{fmt(t.inicio)} a {fmt(t.fim)} · {t.percentual}%{p ? ` · após ${nomePorId.get(p.predecessora_id) ?? '—'}` : ''}</div>
                          </div>
                          <div style={{ position: 'relative', flex: 1, height: 22 }}>
                            {t.inicio_base && t.fim_base && (
                              <div title="Linha de base" style={{ position: 'absolute', top: 15, height: 4, left: `${pos(t.inicio_base)}%`, width: `${larg(t.inicio_base, t.fim_base)}%`, background: LINE, borderRadius: 2 }} />
                            )}
                            <div style={{ position: 'absolute', top: 2, height: 12, left: `${pos(t.inicio)}%`, width: `${larg(t.inicio, t.fim)}%`, background: '#FBF4E4', border: `1px solid ${atras ? VERM : GOLD}`, borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${Number(t.percentual)}%`, height: '100%', background: atras ? VERM : GOLD }} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            <button onClick={() => editar(t)} style={btnMini}>Editar</button>
                            <button onClick={() => void excluir(t)} style={{ ...btnMini, color: VERM }}>Excluir</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: ESP }
const inp: React.CSSProperties = { padding: '9px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 14, color: ESP, background: '#fff', fontWeight: 400 }
const btn = (principal: boolean): React.CSSProperties => ({ padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${GOLD}`, background: principal ? GOLD : '#fff', color: principal ? '#fff' : '#A57A15' })
const btnMini: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#fff', color: ESP }

function Mini({ label, valor, cor = ESP }: { label: string; valor: string; cor?: string }) {
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: cor }}>{valor}</div>
      <div style={{ fontSize: 10, color: MUT, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  )
}
