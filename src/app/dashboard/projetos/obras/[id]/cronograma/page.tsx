'use client'
// HB3 (fatia 2) · Cronograma da obra — tarefas, dependências, linha de base e barras no tempo.
// Lê projetos_obra_tarefa / projetos_obra_tarefa_dependencia (RLS por empresa) e grava só pelas funções com guarda (fatia 1).
// Fatia 10: itens do contrato executados em cada tarefa (projetos_obra_tarefa_item) e quadro "Compras do período"
// (fn_obra_necessidades_periodo: o que falta executar × composição do serviço, no período do quadro de próximas semanas).
// Fatia 11: histograma de mão de obra (horas apontadas por semana) e pluviometria (dias de chuva e parados do diário/RDO).
// Fatia 12: Gantt logo abaixo dos indicadores (legenda e marca de hoje), curva S com a linha de base × planejado atual
// e linha realizada (projetos_obra_tarefa_avanco: o % de cada tarefa gravado a cada dia).
// Fatia 13: reprogramar pelas dependências — sucessoras ainda não iniciadas que começam antes da predecessora terminar
// (atraso ou mudança de escopo) andam para frente mantendo a duração; grava por fn_obra_tarefa_salvar, com confirmação.
// HB4: avanço pelo diário — a quantidade executada lançada no diário (RDO) de cada OS vira o % físico da tarefa
// (src/lib/hub/avancoDiario); a tela mostra o % do diário ao lado do % do cronograma e só grava ao tocar em "Usar".
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { curvaS, curvaRealizada, type AvancoHist, type PontoRealizado } from '@/lib/hub/curvaS'
import { fisicoFinanceiro } from '@/lib/hub/fisicoFinanceiro'
import { caminhoCritico } from '@/lib/hub/caminhoCritico'
import { lookahead, type Situacao } from '@/lib/hub/lookahead'
import { histogramaObra, type ApontamentoHist, type RdoHist } from '@/lib/hub/histogramaObra'
import { reprogramar } from '@/lib/hub/reprogramar'
import { avancoPeloDiario, type OsAD, type RdoQtdAD } from '@/lib/hub/avancoDiario'

