'use client'
// HB3 (fatia 2) · Cronograma da obra — tarefas, dependências, linha de base e barras no tempo.
// Lê projetos_obra_tarefa / projetos_obra_tarefa_dependencia (RLS por empresa) e grava só pelas funções com guarda (fatia 1).
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { curvaS } from '@/lib/hub/curvaS'
import { fisicoFinanceiro } from '@/lib/hub/fisicoFinanceiro'
import { caminhoCritico } from '@/lib/hub/caminhoCritico'
import { lookahead, type Situacao } from '@/lib/hub/lookahead'

const ROTA_AJUDA = '/dashboard/projetos/obras/[id]/cronograma'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const DIA = 86400000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Tarefa = { id: string; nome: string; inicio: string; fim: string; percentual: number; inicio_base: string | null; fim_base: string | null; ordem: number; custo_previsto: number | null }
type Dep = { id: string; tarefa_id: string; predecessora_id: string; defasagem_dias: number }
type ObraItem = { id: string; descricao: string; unidade: string | null; quantidade_contratada: number | null }
type Vinculo = { id: string; tarefa_id: string; obra_item_id: string; percentual: number }
type Necessidade = { insumo_id: string; insumo: string; unidade: string | null; quantidade: number; custo_estimado: number | null; a_partir_de: string; tarefas: string[] }
type Necessidades = { insumos: Necessidade[]; custo_total: number; tarefas_sem_item: number; itens_sem_composicao: number }
// itens: obra_item_id -> parte do item (%) nesta tarefa, só os marcados
type Form = { id: string | null; nome: string; inicio: string; fim: string; percentual: string; predecessora: string; defasagem: string; custo: string; itens: Record<string, string> }

