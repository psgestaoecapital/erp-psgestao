'use client'
// HB3 fatia 2 · Cronograma da obra — barras no tempo, dependências, % concluído e linha de base.
// Lê projetos_obra_tarefa(+_dependencia) (RLS por empresa) e grava só pelas funções com guarda (fn_obra_tarefa_*).
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const ROTA = '/dashboard/projetos/obras/[id]/cronograma'
const DIA = 86400000

type Tarefa = { id: string; nome: string; inicio: string; fim: string; percentual: number; inicio_base: string | null; fim_base: string | null; ordem: number }
type Dep = { id: string; tarefa_id: string; predecessora_id: string; defasagem_dias: number }
type FormT = { id: string | null; nome: string; inicio: string; fim: string; percentual: string }

const t = (d: string) => new Date(d + 'T00:00:00').getTime()
const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const dias = (a: string, b: string) => Math.round((t(b) - t(a)) / DIA)
const vazio: FormT = { id: null, nome: '', inicio: '', fim: '', percentual: '0' }

export default function CronogramaObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<string>('')
  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [deps, setDeps] = useState<Dep[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [form, setForm] = useState<FormT | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [depForm, setDepForm] = useState({ tarefa: '', pred: '', defasagem: '0' })

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    const [o, ts, ds] = await Promise.all([
      supabase.from('projetos_obras').select('numero, nome').eq('id', id).maybeSingle(),
      supabase.from('projetos_obra_tarefa').select('id, nome, inicio, fim, percentual, inicio_base, fim_base, ordem').eq('obra_id', id).is('excluido_em', null).order('ordem').order('inicio'),
      supabase.from('projetos_obra_tarefa_dependencia').select('id, tarefa_id, predecessora_id, defasagem_dias').is('excluido_em', null),
    ])
    setLoading(false)
    if (ts.error) { setErro(ts.error.message); return }
    setObra(o.data ? `${o.data.numero}${o.data.nome ? ' · ' + o.data.nome : ''}` : '')
    const lista = (ts.data ?? []) as Tarefa[]
    const ids = new Set(lista.map((x) => x.id))
    setTarefas(lista)
    setDeps(((ds.data ?? []) as Dep[]).filter((d) => ids.has(d.tarefa_id)))
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function chamar(fn: string, args: Record<string, unknown>, ok?: string) {
    setSalvando(true); setAviso(null); setErro(null)
    const { error } = await supabase.rpc(fn, args)
    setSalvando(false)
    if (error) { setErro(error.message); return false }
    if (ok) setAviso(ok)
    await carregar()
    return true
  }

  async function salvar() {
    if (!form) return
    if (!form.nome.trim() || !form.inicio || !form.fim) { setErro('Informe nome, início e fim.'); return }
    if (form.fim < form.inicio) { setErro('O fim não pode ser antes do início.'); return }
    const pct = Math.min(100, Math.max(0, Number(form.percentual) || 0))
    const dados: Record<string, unknown> = { nome: form.nome.trim(), inicio: form.inicio, fim: form.fim, percentual: pct }
    if (form.id) dados.id = form.id; else dados.ordem = tarefas.length + 1
    if (await chamar('fn_obra_tarefa_salvar', { p_obra_id: id, p_dados: dados }, 'Tarefa salva.')) setForm(null)
  }

  const nomeDe = useMemo(() => new Map(tarefas.map((x) => [x.id, x.nome])), [tarefas])
  const escala = useMemo(() => {
    if (tarefas.length === 0) return null
    const datas = tarefas.flatMap((x) => [x.inicio, x.fim, ...(x.inicio_base ? [x.inicio_base] : []), ...(x.fim_base ? [x.fim_base] : [])])
    const ini = datas.reduce((a, b) => (a < b ? a : b)), fim = datas.reduce((a, b) => (a > b ? a : b))
    return { ini, total: Math.max(1, dias(ini, fim) + 1) }
  }, [tarefas])
  const hoje = new Date().toISOString().slice(0, 10)
  const avanco = tarefas.length ? tarefas.reduce((s, x) => s + x.percentual * (dias(x.inicio, x.fim) + 1), 0) / tarefas.reduce((s, x) => s + dias(x.inicio, x.fim) + 1, 0) : 0
  const pos = (d: string) => (dias(escala!.ini, d) / escala!.total) * 100

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }} data-testid="hub-cronograma-obra">
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Cronograma {obra && `· ${obra}`}</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 14px' }}>Planeje as etapas, ligue o que depende do quê e compare com a linha de base.</p>

        {erro && <div role="alert" style={{ background: '#FBEAEA', color: VERM, borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        {aviso && <div role="status" style={{ background: '#E8F6EC', color: VERDE, borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 12 }}>{aviso}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <button data-testid="crono-nova" onClick={() => { setForm({ ...vazio, inicio: hoje, fim: hoje }); setErro(null) }} style={btnP}>Nova tarefa</button>
          <button data-testid="crono-linha-base" disabled={salvando || tarefas.length === 0}
            onClick={() => { if (window.confirm('Gravar as datas atuais como linha de base? A anterior será substituída.')) void chamar('fn_obra_cronograma_linha_base', { p_obra_id: id }, 'Linha de base gravada.') }}
            style={{ ...btnS, opacity: tarefas.length === 0 ? 0.5 : 1 }}>Gravar linha de base</button>
          <AjudaCampo chave="projetos.cronograma.linha_base" rota={ROTA} />
          {tarefas.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 12.5, color: ESP, fontWeight: 700 }}>Avanço físico ponderado: {avanco.toFixed(0)}%</span>}
        </div>

        {form && (
          <div data-testid="crono-form" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
            <label style={lbl}>Nome da tarefa <AjudaCampo chave="projetos.cronograma.nome" rota={ROTA} />
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} data-testid="crono-nome" /></label>
            <label style={lbl}>Início <AjudaCampo chave="projetos.cronograma.inicio" rota={ROTA} />
              <input type="date" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} style={inp} data-testid="crono-inicio" /></label>
            <label style={lbl}>Fim <AjudaCampo chave="projetos.cronograma.fim" rota={ROTA} />
              <input type="date" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} style={inp} data-testid="crono-fim" /></label>
            <label style={lbl}>% concluído <AjudaCampo chave="projetos.cronograma.percentual" rota={ROTA} />
              <input type="number" min={0} max={100} value={form.percentual} onChange={(e) => setForm({ ...form, percentual: e.target.value })} style={inp} data-testid="crono-pct" /></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <button onClick={() => void salvar()} disabled={salvando} style={btnP} data-testid="crono-salvar">Salvar</button>
              <button onClick={() => setForm(null)} style={btnS}>Cancelar</button>
            </div>
          </div>
        )}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
          : tarefas.length === 0 ? (
            <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>Esta obra ainda não tem cronograma</div>
              <div style={{ fontSize: 12.5, color: MUT, marginTop: 6 }}>Comece pela primeira etapa: toque em &quot;Nova tarefa&quot; e informe nome e datas.</div>
            </div>
          ) : escala && (
            <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, overflowX: 'auto' }}>
              <div style={{ minWidth: 560 }}>
                {tarefas.map((x) => {
                  const atrasada = x.percentual < 100 && x.fim < hoje
                  const desvio = x.fim_base ? dias(x.fim_base, x.fim) : null
                  return (
                    <div key={x.id} data-testid="crono-linha" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: `0.5px solid ${LINE}` }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{x.nome}</div>
                        <div style={{ fontSize: 11, color: MUT }}>{fmt(x.inicio)} a {fmt(x.fim)} · {x.percentual}%
                          {desvio !== null && desvio !== 0 && <span style={{ color: desvio > 0 ? VERM : VERDE, fontWeight: 700 }}> · {desvio > 0 ? `+${desvio}d` : `${desvio}d`} da base</span>}</div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                          <button onClick={() => { setForm({ id: x.id, nome: x.nome, inicio: x.inicio, fim: x.fim, percentual: String(x.percentual) }); setErro(null) }} style={lnk}>Editar</button>
                          <button onClick={() => { if (window.confirm(`Excluir a tarefa "${x.nome}"?`)) void chamar('fn_obra_tarefa_excluir', { p_id: x.id }, 'Tarefa excluída.') }} style={{ ...lnk, color: VERM }}>Excluir</button>
                        </div>
                      </div>
                      <div style={{ position: 'relative', height: 30 }}>
                        {x.inicio_base && x.fim_base && (
                          <div title="Linha de base" style={{ position: 'absolute', top: 22, height: 4, borderRadius: 2, background: '#BDB2A4', left: `${pos(x.inicio_base)}%`, width: `${((dias(x.inicio_base, x.fim_base) + 1) / escala.total) * 100}%` }} />
                        )}
                        <div style={{ position: 'absolute', top: 4, height: 16, borderRadius: 4, background: atrasada ? '#F3C9C9' : '#F1E3BD', left: `${pos(x.inicio)}%`, width: `${((dias(x.inicio, x.fim) + 1) / escala.total) * 100}%`, overflow: 'hidden' }}>
                          <div style={{ width: `${x.percentual}%`, height: '100%', background: atrasada ? VERM : GOLD }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: MUT, marginTop: 6, paddingLeft: 190 }}>
                  <span>{fmt(escala.ini)}</span><span>{fmt(new Date(t(escala.ini) + (escala.total - 1) * DIA).toISOString().slice(0, 10))}</span>
                </div>
              </div>
            </div>
          )}

        {tarefas.length > 1 && (
          <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 8 }}>Dependências</div>
            {deps.length === 0 && <div style={{ fontSize: 12.5, color: MUT, marginBottom: 8 }}>Nenhuma dependência. Ligue uma tarefa à que precisa terminar antes dela.</div>}
            {deps.map((d) => (
              <div key={d.id} style={{ fontSize: 12.5, color: ESP, padding: '3px 0' }}>
                {nomeDe.get(d.tarefa_id)} depende de {nomeDe.get(d.predecessora_id)}{d.defasagem_dias ? ` (${d.defasagem_dias > 0 ? '+' : ''}${d.defasagem_dias}d)` : ''}
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginTop: 8 }}>
              <label style={lbl}>Tarefa <AjudaCampo chave="projetos.cronograma.dep_tarefa" rota={ROTA} />
                <select value={depForm.tarefa} onChange={(e) => setDepForm({ ...depForm, tarefa: e.target.value })} style={inp} data-testid="crono-dep-tarefa">
                  <option value="">Escolha</option>{tarefas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
              <label style={lbl}>Depende de <AjudaCampo chave="projetos.cronograma.dep_pred" rota={ROTA} />
                <select value={depForm.pred} onChange={(e) => setDepForm({ ...depForm, pred: e.target.value })} style={inp} data-testid="crono-dep-pred">
                  <option value="">Escolha</option>{tarefas.filter((x) => x.id !== depForm.tarefa).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
              <label style={lbl}>Defasagem (dias) <AjudaCampo chave="projetos.cronograma.dep_defasagem" rota={ROTA} />
                <input type="number" value={depForm.defasagem} onChange={(e) => setDepForm({ ...depForm, defasagem: e.target.value })} style={inp} /></label>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button disabled={salvando || !depForm.tarefa || !depForm.pred} data-testid="crono-dep-salvar" style={btnS}
                  onClick={() => void chamar('fn_obra_tarefa_dependencia_salvar', { p_tarefa_id: depForm.tarefa, p_predecessora_id: depForm.pred, p_defasagem: Number(depForm.defasagem) || 0 }, 'Dependência salva.').then((ok) => { if (ok) setDepForm({ tarefa: '', pred: '', defasagem: '0' }) })}>Ligar tarefas</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: ESP }
const inp: React.CSSProperties = { padding: '9px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 14, background: '#fff', color: ESP, minHeight: 40 }
const btnP: React.CSSProperties = { background: GOLD, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', minHeight: 40 }
const btnS: React.CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', minHeight: 40 }
const lnk: React.CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: 11.5, color: GOLD, fontWeight: 700, cursor: 'pointer' }