const ROTA_AJUDA = '/dashboard/projetos/obras/[id]/cronograma'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const DIA = 86400000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Tarefa = { id: string; nome: string; inicio: string; fim: string; percentual: number; inicio_base: string | null; fim_base: string | null; ordem: number; custo_previsto: number | null }
type Dep = { id: string; tarefa_id: string; predecessora_id: string; defasagem_dias: number }
type ItemObra = { id: string; descricao: string; unidade: string | null; quantidade_contratada: number; valor_contratado: number | null }
type Vinculo = { tarefa_id: string; obra_item_id: string; participacao_pct: number }
type Compra = { insumo_id: string; nome: string; unidade: string | null; quantidade: number; custo_estimado: number; tarefas: string[] }
type Compras = { insumos: Compra[]; total_estimado: number; vinculos: number; vinculos_sem_composicao: number }
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
  const [itensObra, setItensObra] = useState<ItemObra[]>([])
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  const [compras, setCompras] = useState<Compras | null>(null)
  const [apont, setApont] = useState<ApontamentoHist[]>([])
  const [rdos, setRdos] = useState<RdoHist[]>([])
  const [avancos, setAvancos] = useState<AvancoHist[]>([])
  const [osObra, setOsObra] = useState<OsAD[]>([])
  const [rdoQtd, setRdoQtd] = useState<RdoQtdAD[]>([])
  const [histFalhou, setHistFalhou] = useState(false)
  const [comprasErro, setComprasErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [soCriticas, setSoCriticas] = useState(false)
  const [semanas, setSemanas] = useState(2)
  const [falhaCarga, setFalhaCarga] = useState<string | null>(null) // carga falhou: não mostra o estado vazio junto

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
    const it = await supabase.from('projetos_obra_item').select('id,descricao,unidade,quantidade_contratada,valor_contratado')
      .eq('obra_id', id).is('excluido_em', null).order('ordem')
    let v: Vinculo[] = []
    if (!it.error && ids.length > 0) {
      const rv = await supabase.from('projetos_obra_tarefa_item').select('tarefa_id,obra_item_id,participacao_pct')
        .in('tarefa_id', ids).is('excluido_em', null)
      if (!rv.error) v = (rv.data ?? []) as Vinculo[]
    }
    // histograma: falha aqui não derruba o cronograma, só avisa no quadro
    const [ap, rd, av, os, rq] = await Promise.all([
      supabase.from('projetos_obra_mao_obra_apontamento').select('data,horas').eq('obra_id', id).is('excluido_em', null),
      supabase.from('projetos_obra_rdo').select('data,clima,praticavel').eq('obra_id', id).is('excluido_em', null),
      supabase.from('projetos_obra_tarefa_avanco').select('tarefa_id,data,percentual').eq('obra_id', id).order('data'),
      supabase.from('projetos_obra_os').select('id,tarefa_id,obra_item_id').eq('obra_id', id).is('excluido_em', null).neq('status', 'cancelada'),
      // consulta à parte: sem a coluna (banco antes da migration) o quadro só não aparece, o histograma segue
      supabase.from('projetos_obra_rdo').select('os_id,quantidade_executada').eq('obra_id', id).is('excluido_em', null).not('quantidade_executada', 'is', null),
    ])
    setOsObra(os.error ? [] : (os.data ?? []) as OsAD[]); setRdoQtd(os.error || rq.error ? [] : (rq.data ?? []) as RdoQtdAD[])
    setAvancos(av.error ? [] : (av.data ?? []) as AvancoHist[]) // sem histórico: a curva volta a mostrar só o ponto de hoje
    setApont(ap.error ? [] : (ap.data ?? []) as ApontamentoHist[]); setRdos(rd.error ? [] : (rd.data ?? []) as RdoHist[]); setHistFalhou(!!(ap.error || rd.error))
    setTarefas(lista); setDeps(d); setItensObra(it.error ? [] : (it.data ?? []) as ItemObra[]); setVinculos(v); setLoading(false)
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
  const realizada = useMemo(() => (curva ? curvaRealizada(tarefas, avancos, curva.pontos, hoje()) : []), [tarefas, avancos, curva])
  const ff = useMemo(() => fisicoFinanceiro(tarefas, hoje()), [tarefas])
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const cpm = useMemo(() => caminhoCritico(tarefas, deps), [tarefas, deps])
  const reprog = useMemo(() => reprogramar(tarefas, deps), [tarefas, deps])
  const prox = useMemo(() => lookahead(tarefas, hoje(), semanas * 7), [tarefas, semanas])
  const hist = useMemo(() => histogramaObra(apont, rdos, janela), [apont, rdos, janela])
  const peloDiario = useMemo(() => avancoPeloDiario(tarefas, itensObra, vinculos, osObra, rdoQtd), [tarefas, itensObra, vinculos, osObra, rdoQtd])

  // compras do período: mesmo recorte do quadro "Próximas semanas" (hoje até prox.ate)
  useEffect(() => {
    if (!UUID.test(id) || loading || falhaCarga) return
    let vivo = true
    void supabase.rpc('fn_obra_necessidades_periodo', { p_obra_id: id, p_de: hoje(), p_ate: prox.ate }).then((r) => {
      if (!vivo) return
      if (r.error) { setCompras(null); setComprasErro(erroAmigavel(r.error)); return }
      setComprasErro(null); setCompras(r.data as Compras)
    })
    return () => { vivo = false }
  }, [id, prox.ate, loading, falhaCarga, vinculos])
  const itensDaTarefa = useCallback((tid: string) => vinculos.filter((v) => v.tarefa_id === tid), [vinculos])
  // participação do item já usada pelas OUTRAS tarefas (a soma não passa de 100%)
  const usadoFora = useCallback((itemId: string, tid: string | null) =>
    vinculos.filter((v) => v.obra_item_id === itemId && v.tarefa_id !== tid).reduce((s, v) => s + Number(v.participacao_pct), 0), [vinculos])
  const visiveis = soCriticas ? tarefas.filter((t) => cpm.criticas.has(t.id)) : tarefas
  const temBase = tarefas.some((t) => t.fim_base)
  const atrasadas = tarefas.filter((t) => t.fim_base && t.fim > t.fim_base).length

  function editar(t: Tarefa) {
    const p = predDe(t.id)
    const itens = Object.fromEntries(itensDaTarefa(t.id).map((v) => [v.obra_item_id, String(Number(v.participacao_pct))]))
    setForm({ id: t.id, nome: t.nome, inicio: t.inicio, fim: t.fim, percentual: String(t.percentual), predecessora: p?.predecessora_id ?? '', defasagem: String(p?.defasagem_dias ?? 0), custo: t.custo_previsto == null ? '' : String(t.custo_previsto), itens })
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
    const itens = Object.entries(form.itens).map(([obra_item_id, v]) => ({ obra_item_id, participacao_pct: Number(v.replace(',', '.')) }))
    if (itens.some((x) => !Number.isFinite(x.participacao_pct) || x.participacao_pct <= 0 || x.participacao_pct > 100)) { setErro('A participação de cada item deve ficar entre 1 e 100%.'); return }
    const estouro = itens.find((x) => x.participacao_pct + usadoFora(x.obra_item_id, form.id) > 100)
    if (estouro) { setErro(`O item "${itensObra.find((i) => i.id === estouro.obra_item_id)?.descricao ?? ''}" passaria de 100% somando as tarefas.`); return }
    setSalvando(true); setErro(null); setAviso(null)
    const dados: Record<string, unknown> = { nome: form.nome.trim(), inicio: form.inicio, fim: form.fim, percentual: pct }
    if (form.id) dados.id = form.id; else dados.ordem = tarefas.length
    const r = await supabase.rpc('fn_obra_tarefa_salvar', { p_obra_id: id, p_dados: dados })
    if (r.error) { setSalvando(false); setErro(erroAmigavel(r.error)); return }
    const tid = (r.data as { id: string }).id
    const cr = await supabase.rpc('fn_obra_tarefa_custo_salvar', { p_id: tid, p_custo: custo })
    if (cr.error) { setSalvando(false); setErro(erroAmigavel(cr.error)); await carregar(); return }
    const mudouItens = !!form.id || itens.length > 0
    if (mudouItens) {
      const ir = await supabase.rpc('fn_obra_tarefa_itens_salvar', { p_tarefa_id: tid, p_itens: itens })
      if (ir.error) { setSalvando(false); setErro(erroAmigavel(ir.error)); await carregar(); return }
    }
    if (form.predecessora) {
      const dr = await supabase.rpc('fn_obra_tarefa_dependencia_salvar', { p_tarefa_id: tid, p_predecessora_id: form.predecessora, p_defasagem: Number(form.defasagem) || 0 })
      if (dr.error) {
        const ciclo = dr.error.message === 'Dependência circular'
        setSalvando(false); setErro(ciclo ? 'Essa dependência cria um ciclo: a predecessora já depende desta tarefa.' : erroAmigavel(dr.error)); await carregar(); return
      }
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

  async function aplicarReprogramacao() {
    if (reprog.length === 0) return
    if (!window.confirm(`Reprogramar ${reprog.length} tarefa(s) pelas dependências? Cada uma passa a começar depois da predecessora, com a mesma duração. A linha de base não muda.`)) return
    setSalvando(true); setErro(null); setAviso(null)
    for (const m of reprog) {
      const t = tarefas.find((x) => x.id === m.id)
      if (!t) continue
      const r = await supabase.rpc('fn_obra_tarefa_salvar', { p_obra_id: id, p_dados: { id: m.id, nome: t.nome, inicio: m.para.inicio, fim: m.para.fim, percentual: t.percentual } })
      if (r.error) { setSalvando(false); setErro(`Parou em "${m.nome}": ${erroAmigavel(r.error)}`); await carregar(); return }
    }
    setSalvando(false); setAviso(`${reprog.length} tarefa(s) reprogramada(s) pelas dependências.`); await carregar()
  }

  async function usarAvancoDiario(tid: string, pct: number) {
    const t = tarefas.find((x) => x.id === tid)
    if (!t) return
    if (!window.confirm(`Passar o avanço de "${t.nome}" de ${Number(t.percentual)}% para ${pct}%, como mostra o diário de obra?`)) return
    setSalvando(true); setErro(null); setAviso(null)
    const r = await supabase.rpc('fn_obra_tarefa_salvar', { p_obra_id: id, p_dados: { id: t.id, nome: t.nome, inicio: t.inicio, fim: t.fim, percentual: pct } })
    setSalvando(false)
    if (r.error) { setErro(erroAmigavel(r.error)); return }
    setAviso(`Avanço de "${t.nome}" atualizado para ${pct}% pelo diário.`); await carregar()
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
  const hojeX = janela && hoje() >= janela.ini && hoje() <= janela.fim ? pos(hoje()) : null

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
                <fieldset style={{ gridColumn: '1 / -1', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '8px 10px', margin: 0 }}>
                  <legend style={{ ...lbl, flexDirection: 'row', alignItems: 'center', padding: '0 4px' }}>Itens executados nesta tarefa <AjudaCampo chave="projetos.cronograma.itens_tarefa" rota={ROTA_AJUDA} /></legend>
                  {itensObra.length === 0 ? (
                    <div style={{ fontSize: 12, color: MUT }}>Esta obra ainda não tem itens de contrato. Eles vêm do orçamento aprovado.</div>
                  ) : itensObra.map((it) => {
                    const marcado = it.id in form.itens
                    const livre = Math.max(0, 100 - usadoFora(it.id, form.id))
                    return (
                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ESP, flex: 1, minWidth: 180 }}>
                          <input type="checkbox" checked={marcado} disabled={!marcado && livre <= 0} style={{ width: 18, height: 18 }}
                            onChange={(e) => {
                              const itens = { ...form.itens }
                              if (e.target.checked) itens[it.id] = String(livre); else delete itens[it.id]
                              setForm({ ...form, itens })
                            }} />
                          {it.descricao} <span style={{ color: MUT, fontSize: 11 }}>· {Number(it.quantidade_contratada).toLocaleString('pt-BR')} {it.unidade ?? ''}</span>
                          <AjudaCampo chave="projetos.cronograma.itens_tarefa" rota={ROTA_AJUDA} />
                        </label>
                        {marcado && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: ESP }}>
                            <input aria-label={`Participação de ${it.descricao} (%)`} inputMode="decimal" value={form.itens[it.id]} style={{ ...inp, width: 70, padding: '6px 8px' }}
                              onChange={(e) => setForm({ ...form, itens: { ...form.itens, [it.id]: e.target.value } })} />% <span style={{ color: MUT, fontSize: 11 }}>(livre {livre}%)</span>
                            <AjudaCampo chave="projetos.cronograma.participacao_item" rota={ROTA_AJUDA} />
                          </span>
                        )}
                      </div>
                    )
                  })}
                </fieldset>
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

                {reprog.length > 0 && (
                  <div style={{ background: '#FFF8EC', border: `1px solid ${GOLD}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Reprogramar pelas dependências <AjudaCampo chave="projetos.cronograma.reprogramar" rota={ROTA_AJUDA} /></div>
                      <button onClick={() => void aplicarReprogramacao()} disabled={salvando} style={btn(true)}>{salvando ? 'Reprogramando…' : `Reprogramar ${reprog.length} tarefa(s)`}</button>
                    </div>
                    <div style={{ fontSize: 12, color: MUT, margin: '6px 0 4px' }}>Estas tarefas ainda não começaram e estão marcadas para antes de a predecessora terminar. Ao reprogramar, cada uma anda para frente com a mesma duração:</div>
                    {reprog.map((m) => (
                      <div key={m.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12.5, color: ESP, padding: '5px 0', borderTop: `0.5px solid ${LINE}` }}>
                        <span style={{ fontWeight: 600, flex: 1, minWidth: 140 }}>{m.nome}</span>
                        <span style={{ color: MUT }}>{fmt(m.de.inicio)} a {fmt(m.de.fim)}</span>
                        <span>→ {fmt(m.para.inicio)} a {fmt(m.para.fim)}</span>
                        <span style={{ color: VERM, fontWeight: 700 }}>+{m.dias} d</span>
                      </div>
                    ))}
                  </div>
                )}

                {peloDiario.length > 0 && (
                  <div data-testid="cronograma-avanco-diario" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Avanço pelo diário de obra <AjudaCampo chave="projetos.cronograma.avanco_diario" rota={ROTA_AJUDA} /></div>
                    <div style={{ fontSize: 12, color: MUT, margin: '6px 0 4px' }}>Quanto a equipe lançou como executado no diário (RDO) das OS de cada tarefa, comparado ao avanço do cronograma:</div>
                    {peloDiario.map((a) => {
                      const igual = Math.round(a.atual) === a.pct
                      return (
                        <div key={a.tarefa_id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5, color: ESP, padding: '6px 0', borderTop: `0.5px solid ${LINE}` }}>
                          <span style={{ fontWeight: 600, flex: 1, minWidth: 140 }}>{nomePorId.get(a.tarefa_id) ?? '—'}</span>
                          <span style={{ color: MUT }}>cronograma {Number(a.atual).toFixed(0)}%</span>
                          <span style={{ fontWeight: 700, color: igual ? VERDE : a.pct < a.atual ? VERM : GOLD }}>diário {a.pct}%</span>
                          <span style={{ fontSize: 11, color: MUT }}>{a.diarios} {a.diarios === 1 ? 'dia' : 'dias'}</span>
                          {igual ? <span style={{ fontSize: 11, color: VERDE, fontWeight: 600 }}>em dia</span> : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <button onClick={() => void usarAvancoDiario(a.tarefa_id, a.pct)} disabled={salvando} style={btnMini}>Usar {a.pct}%</button>
                              <AjudaCampo chave="projetos.cronograma.avanco_diario_usar" rota={ROTA_AJUDA} />
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14, overflowX: 'auto' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Tarefas no tempo (Gantt) <AjudaCampo chave="projetos.cronograma.gantt" rota={ROTA_AJUDA} /></div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: ESP }}>
                    <input type="checkbox" checked={soCriticas} onChange={(e) => setSoCriticas(e.target.checked)} style={{ width: 18, height: 18 }} />
                    Só caminho crítico <AjudaCampo chave="projetos.cronograma.so_criticas" rota={ROTA_AJUDA} />
                  </label>
                  </div>
                  <LegendaGantt />
                  <div style={{ minWidth: 560 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUT, marginLeft: 160, marginBottom: 6 }}>
                      <span>{janela && fmt(janela.ini)}</span>{hojeX !== null && <span style={{ color: ESP, fontWeight: 600 }}>hoje {fmt(hoje())}</span>}<span>{janela && fmt(janela.fim)}</span>
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
                            {hojeX !== null && <div aria-hidden style={{ position: 'absolute', top: -6, bottom: -6, left: `${hojeX}%`, borderLeft: `1px dashed ${MUT}` }} />}
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
                    <div style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Compras do período — até {fmt(prox.ate)} <AjudaCampo chave="projetos.cronograma.compras" rota={ROTA_AJUDA} /></div>
                    {compras && compras.insumos.length > 0 && (
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: ESP }}>{brl(Number(compras.total_estimado))} <span style={{ fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.4 }}>estimado</span> <AjudaCampo chave="projetos.cronograma.compras_custo" rota={ROTA_AJUDA} /></div>
                    )}
                  </div>
                  {comprasErro ? (
                    <div role="alert" style={{ fontSize: 12.5, color: VERM }}>{comprasErro}</div>
                  ) : !compras ? (
                    <div style={{ fontSize: 12.5, color: MUT }}>Calculando…</div>
                  ) : compras.vinculos === 0 ? (
                    <div style={{ fontSize: 12.5, color: MUT }}>Nenhuma tarefa tem itens ligados. Toque em &quot;Editar&quot; numa tarefa e marque os itens que ela executa.</div>
                  ) : compras.insumos.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: MUT }}>Nada a comprar neste período: as tarefas com itens já terminaram ou começam depois.</div>
                  ) : compras.insumos.map((c) => (
                    <div key={c.insumo_id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderTop: `0.5px solid ${LINE}`, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: ESP, flex: 1, minWidth: 140 }}>{c.nome}<span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, color: MUT }}>{c.tarefas.join(' · ')}</span></span>
                      <span style={{ fontSize: 12.5, color: ESP, fontVariantNumeric: 'tabular-nums' }}>{Number(c.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {c.unidade ?? ''}</span>
                      <span style={{ fontSize: 12, color: MUT, minWidth: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{brl(Number(c.custo_estimado))}</span>
                    </div>
                  ))}
                  {compras && compras.vinculos_sem_composicao > 0 && (
                    <div style={{ fontSize: 11, color: '#A57A15', marginTop: 6 }}>{compras.vinculos_sem_composicao} item(ns) ligado(s) sem composição de insumos no serviço: não entram na conta.</div>
                  )}
                </div>

                {curva && (
                  <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>Curva S — planejado × realizado <AjudaCampo chave="projetos.cronograma.curva_s" rota={ROTA_AJUDA} /></div>
                    <CurvaSvg curva={curva} realizada={realizada} />
                    <div style={{ fontSize: 11, color: MUT, marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                      <span>{curva.temBase ? 'Linha dourada: planejado pela linha de base. Linha tracejada: planejado pelas datas atuais (reprogramado); a distância entre as duas é o quanto o cronograma escorregou.' : 'Linha dourada: planejado acumulado. Fixe a linha de base para comparar com as datas reprogramadas.'} {realizada.length > 1 ? 'Linha verde: avanço realizado de cada semana até hoje.' : 'Ponto: avanço realizado hoje (a linha realizada aparece conforme o % das tarefas é atualizado).'}</span>
                      <AjudaCampo chave="projetos.cronograma.curva_realizada" rota={ROTA_AJUDA} />
                    </div>
                  </div>
                )}

                <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 8 }}>Mão de obra e clima por semana <AjudaCampo chave="projetos.cronograma.histograma" rota={ROTA_AJUDA} /></div>
                  {histFalhou && <div role="alert" style={{ fontSize: 12, color: VERM, marginBottom: 6 }}>Não foi possível ler os apontamentos ou o diário desta obra. Atualize a página.</div>}
                  {!hist ? (
                    <div style={{ fontSize: 12.5, color: MUT }}>Nenhuma hora apontada nem diário (RDO) nesta obra ainda. Aponte as horas da equipe na OS de obra ou na tela de horas.</div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 10 }}>
                        <Mini label="Horas apontadas" valor={`${hist.totalHoras.toLocaleString('pt-BR')} h`} ajuda="projetos.cronograma.ind_horas" />
                        <Mini label="Pico semanal" valor={`${hist.picoHoras.toLocaleString('pt-BR')} h`} ajuda="projetos.cronograma.ind_pico" />
                        <Mini label="Dias de chuva" valor={hist.diasRdo > 0 ? String(hist.diasChuva) : '—'} cor={hist.diasChuva > 0 ? '#2563EB' : ESP} ajuda="projetos.cronograma.ind_chuva" />
                        <Mini label="Dias parados" valor={hist.diasRdo > 0 ? String(hist.diasParados) : '—'} cor={hist.diasParados > 0 ? VERM : ESP} ajuda="projetos.cronograma.ind_parados" />
                      </div>
                      <Histograma hist={hist} />
                      <div style={{ fontSize: 11, color: MUT, marginTop: 4 }}>Barra: horas apontadas na semana (equipe média = horas ÷ 40). Número azul (ch): dias de chuva no diário; traço vermelho: dias em que não deu para trabalhar.{hist.diasRdo === 0 ? ' Sem diário (RDO) nesta obra: o clima aparece quando a equipe registrar o dia na OS de obra.' : ''}</div>
                    </>
                  )}
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

function LegendaGantt() {
  const item = (amostra: React.ReactNode, texto: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUT }}>{amostra}{texto}</span>
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 10 }}>
      {item(<span style={{ width: 22, height: 10, borderRadius: 3, border: `1px solid ${GOLD}`, background: `linear-gradient(90deg, ${GOLD} 50%, #FBF4E4 50%)` }} />, 'prazo atual · parte cheia = avanço')}
      {item(<span style={{ width: 22, height: 4, borderRadius: 2, background: LINE }} />, 'linha de base')}
      {item(<span style={{ width: 22, height: 10, borderRadius: 3, border: `2px solid ${VERM}`, background: '#FBF4E4' }} />, 'crítica ou fora da base')}
      {item(<span style={{ width: 22, borderTop: `2px dashed ${MUT}` }} />, 'depende de')}
      {item(<span style={{ height: 12, borderLeft: `1px dashed ${MUT}` }} />, 'hoje')}
    </div>
  )
}

function Histograma({ hist }: { hist: NonNullable<ReturnType<typeof histogramaObra>> }) {
  const H = 110, max = Math.max(1, hist.picoHoras)
  return (
    <div style={{ overflowX: 'auto' }}>
      <div role="img" aria-label="Histograma de horas apontadas por semana" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, minWidth: hist.semanas.length * 30, paddingTop: 16 }}>
        {hist.semanas.map((s) => (
          <div key={s.semana} title={`Semana de ${fmt(s.semana)}: ${s.horas.toLocaleString('pt-BR')} h (equipe média ${s.equipe.toLocaleString('pt-BR')})${s.diasRdo ? ` · ${s.diasChuva} dia(s) de chuva · ${s.diasParados} parado(s)` : ''}`}
            style={{ flex: 1, minWidth: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 9.5, color: MUT, fontVariantNumeric: 'tabular-nums' }}>{s.horas > 0 ? s.horas.toLocaleString('pt-BR') : ''}</span>
            <div style={{ width: '100%', height: H, display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ width: '100%', height: `${(s.horas / max) * 100}%`, minHeight: s.horas > 0 ? 2 : 0, background: GOLD, borderRadius: '3px 3px 0 0' }} />
            </div>
            <span style={{ fontSize: 9.5, color: '#2563EB', minHeight: 12 }}>{s.diasChuva > 0 ? `${s.diasChuva} ch` : ''}</span>
            <div style={{ width: '100%', height: 3, background: s.diasParados > 0 ? VERM : 'transparent', borderRadius: 2 }} />
            <span style={{ fontSize: 9, color: MUT, whiteSpace: 'nowrap' }}>{fmt(s.semana).slice(0, 5)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CurvaSvg({ curva, realizada }: { curva: NonNullable<ReturnType<typeof curvaS>>; realizada: PontoRealizado[] }) {
  const W = 600, H = 180, PL = 34, PB = 20, PT = 8, PR = 8
  const t0 = new Date(curva.inicio + 'T00:00:00').getTime(), t1 = new Date(curva.fim + 'T00:00:00').getTime()
  const x = (d: string) => PL + ((new Date(d + 'T00:00:00').getTime() - t0) / Math.max(1, t1 - t0)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - v / 100) * (H - PT - PB)
  const caminho = (v: (p: (typeof curva.pontos)[number]) => number) => curva.pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.data).toFixed(1)},${y(v(p)).toFixed(1)}`).join(' ')
  const linha = caminho((p) => p.planejado), atual = caminho((p) => p.atual)
  const lim = (d: string) => (d < curva.inicio ? curva.inicio : d > curva.fim ? curva.fim : d)
  const h = hoje(); const hx = x(lim(h))
  const linhaReal = realizada.length > 1 ? realizada.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(lim(p.data)).toFixed(1)},${y(p.realizado).toFixed(1)}`).join(' ') : null
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Curva S do cronograma" style={{ display: 'block' }}>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={LINE} strokeWidth={0.5} /><text x={PL - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill={MUT}>{v}%</text></g>
      ))}
      <text x={PL} y={H - 5} fontSize={9} fill={MUT}>{fmt(curva.inicio)}</text>
      <text x={W - PR} y={H - 5} fontSize={9} textAnchor="end" fill={MUT}>{fmt(curva.fim)}</text>
      {curva.temBase && <path d={atual} fill="none" stroke={ESP} strokeWidth={1.5} strokeDasharray="5 4" />}
      <path d={linha} fill="none" stroke={GOLD} strokeWidth={2} />
      {linhaReal && <path d={linhaReal} fill="none" stroke={VERDE} strokeWidth={2} />}
      <line x1={hx} x2={hx} y1={PT} y2={H - PB} stroke={MUT} strokeWidth={0.8} strokeDasharray="3 3" />
      <circle cx={hx} cy={y(curva.realizado)} r={5} fill={curva.desvio < -0.5 ? VERM : VERDE} stroke="#fff" strokeWidth={1.5} />
    </svg>
  )
}