const hoje = () => new Date().toISOString().slice(0, 10)
const vazio = (): Form => ({ id: null, nome: '', inicio: hoje(), fim: hoje(), percentual: '0', predecessora: '', defasagem: '0', custo: '', itens: {} })
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
  const [soCriticas, setSoCriticas] = useState(false)
  const [semanas, setSemanas] = useState(2)
  const [falhaCarga, setFalhaCarga] = useState<string | null>(null) // carga falhou: não mostra o estado vazio junto
  const [itensObra, setItensObra] = useState<ObraItem[]>([])
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  const [necess, setNecess] = useState<Necessidades | null>(null)
  const [falhaNecess, setFalhaNecess] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null); setFalhaCarga(null)
    if (!UUID.test(id)) { setLoading(false); setFalhaCarga('Obra não encontrada. Abra o cronograma pela lista de obras.'); return }
    const t = await supabase.from('projetos_obra_tarefa').select('id,nome,inicio,fim,percentual,inicio_base,fim_base,ordem,custo_previsto')
      .eq('obra_id', id).is('excluido_em', null).order('ordem').order('inicio')
    if (t.error) { setLoading(false); setFalhaCarga('Não foi possível carregar o cronograma desta obra. Atualize a página; se continuar, abra pela lista de obras.'); return }
    const lista = (t.data ?? []) as Tarefa[]
    const ids = lista.map((x) => x.id)
    let d: Dep[] = []
    if (ids.length > 0) {
      const r = await supabase.from('projetos_obra_tarefa_dependencia').select('id,tarefa_id,predecessora_id,defasagem_dias')
        .in('tarefa_id', ids).is('excluido_em', null)
      if (r.error) { setLoading(false); setFalhaCarga('Não foi possível carregar as dependências do cronograma. Atualize a página para tentar de novo.'); return }
      d = (r.data ?? []) as Dep[]
    }
    // itens contratados da obra e o vínculo tarefa -> item (base do "O que comprar"); falha aqui não derruba o cronograma
    const it = await supabase.from('projetos_obra_item').select('id,descricao,unidade,quantidade_contratada')
      .eq('obra_id', id).is('excluido_em', null).order('ordem')
    let v: Vinculo[] = []
    if (ids.length > 0) {
      const rv = await supabase.from('projetos_obra_tarefa_item').select('id,tarefa_id,obra_item_id,percentual')
        .in('tarefa_id', ids).is('excluido_em', null)
      if (!rv.error) v = (rv.data ?? []) as Vinculo[]
    }
    setItensObra(it.error ? [] : ((it.data ?? []) as ObraItem[])); setVinculos(v)
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
  const curva = useMemo(() => curvaS(tarefas, hoje()), [tarefas])
  const ff = useMemo(() => fisicoFinanceiro(tarefas, hoje()), [tarefas])
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const cpm = useMemo(() => caminhoCritico(tarefas, deps), [tarefas, deps])
  const prox = useMemo(() => lookahead(tarefas, hoje(), semanas * 7), [tarefas, semanas])
  useEffect(() => {
    if (!UUID.test(id) || tarefas.length === 0) { setNecess(null); return } // eslint-disable-line react-hooks/set-state-in-effect
    let vivo = true
    void supabase.rpc('fn_obra_necessidades_periodo', { p_obra_id: id, p_de: hoje(), p_ate: prox.ate }).then((r) => {
      if (!vivo) return
      if (r.error) { setFalhaNecess(true); setNecess(null) } else { setFalhaNecess(false); setNecess(r.data as Necessidades) }
    })
    return () => { vivo = false }
  }, [id, prox.ate, tarefas, vinculos])
  const visiveis = soCriticas ? tarefas.filter((t) => cpm.criticas.has(t.id)) : tarefas
  const temBase = tarefas.some((t) => t.fim_base)
  const atrasadas = tarefas.filter((t) => t.fim_base && t.fim > t.fim_base).length

  function editar(t: Tarefa) {
    const p = predDe(t.id)
    setForm({ id: t.id, nome: t.nome, inicio: t.inicio, fim: t.fim, percentual: String(t.percentual), predecessora: p?.predecessora_id ?? '', defasagem: String(p?.defasagem_dias ?? 0), custo: t.custo_previsto == null ? '' : String(t.custo_previsto),
      itens: Object.fromEntries(vinculos.filter((v) => v.tarefa_id === t.id).map((v) => [v.obra_item_id, String(v.percentual)])) })
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.nome.trim()) { setErro('Informe o nome da tarefa.'); return }
    if (form.fim < form.inicio) { setErro('O fim não pode ser antes do início.'); return }
    const pct = Number(form.percentual)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setErro('O avanço deve ficar entre 0 e 100.'); return }
    const custo = form.custo.trim() === '' ? null : Number(form.custo.replace(',', '.'))
    if (custo !== null && (!Number.isFinite(custo) || custo < 0)) { setErro('O custo previsto deve ser um valor maior ou igual a zero.'); return }
    for (const parte of Object.values(form.itens)) {
      const n = Number(parte)
      if (!Number.isFinite(n) || n <= 0 || n > 100) { setErro('A parte de cada item ligado deve ficar entre 1 e 100%.'); return }
    }
    setSalvando(true); setErro(null); setAviso(null)
    const dados: Record<string, unknown> = { nome: form.nome.trim(), inicio: form.inicio, fim: form.fim, percentual: pct }
    if (form.id) dados.id = form.id; else dados.ordem = tarefas.length
    const r = await supabase.rpc('fn_obra_tarefa_salvar', { p_obra_id: id, p_dados: dados })
    if (r.error) { setSalvando(false); setErro(erroAmigavel(r.error)); return }
    const tid = (r.data as { id: string }).id
    const cr = await supabase.rpc('fn_obra_tarefa_custo_salvar', { p_id: tid, p_custo: custo })
    if (cr.error) { setSalvando(false); setErro(erroAmigavel(cr.error)); await carregar(); return }
    if (form.predecessora) {
      const dr = await supabase.rpc('fn_obra_tarefa_dependencia_salvar', { p_tarefa_id: tid, p_predecessora_id: form.predecessora, p_defasagem: Number(form.defasagem) || 0 })
      if (dr.error) {
        const ciclo = dr.error.message === 'Dependência circular'
        setSalvando(false); setErro(ciclo ? 'Essa dependência cria um ciclo: a predecessora já depende desta tarefa.' : erroAmigavel(dr.error)); await carregar(); return
      }
    }
    // itens da obra nesta tarefa: liga/ajusta os marcados e desliga os desmarcados
    const atuais = vinculos.filter((v) => v.tarefa_id === tid)
    for (const [itemId, parte] of Object.entries(form.itens)) {
      const ja = atuais.find((v) => v.obra_item_id === itemId)
      if (ja && Number(ja.percentual) === Number(parte)) continue
      const vr = await supabase.rpc('fn_obra_tarefa_item_salvar', { p_tarefa_id: tid, p_obra_item_id: itemId, p_percentual: Number(parte) })
      if (vr.error) { setSalvando(false); setErro(erroAmigavel(vr.error)); await carregar(); return }
    }
    for (const v of atuais.filter((x) => !(x.obra_item_id in form.itens))) {
      const xr = await supabase.rpc('fn_obra_tarefa_item_excluir', { p_id: v.id })
      if (xr.error) { setSalvando(false); setErro(erroAmigavel(xr.error)); await carregar(); return }
    }
    setSalvando(false); setForm(null); setAviso('Tarefa salva.'); await carregar()
  }

  async function excluir(t: Tarefa) {
    if (!window.confirm(`Excluir a tarefa "${t.nome}"? As dependências dela também saem.`)) return
    setErro(null); setAviso(null)
    const r = await supabase.rpc('fn_obra_tarefa_excluir', { p_id: t.id })
    if (r.error) { setErro(erroAmigavel(r.error)); return }
    setAviso('Tarefa excluída.'); await carregar()
  }

  async function fixarBase() {
    if (!window.confirm('Fixar o cronograma atual como linha de base? Ela passa a ser a referência para medir atrasos.')) return
    setErro(null); setAviso(null)
    const r = await supabase.rpc('fn_obra_cronograma_linha_base', { p_obra_id: id })
    if (r.error) { setErro(erroAmigavel(r.error)); return }
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
          <button onClick={() => { setForm(vazio()); setErro(null); setAviso(null) }} disabled={!!falhaCarga} style={btn(true)}>Nova tarefa</button>
          <AjudaCampo chave="projetos.cronograma.nova_tarefa" rota={ROTA_AJUDA} />
          <button onClick={() => void fixarBase()} disabled={tarefas.length === 0 || !!falhaCarga} style={btn(false)}>Fixar linha de base</button>
          <AjudaCampo chave="projetos.cronograma.linha_base" rota={ROTA_AJUDA} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : falhaCarga ? (
          <div role="alert" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: VERM }}>{falhaCarga}</div>
            <Link href="/dashboard/projetos/obras" style={{ display: 'inline-block', marginTop: 10, fontSize: 12.5, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>Ir para a lista de obras →</Link>
          </div>
        ) : (
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
                <label style={lbl}>Custo previsto (R$) <AjudaCampo chave="projetos.cronograma.custo_previsto" rota={ROTA_AJUDA} />
                  <input inputMode="decimal" value={form.custo} onChange={(e) => setForm({ ...form, custo: e.target.value })} style={inp} placeholder="opcional" />
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
                {itensObra.length > 0 && (
                  <fieldset style={{ gridColumn: '1 / -1', border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 10px', margin: 0 }}>
                    <legend style={{ fontSize: 12, fontWeight: 600, color: ESP, padding: '0 4px' }}>Itens da obra nesta tarefa <AjudaCampo chave="projetos.cronograma.itens_tarefa" rota={ROTA_AJUDA} /></legend>
                    {itensObra.map((it) => {
                      const marcado = it.id in form.itens
                      return (
                        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ESP, flex: 1, minWidth: 180 }}>
                            <input type="checkbox" checked={marcado} style={{ width: 18, height: 18 }}
                              onChange={(e) => { const itens = { ...form.itens }; if (e.target.checked) itens[it.id] = '100'; else delete itens[it.id]; setForm({ ...form, itens }) }} />
                            {it.descricao}{it.quantidade_contratada != null ? ` · ${Number(it.quantidade_contratada).toLocaleString('pt-BR')} ${it.unidade ?? ''}` : ''}
                            <AjudaCampo chave="projetos.cronograma.itens_tarefa" rota={ROTA_AJUDA} />
                          </label>
                          {marcado && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: MUT }}>
                              Parte <AjudaCampo chave="projetos.cronograma.itens_tarefa_parte" rota={ROTA_AJUDA} />
                              <input type="number" min={1} max={100} step={1} value={form.itens[it.id]} aria-label={`Parte do item ${it.descricao} (%)`}
                                onChange={(e) => setForm({ ...form, itens: { ...form.itens, [it.id]: e.target.value } })} style={{ ...inp, width: 70, padding: '6px 8px', fontSize: 13 }} />%
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </fieldset>
                )}
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
                  <Mini label="Tarefas" valor={String(tarefas.length)} ajuda="projetos.cronograma.ind_tarefas" />
                  <Mini label="Avanço geral" valor={`${avancoGeral.toFixed(0)}%`} cor={VERDE} ajuda="projetos.cronograma.ind_avanco" />
                  <Mini label="Planejado hoje" valor={curva ? `${curva.planejadoHoje.toFixed(0)}%` : '—'} ajuda="projetos.cronograma.ind_planejado" />
                  <Mini label="Desvio" valor={curva ? `${curva.desvio > 0 ? '+' : ''}${curva.desvio.toFixed(0)} p.p.` : '—'} cor={curva && curva.desvio < -0.5 ? VERM : VERDE} ajuda="projetos.cronograma.ind_desvio" />
                  <Mini label="Fora da linha de base" valor={temBase ? String(atrasadas) : '—'} cor={atrasadas > 0 ? VERM : ESP} ajuda="projetos.cronograma.ind_fora_base" />
                  <Mini label="Caminho crítico" valor={`${cpm.criticas.size} de ${tarefas.length}`} cor={VERM} ajuda="projetos.cronograma.ind_caminho_critico" />
                </div>

                {ff && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
                    <Mini label="Custo previsto total" valor={brl(ff.previsto)} ajuda="projetos.cronograma.ind_custo_previsto" />
                    <Mini label="Custo planejado hoje" valor={brl(ff.planejadoHoje)} ajuda="projetos.cronograma.ind_custo_planejado" />
                    <Mini label="Custo apropriado" valor={brl(ff.apropriado)} cor={ff.desvio < -0.5 ? VERM : VERDE} ajuda="projetos.cronograma.ind_custo_apropriado" />
                  </div>
                )}

                <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Próximas semanas — até {fmt(prox.ate)} <AjudaCampo chave="projetos.cronograma.lookahead" rota={ROTA_AJUDA} /></div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: ESP }}>
                      Período <AjudaCampo chave="projetos.cronograma.lookahead_periodo" rota={ROTA_AJUDA} />
                      <select value={semanas} onChange={(e) => setSemanas(Number(e.target.value))} style={{ ...inp, padding: '6px 8px', fontSize: 13 }}>
                        <option value={1}>1 semana</option><option value={2}>2 semanas</option><option value={4}>4 semanas</option>
                      </select>
                    </label>
                  </div>
                  {prox.itens.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: MUT }}>Nenhuma tarefa pendente neste período.</div>
                  ) : prox.itens.map(({ tarefa: t, situacao, diasAtraso }) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: `0.5px solid ${LINE}`, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, borderRadius: 6, padding: '2px 6px', background: situacao === 'atrasada' ? '#FBEAEA' : '#FBF4E4', color: situacao === 'atrasada' ? VERM : '#A57A15', flexShrink: 0 }}>{rotuloSituacao(situacao, diasAtraso)}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: ESP, flex: 1, minWidth: 120 }}>{t.nome}{cpm.criticas.has(t.id) && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: VERM, textTransform: 'uppercase' }}>crítica</span>}</span>
                      <span style={{ fontSize: 11, color: MUT }}>{fmt(t.inicio)} a {fmt(t.fim)} · {t.percentual}%</span>
                    </div>
                  ))}
                </div>

                <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>O que comprar — até {fmt(prox.ate)} <AjudaCampo chave="projetos.cronograma.necessidades" rota={ROTA_AJUDA} /></div>
                    {necess && necess.custo_total > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>{brl(Number(necess.custo_total))}</div>}
                  </div>
                  {falhaNecess ? (
                    <div style={{ fontSize: 12.5, color: MUT }}>Não foi possível calcular o material do período agora. Atualize a página para tentar de novo.</div>
                  ) : !necess ? (
                    <div style={{ fontSize: 12.5, color: MUT }}>Calculando…</div>
                  ) : (
                    <>
                      {necess.insumos.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: MUT }}>Nenhum material a comprar para as tarefas deste período.</div>
                      ) : necess.insumos.map((n) => (
                        <div key={n.insumo_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: `0.5px solid ${LINE}`, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: ESP, flex: 1, minWidth: 140 }}>{n.insumo}
                            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, color: MUT }}>para {n.tarefas.join(', ')}</span></span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: ESP }}>{Number(n.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {n.unidade ?? ''}</span>
                          <span style={{ fontSize: 11, color: MUT, minWidth: 92 }}>a partir de {fmt(n.a_partir_de)}</span>
                          <span style={{ fontSize: 11.5, color: ESP, minWidth: 84, textAlign: 'right' }}>{n.custo_estimado == null ? 'sem custo' : brl(Number(n.custo_estimado))}</span>
                        </div>
                      ))}
                      {(necess.tarefas_sem_item > 0 || necess.itens_sem_composicao > 0) && (
                        <div style={{ fontSize: 11.5, color: '#A57A15', marginTop: 8 }}>
                          {necess.tarefas_sem_item > 0 && `${necess.tarefas_sem_item} tarefa(s) do período sem item da obra ligado (toque em Editar e marque os itens). `}
                          {necess.itens_sem_composicao > 0 && `${necess.itens_sem_composicao} item(ns) ligado(s) sem composição de insumos no serviço.`}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {curva && (
                  <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>Curva S — planejado × realizado <AjudaCampo chave="projetos.cronograma.curva_s" rota={ROTA_AJUDA} /></div>
                    <CurvaSvg curva={curva} />
                    <div style={{ fontSize: 11, color: MUT, marginTop: 4 }}>Linha dourada: planejado acumulado{temBase ? ' (pela linha de base)' : ''}. Ponto: avanço realizado hoje.</div>
                  </div>
                )}

                <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, overflowX: 'auto' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: ESP, marginBottom: 8 }}>
                    <input type="checkbox" checked={soCriticas} onChange={(e) => setSoCriticas(e.target.checked)} style={{ width: 18, height: 18 }} />
                    Só caminho crítico <AjudaCampo chave="projetos.cronograma.so_criticas" rota={ROTA_AJUDA} />
                  </label>
                  <div style={{ minWidth: 560 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUT, marginLeft: 160, marginBottom: 6 }}>
                      <span>{janela && fmt(janela.ini)}</span><span>{janela && fmt(janela.fim)}</span>
                    </div>
                    {visiveis.map((t) => {
                      const p = predDe(t.id)
                      const atras = !!t.fim_base && t.fim > t.fim_base
                      const pt = p ? tarefas.find((x) => x.id === p.predecessora_id) : undefined
                      const conflito = !!pt && t.inicio < pt.fim
                      const critica = cpm.criticas.has(t.id), folga = cpm.folga.get(t.id) ?? 0
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: `0.5px solid ${LINE}` }}>
                          <div style={{ width: 152, flexShrink: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: ESP }}>{t.nome}{critica && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: VERM, textTransform: 'uppercase', letterSpacing: 0.4 }}>crítica</span>}</div>
                            <div style={{ fontSize: 10.5, color: MUT }}>{fmt(t.inicio)} a {fmt(t.fim)} · {t.percentual}%{p ? ` · após ${nomePorId.get(p.predecessora_id) ?? '—'}` : ''}{!critica ? ` · folga ${folga} d` : ''}</div>
                          </div>
                          <div style={{ position: 'relative', flex: 1, height: 22 }}>
                            {t.inicio_base && t.fim_base && (
                              <div title="Linha de base" style={{ position: 'absolute', top: 15, height: 4, left: `${pos(t.inicio_base)}%`, width: `${larg(t.inicio_base, t.fim_base)}%`, background: LINE, borderRadius: 2 }} />
                            )}
                            {pt && (
                              <div title={conflito ? `Começa antes de "${pt.nome}" terminar` : `Depende de "${pt.nome}"`}
                                style={{ position: 'absolute', top: 8, height: 0, left: `${Math.min(pos(pt.fim), pos(t.inicio))}%`, width: `${Math.abs(pos(t.inicio) - pos(pt.fim))}%`, borderTop: `2px dashed ${conflito ? VERM : MUT}` }} />
                            )}
                            <div style={{ position: 'absolute', top: 2, height: 12, left: `${pos(t.inicio)}%`, width: `${larg(t.inicio, t.fim)}%`, background: '#FBF4E4', border: `${critica ? 2 : 1}px solid ${atras || critica ? VERM : GOLD}`, borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ width: `${Number(t.percentual)}%`, height: '100%', background: atras ? VERM : GOLD }} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            <button onClick={() => editar(t)} style={btnMini}>Editar</button>
                            <AjudaCampo chave="projetos.cronograma.acao_editar" rota={ROTA_AJUDA} />
                            <button onClick={() => void excluir(t)} style={{ ...btnMini, color: VERM }}>Excluir</button>
                            <AjudaCampo chave="projetos.cronograma.acao_excluir" rota={ROTA_AJUDA} />
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

const rotuloSituacao = (s: Situacao, atraso: number) => s === 'atrasada' ? `atrasada ${atraso} d` : s === 'comeca' ? 'começa' : s === 'termina' ? 'termina' : 'em andamento'

const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: ESP }
const inp: React.CSSProperties = { padding: '9px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 14, color: ESP, background: '#fff', fontWeight: 400 }
const btn = (principal: boolean): React.CSSProperties => ({ padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${GOLD}`, background: principal ? GOLD : '#fff', color: principal ? '#fff' : '#A57A15' })
const btnMini: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#fff', color: ESP }

function Mini({ label, valor, cor = ESP, ajuda }: { label: string; valor: string; cor?: string; ajuda: string }) {
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: cor }}>{valor}</div>
      <div style={{ fontSize: 10, color: MUT, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label} <AjudaCampo chave={ajuda} rota={ROTA_AJUDA} /></div>
    </div>
  )
}

function CurvaSvg({ curva }: { curva: NonNullable<ReturnType<typeof curvaS>> }) {
  const W = 600, H = 180, PL = 34, PB = 20, PT = 8, PR = 8
  const t0 = new Date(curva.inicio + 'T00:00:00').getTime(), t1 = new Date(curva.fim + 'T00:00:00').getTime()
  const x = (d: string) => PL + ((new Date(d + 'T00:00:00').getTime() - t0) / Math.max(1, t1 - t0)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - v / 100) * (H - PT - PB)
  const linha = curva.pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.data).toFixed(1)},${y(p.planejado).toFixed(1)}`).join(' ')
  const h = hoje(); const hx = x(h < curva.inicio ? curva.inicio : h > curva.fim ? curva.fim : h)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Curva S do cronograma" style={{ display: 'block' }}>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={LINE} strokeWidth={0.5} /><text x={PL - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill={MUT}>{v}%</text></g>
      ))}
      <text x={PL} y={H - 5} fontSize={9} fill={MUT}>{fmt(curva.inicio)}</text>
      <text x={W - PR} y={H - 5} fontSize={9} textAnchor="end" fill={MUT}>{fmt(curva.fim)}</text>
      <path d={linha} fill="none" stroke={GOLD} strokeWidth={2} />
      <line x1={hx} x2={hx} y1={PT} y2={H - PB} stroke={MUT} strokeWidth={0.8} strokeDasharray="3 3" />
      <circle cx={hx} cy={y(curva.realizado)} r={5} fill={curva.desvio < -0.5 ? VERM : VERDE} stroke="#fff" strokeWidth={1.5} />
    </svg>
  )
}
