'use client'
// Engenharia · Take-off MANUAL (Hub Projetos). RD-26: NÃO recria o motor — liga às MESMAS RPCs/views
// do Takeoff por IA (takeoff/page.tsx). A única diferença é a ENTRADA: aqui o ambiente é digitado à mão
// (sem upload de DWG/planta). Fluxo em 3 passos: (1) novo take-off → (2) ambientes+áreas+serviços →
// (3) gerar orçamento e ver o BOM/mão-de-obra sair sozinho. RD-98: lista real de take-offs, editar/excluir rastreável
// (soft-delete) de take-off e de ambiente, e quantitativo previsto na hora (sem precisar gerar o orçamento).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ruler, Plus, Check, Sparkles, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

function useEmpresaSelecionada(): { companyId: string | null } {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setCompanyId(read())
    const t = setInterval(() => { const v = read(); setCompanyId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return { companyId }
}

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const money = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null)

type Orc = { id: string; numero: string | null; cliente_nome: string | null; status: string }
type Servico = { id: string; codigo: string | null; nome: string; unidade: string | null; custo_unitario_total: number | null }
type Planta = { id: string; nome: string; status: string; created_at: string }
type PlantaLinha = Planta & { orcamento_id: string | null; orcamento_numero: string | null; cliente_nome: string | null; n_ambientes: number; n_prontos: number; area_total: number; servicos: string[] }
type BaseCalc = 'area' | 'perimetro' | 'pe_direito_parede'
type Ambiente = {
  id: string; nome: string; area_m2: number | null; perimetro_ml: number | null; pe_direito_m: number | null
  confirmado: boolean; servico_id: string | null; base_calculo: BaseCalc
}
type ItemGerado = { id: string; produto_nome: string | null; servico_descricao: string | null; unidade: string | null; quantidade: number | null; preco_unitario: number | null; subtotal: number | null }
type BomRow = { servico_id: string; servico_nome: string | null; tipo: string | null; item_nome: string | null; item_categoria: string | null; quantidade: number | null; unidade: string | null; custo_unitario: number | null; custo_total: number | null }

// quantidade "explodida" de um ambiente conforme a base de cálculo — MESMA regra do fn_takeoff_gerar_orcamento.
function qtdAmbiente(a: Ambiente): number {
  if (a.base_calculo === 'perimetro') return a.perimetro_ml ?? 0
  if (a.base_calculo === 'pe_direito_parede') return (a.perimetro_ml ?? 0) * (a.pe_direito_m ?? 0)
  return a.area_m2 ?? 0
}

export default function EngenhariaPage() {
  const { companyId } = useEmpresaSelecionada()
  const [orcamentos, setOrcamentos] = useState<Orc[]>([])
  const [orcId, setOrcId] = useState('')
  const [servicos, setServicos] = useState<Servico[]>([])
  const [plantas, setPlantas] = useState<PlantaLinha[]>([])
  const [carregouLista, setCarregouLista] = useState(false)
  const [editar, setEditar] = useState<PlantaLinha | null>(null)
  const [edNome, setEdNome] = useState('')
  const [edOrc, setEdOrc] = useState('')
  const [excluirP, setExcluirP] = useState<PlantaLinha | null>(null)
  const [excluirA, setExcluirA] = useState<Ambiente | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [salvandoAcao, setSalvandoAcao] = useState(false)
  const [planta, setPlanta] = useState<Planta | null>(null)
  const [ambientes, setAmbientes] = useState<Ambiente[]>([])
  const [itensGerados, setItensGerados] = useState<ItemGerado[]>([])
  const [bom, setBom] = useState<BomRow[]>([])
  const [addAberto, setAddAberto] = useState(false)
  const [novoAberto, setNovoAberto] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // Catálogo (dropdowns) + orçamentos de destino + take-offs existentes p/ retomar.
  const recarregarPlantas = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase.rpc('fn_takeoff_plantas_listar', { p_company_id: companyId })
    const j = data as { ok?: boolean; itens?: PlantaLinha[] } | null
    if (error || !j?.ok) { setErro('Não deu para carregar os take-offs agora. Tente de novo.'); setCarregouLista(true); return }
    setPlantas(j.itens ?? [])
    setCarregouLista(true)
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    let alive = true
    ;(async () => {
      const { data: o } = await supabase.from('erp_orcamentos').select('id,numero,cliente_nome,status')
        .eq('company_id', companyId).in('status', ['rascunho', 'enviado', 'aprovado']).order('created_at', { ascending: false }).limit(50)
      const { data: s } = await supabase.from('v_projetos_servicos_catalogo').select('id,codigo,nome,unidade,custo_unitario_total')
        .eq('ativo', true).order('nome').limit(500)
      if (!alive) return
      setOrcamentos((o as Orc[]) ?? [])
      setServicos((s as Servico[]) ?? [])
    })()
    void recarregarPlantas()
    return () => { alive = false }
  }, [companyId, recarregarPlantas])

  const recarregarAmbientes = useCallback(async (plantaId: string) => {
    const { data } = await supabase.from('erp_obra_planta_ambiente')
      .select('id,nome,area_m2,perimetro_ml,pe_direito_m,confirmado,servico_id,base_calculo')
      .eq('planta_id', plantaId).is('deleted_at', null).order('nome')
    setAmbientes((data as Ambiente[]) ?? [])
  }, [])

  const abrirPlanta = async (p: Planta & { orcamento_id?: string | null }) => {
    setPlanta(p); setItensGerados([]); setBom([]); setErro(null); setMsg(null)
    if (p.orcamento_id) setOrcId(p.orcamento_id)
    await recarregarAmbientes(p.id)
  }

  // Quantitativo previsto: BOM dos serviços vinculados aos ambientes confirmados, atualizado a cada mudança (sem gerar o orçamento).
  const servicosUsados = useMemo(
    () => Array.from(new Set(ambientes.filter((a) => a.confirmado && a.servico_id).map((a) => a.servico_id as string))).sort().join(','),
    [ambientes],
  )
  useEffect(() => {
    let alive = true
    if (!servicosUsados) { setBom([]); return }
    ;(async () => {
      const { data } = await supabase.from('v_projetos_bom_completo')
        .select('servico_id,servico_nome,tipo,item_nome,item_categoria,quantidade,unidade,custo_unitario,custo_total')
        .in('servico_id', servicosUsados.split(',')).order('servico_nome')
      if (alive) setBom((data as BomRow[]) ?? [])
    })()
    return () => { alive = false }
  }, [servicosUsados])

  // RD-98 p2/p4 · editar o take-off e excluir (take-off ou ambiente) por soft-delete rastreável.
  const salvarEdicao = async () => {
    if (!editar) return
    setSalvandoAcao(true); setErroAcao(null)
    const { data, error } = await supabase.rpc('fn_takeoff_planta_editar', { p_planta_id: editar.id, p_nome: edNome, p_orcamento_id: edOrc || null })
    setSalvandoAcao(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setErroAcao(j?.erro ?? error?.message ?? 'Falha ao salvar'); return }
    if (edOrc) setOrcId(edOrc)
    if (planta?.id === editar.id) setPlanta({ ...planta, nome: edNome.trim() || planta.nome })
    setEditar(null); setMsg('Take-off atualizado.')
    await recarregarPlantas()
  }
  const confirmarExcluir = async () => {
    if (!excluirP && !excluirA) return
    setSalvandoAcao(true); setErroAcao(null)
    const { data, error } = excluirP
      ? await supabase.rpc('fn_takeoff_planta_excluir', { p_planta_id: excluirP.id, p_motivo: motivo || null })
      : await supabase.rpc('fn_takeoff_ambiente_excluir', { p_ambiente_id: excluirA!.id, p_motivo: motivo || null })
    setSalvandoAcao(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setErroAcao(j?.erro ?? error?.message ?? 'Falha ao excluir'); return }
    if (excluirP) {
      if (planta?.id === excluirP.id) { setPlanta(null); setAmbientes([]); setItensGerados([]); setBom([]) }
      setMsg(`Take-off “${excluirP.nome}” excluído (fica registrado na auditoria).`); setExcluirP(null)
    } else {
      setMsg('Ambiente excluído (fica registrado na auditoria).'); setExcluirA(null)
      if (planta) await recarregarAmbientes(planta.id)
    }
    setMotivo('')
    await recarregarPlantas()
  }

  // Sugere o serviço de cada ambiente sem serviço, por palavra-chave da empresa (IA sugere, humano confirma).
  const sugerir = async () => {
    if (!companyId || !planta) return
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_takeoff_sugerir_servicos', { p_company_id: companyId, p_planta_id: planta.id })
      if (error) throw error
      const j = data as { ok?: boolean; erro?: string; sugeridos?: number } | null
      if (!j?.ok) { setErro(j?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (j?.erro ?? 'Falha ao sugerir serviços.')); return }
      await recarregarAmbientes(planta.id)
      setMsg((j.sugeridos ?? 0) > 0
        ? `${j.sugeridos} ambiente(s) receberam serviço sugerido — a base de cálculo foi ajustada pela unidade. Confira e confirme (a IA sugere, você confirma).`
        : 'Nenhuma sugestão encontrada. Cadastre palavras-chave dos serviços no Catálogo (ex.: "sala" → Forro).')
    } catch (e) { setErro((e as Error).message || String(e)) } finally { setBusy(false) }
  }

  // Passo 1 · novo take-off manual (sem DWG). fn_takeoff_planta_salvar aceita arquivo 'manual'.
  const novoTakeoff = async () => {
    if (!companyId) return
    const nome = novoNome.trim()
    if (!nome) return
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_takeoff_planta_salvar', {
        p_company_id: companyId, p_nome: nome, p_arquivo_path: 'manual', p_arquivo_tipo: 'manual',
        p_orcamento_id: orcId || null, p_escala: null, p_arquivo_hash: null,
      })
      if (error) throw error
      const id = data as string
      await recarregarPlantas()
      await abrirPlanta({ id, nome, status: 'rascunho', created_at: new Date(0).toISOString() })
      setNovoAberto(false); setNovoNome('')
      setMsg('Take-off criado. Adicione ambientes e vincule serviços.')
    } catch (e) { setErro((e as Error).message || String(e)) } finally { setBusy(false) }
  }

  // Passo 2 · atualizar ambiente (serviço, base, confirmar, medidas) — mesma RPC do takeoff IA.
  const atualizarAmb = async (a: Ambiente, patch: Partial<Ambiente>) => {
    const next = { ...a, ...patch }
    setAmbientes((prev) => prev.map((x) => (x.id === a.id ? next : x)))
    if (!companyId) return
    await supabase.rpc('fn_takeoff_ambiente_atualizar', {
      p_company_id: companyId, p_id: a.id,
      p_nome: next.nome, p_area_m2: next.area_m2, p_perimetro_ml: next.perimetro_ml, p_pe_direito_m: next.pe_direito_m,
      p_servico_id: next.servico_id, p_base_calculo: next.base_calculo, p_confirmado: next.confirmado,
    })
    // Ao trocar o serviço, o trigger ajusta a base pela unidade — reflete o valor REAL do banco (RD-51).
    if ('servico_id' in patch) {
      const { data } = await supabase.from('erp_obra_planta_ambiente').select('base_calculo').eq('id', a.id).single()
      const base = (data as { base_calculo?: BaseCalc } | null)?.base_calculo
      if (base) setAmbientes((prev) => prev.map((x) => (x.id === a.id ? { ...x, base_calculo: base } : x)))
    }
  }

  const adicionarAmbiente = async (form: { nome: string; area_m2: string; largura_m: string; comprimento_m: string; perimetro_ml: string; pe_direito_m: string }) => {
    if (!companyId || !planta) return
    setBusy(true); setErro(null)
    try {
      const { error } = await supabase.rpc('fn_takeoff_ambiente_criar_manual', {
        p_company_id: companyId, p_planta_id: planta.id, p_nome: form.nome.trim() || 'Ambiente',
        p_area_m2: num(form.area_m2), p_largura_m: num(form.largura_m), p_comprimento_m: num(form.comprimento_m),
        p_perimetro_ml: num(form.perimetro_ml), p_pe_direito_m: num(form.pe_direito_m),
      })
      if (error) throw error
      setAddAberto(false)
      await recarregarAmbientes(planta.id)
      setMsg('Ambiente adicionado. Vincule um serviço e confirme.')
    } catch (e) { setErro((e as Error).message || String(e)) } finally { setBusy(false) }
  }

  // Passo 3 · o clímax: explode ambientes × serviços no orçamento, depois mostra o resultado + BOM.
  const gerar = async () => {
    if (!companyId || !planta) return
    if (!orcId) { setErro('Selecione um orçamento de destino no topo.'); return }
    const prontos = ambientes.filter((a) => a.confirmado && a.servico_id)
    if (prontos.length === 0) { setErro('Confirme ao menos 1 ambiente com serviço vinculado.'); return }
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_takeoff_gerar_orcamento', {
        p_company_id: companyId, p_planta_id: planta.id, p_orcamento_id: orcId,
      })
      if (error) throw error
      // Resultado real (linhas geradas no orçamento) + BOM/mão-de-obra dos serviços usados.
      const usados = Array.from(new Set(prontos.map((a) => a.servico_id).filter(Boolean))) as string[]
      const [{ data: itens }, { data: bomRows }] = await comPrazo(() => Promise.all([
        supabase.from('erp_orcamentos_itens')
          .select('id,produto_nome,servico_descricao,unidade,quantidade,preco_unitario,subtotal')
          .eq('orcamento_id', orcId).eq('company_id', companyId).order('ordem'),
        supabase.from('v_projetos_bom_completo')
          .select('servico_id,servico_nome,tipo,item_nome,item_categoria,quantidade,unidade,custo_unitario,custo_total')
          .in('servico_id', usados).order('servico_nome'),
      ]), { ms: 8000, tentativas: 1, label: 'projetos_engenharia_bom' })
      setItensGerados((itens as ItemGerado[]) ?? [])
      setBom((bomRows as BomRow[]) ?? [])
      setMsg(`Orçamento gerado: ${data} item(ns) de serviço explodidos.`)
    } catch (e) { setErro((e as Error).message || String(e)) } finally { setBusy(false) }
  }

  // Total explodido por serviço (soma das quantidades dos ambientes confirmados que usam o serviço).
  const qtdPorServico = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of ambientes) {
      if (!a.confirmado || !a.servico_id) continue
      m.set(a.servico_id, (m.get(a.servico_id) ?? 0) + qtdAmbiente(a))
    }
    return m
  }, [ambientes])

  const totalOrcamento = itensGerados.reduce((s, i) => s + (i.subtotal ?? 0), 0)
  // Materiais e mão-de-obra consolidados: BOM por unidade de serviço × quantidade explodida daquele serviço.
  const materiais = bom.filter((b) => b.tipo !== 'mao_obra')
  const maoObra = bom.filter((b) => b.tipo === 'mao_obra')
  const totalMateriais = materiais.reduce((s, b) => s + (b.custo_total ?? 0) * (qtdPorServico.get(b.servico_id) ?? 0), 0)
  const totalHoras = maoObra.reduce((s, b) => s + (b.quantidade ?? 0) * (qtdPorServico.get(b.servico_id) ?? 0), 0)
  const totalMaoObra = maoObra.reduce((s, b) => s + (b.custo_total ?? 0) * (qtdPorServico.get(b.servico_id) ?? 0), 0)

  if (!companyId) return (
    <div className="min-h-screen bg-[#FAF7F2] p-6 text-sm text-[#3D2314]/60">
      Selecione uma empresa específica no topo do menu para abrir a Engenharia / Take-off.
    </div>
  )

  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white p-2 text-sm text-[#3D2314]'
  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 space-y-4 max-w-4xl mx-auto">
      <header>
        <div className="text-xs font-semibold tracking-widest uppercase inline-flex items-center gap-1.5" style={{ color: GOLD }}>
          <Ruler size={13} /> Engenharia · Take-off
        </div>
        <h1 className="text-2xl sm:text-3xl mt-1 text-[#3D2314]" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Take-off por ambiente</h1>
        <p className="text-sm mt-1" style={{ color: ESP60 }}>Defina ambientes, áreas e serviços → o sistema gera a lista de materiais (BOM) e as horas de mão de obra automaticamente.</p>
        <p className="text-xs mt-1" style={{ color: ESP60 }}>Passo 2 do fluxo de obra · vem depois do <a href="/dashboard/projetos/takeoff" className="underline" style={{ color: GOLD }}>Take-off por IA</a> (upload de planta). Mesmo motor, entrada diferente.</p>
      </header>

      {/* Passo 1 · take-off + orçamento de destino */}
      <section className="rounded-2xl bg-white p-4 border border-[#E7DECF] space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div data-ajuda="1">
            <label className="block text-xs font-medium mb-1" style={{ color: ESP }}><span className="inline-flex items-center gap-1">Orçamento de destino <AjudaCampo chave="projetos.engenharia.orcamento" rota="/dashboard/projetos/engenharia" /></span></label>
            <select className={inp} value={orcId} onChange={(e) => setOrcId(e.target.value)}>
              <option value="">— selecione (crie em Projetos › Propostas) —</option>
              {orcamentos.map((o) => <option key={o.id} value={o.id}>{o.numero ?? o.id.slice(0, 8)} · {o.cliente_nome ?? 'sem cliente'} · {o.status}</option>)}
            </select>
          </div>
          <div data-ajuda="1">
            <label className="block text-xs font-medium mb-1" style={{ color: ESP }}><span className="inline-flex items-center gap-1">Take-off <AjudaCampo chave="projetos.engenharia.takeoff" rota="/dashboard/projetos/engenharia" /></span></label>
            <div className="flex gap-2">
              <select className={inp} value={planta?.id ?? ''} onChange={(e) => { const p = plantas.find((x) => x.id === e.target.value); if (p) void abrirPlanta(p) }}>
                <option value="">— novo ou selecione um existente —</option>
                {plantas.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.status}</option>)}
              </select>
              <button onClick={() => setNovoAberto((v) => !v)} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: GOLD, opacity: busy ? 0.6 : 1 }}>
                <Plus size={15} /> Novo
              </button>
            </div>
          </div>
        </div>
        {novoAberto && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void novoTakeoff() }}>
            <div className="flex-1 flex items-center gap-1"><input autoFocus className={inp} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome do projeto / take-off" aria-label="Nome do take-off" /><AjudaCampo chave="projetos.engenharia.novo_nome" rota="/dashboard/projetos/engenharia" /></div>
            <button type="submit" disabled={busy || !novoNome.trim()} className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: GOLD, opacity: (busy || !novoNome.trim()) ? 0.6 : 1 }}>Criar</button>
          </form>
        )}
      </section>

      {/* Lista real de take-offs da empresa (RD-98 p1) */}
      <section data-testid="engenharia-lista" className="rounded-2xl bg-white border border-[#E7DECF] overflow-hidden">
        <div className="p-3 border-b border-[#E7DECF] text-sm font-semibold text-[#3D2314] inline-flex items-center gap-1 w-full">
          Take-offs da empresa ({plantas.length}) <AjudaCampo chave="projetos.engenharia.lista" rota="/dashboard/projetos/engenharia" />
        </div>
        {plantas.length === 0 ? (
          <div className="p-5 text-center text-sm" style={{ color: ESP60 }}>
            {carregouLista ? <>Nenhum take-off ainda. Use <b>+ Novo</b> para criar à mão ou envie uma planta no <a href="/dashboard/projetos/takeoff" className="underline" style={{ color: GOLD }}>Take-off por IA</a>.</> : 'Carregando…'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs" style={{ color: ESP60, background: BG }}>
                <tr>
                  <th className="text-left p-2">Take-off</th>
                  <th className="text-right p-2"><span className="inline-flex items-center gap-1">Ambientes <AjudaCampo chave="projetos.engenharia.col_ambientes" rota="/dashboard/projetos/engenharia" /></span></th>
                  <th className="text-right p-2"><span className="inline-flex items-center gap-1">Área (m²) <AjudaCampo chave="projetos.engenharia.col_area_total" rota="/dashboard/projetos/engenharia" /></span></th>
                  <th className="text-left p-2"><span className="inline-flex items-center gap-1">Serviços <AjudaCampo chave="projetos.engenharia.col_servicos" rota="/dashboard/projetos/engenharia" /></span></th>
                  <th className="text-left p-2"><span className="inline-flex items-center gap-1">Status <AjudaCampo chave="projetos.engenharia.col_status" rota="/dashboard/projetos/engenharia" /></span></th>
                  <th className="text-left p-2">Orçamento</th>
                  <th className="text-right p-2 whitespace-nowrap"><span className="inline-flex items-center gap-1">Ações <AjudaCampo chave="projetos.engenharia.col_acoes" rota="/dashboard/projetos/engenharia" /></span></th>
                </tr>
              </thead>
              <tbody>
                {plantas.map((p) => (
                  <tr key={p.id} data-testid="engenharia-takeoff-linha" style={{ borderTop: `1px solid ${LINE}`, background: planta?.id === p.id ? '#FBF4E4' : undefined }}>
                    <td className="p-2 text-[#3D2314] font-medium">{p.nome}</td>
                    <td className="p-2 text-right tabular-nums">{p.n_ambientes} <span style={{ color: ESP60 }}>({p.n_prontos} prontos)</span></td>
                    <td className="p-2 text-right tabular-nums">{Number(p.area_total).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                    <td className="p-2 text-xs" style={{ color: ESP60 }}>{p.servicos?.length ? p.servicos.slice(0, 3).join(', ') + (p.servicos.length > 3 ? ` +${p.servicos.length - 3}` : '') : 'nenhum vinculado'}</td>
                    <td className="p-2 text-xs">{p.status}</td>
                    <td className="p-2 text-xs">{p.orcamento_numero ?? '—'}</td>
                    <td className="p-2 text-right whitespace-nowrap text-xs font-semibold">
                      <button type="button" data-testid="engenharia-abrir" onClick={() => void abrirPlanta(p)} disabled={busy} style={{ color: '#A57A15' }}>Abrir</button>
                      <button type="button" data-testid="engenharia-editar" onClick={() => { setEditar(p); setEdNome(p.nome); setEdOrc(p.orcamento_id ?? '') ; setErroAcao(null) }} disabled={busy} className="ml-3" style={{ color: ESP }}>Editar</button>
                      <button type="button" data-testid="engenharia-excluir" onClick={() => { setExcluirP(p); setMotivo(''); setErroAcao(null) }} disabled={busy} className="ml-3" style={{ color: '#B91C1C' }}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {msg && <div className="rounded-xl p-3 text-sm" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>{msg}</div>}
      {erro && <div className="rounded-xl p-3 text-sm flex items-start gap-2" style={{ background: '#FEE', border: '1px solid #FBB', color: '#A65A3A' }}><AlertTriangle size={14} className="mt-0.5" /> {erro}</div>}

      {/* Passo 2 · ambientes */}
      {planta && (
        <section className="rounded-2xl bg-white border border-[#E7DECF] overflow-hidden">
          <div className="p-3 flex items-center justify-between gap-2 border-b border-[#E7DECF] flex-wrap">
            <span className="text-sm font-semibold text-[#3D2314]">{planta.nome} · Ambientes ({ambientes.length})</span>
            <div className="flex items-center gap-2">
              <button onClick={sugerir} disabled={busy || ambientes.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: GOLD, opacity: (busy || ambientes.length === 0) ? 0.5 : 1 }} title="Sugere o serviço de cada ambiente por palavra-chave (você confirma depois)">
                <Sparkles size={13} /> Sugerir serviços
              </button>
              <button onClick={() => setAddAberto(true)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: GOLD, color: GOLD, background: 'transparent', opacity: busy ? 0.6 : 1 }}>
                <Plus size={13} /> Ambiente
              </button>
            </div>
          </div>
          {ambientes.length === 0 ? (
            <div className="p-6 text-center text-sm" style={{ color: ESP60 }}>Nenhum ambiente ainda. Clique em <b>+ Ambiente</b> para começar.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs" style={{ color: ESP60, background: BG }}>
                  <tr>
                    <th className="text-left p-2"><span className="inline-flex items-center gap-1">Nome <AjudaCampo chave="projetos.engenharia.amb_nome" rota="/dashboard/projetos/engenharia" /></span></th><th className="text-right p-2"><span className="inline-flex items-center gap-1">m² <AjudaCampo chave="projetos.engenharia.amb_area" rota="/dashboard/projetos/engenharia" /></span></th><th className="text-right p-2"><span className="inline-flex items-center gap-1">ml <AjudaCampo chave="projetos.engenharia.amb_perimetro" rota="/dashboard/projetos/engenharia" /></span></th><th className="text-right p-2"><span className="inline-flex items-center gap-1">pé-dir. <AjudaCampo chave="projetos.engenharia.amb_pe_direito" rota="/dashboard/projetos/engenharia" /></span></th>
                    <th className="p-2"><span className="inline-flex items-center gap-1">Serviço <AjudaCampo chave="projetos.engenharia.amb_servico" rota="/dashboard/projetos/engenharia" /></span></th><th className="p-2"><span className="inline-flex items-center gap-1">Base <AjudaCampo chave="projetos.engenharia.amb_base" rota="/dashboard/projetos/engenharia" /></span></th><th className="p-2"><span className="inline-flex items-center gap-1">OK <AjudaCampo chave="projetos.engenharia.amb_ok" rota="/dashboard/projetos/engenharia" /></span></th>
                    <th className="text-right p-2"><span className="inline-flex items-center gap-1">Qtd <AjudaCampo chave="projetos.engenharia.amb_qtd" rota="/dashboard/projetos/engenharia" /></span></th>
                    <th className="p-2"><span className="inline-flex items-center gap-1">Excluir <AjudaCampo chave="projetos.engenharia.amb_excluir" rota="/dashboard/projetos/engenharia" /></span></th>
                  </tr>
                </thead>
                <tbody>
                  {ambientes.map((a) => (
                    <tr key={a.id} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td className="p-2"><input className={inp} value={a.nome} onChange={(e) => atualizarAmb(a, { nome: e.target.value })} /></td>
                      <td className="p-2"><input className={inp + ' text-right'} inputMode="decimal" value={a.area_m2 ?? ''} onChange={(e) => atualizarAmb(a, { area_m2: e.target.value ? Number(e.target.value) : null })} /></td>
                      <td className="p-2"><input className={inp + ' text-right'} inputMode="decimal" value={a.perimetro_ml ?? ''} onChange={(e) => atualizarAmb(a, { perimetro_ml: e.target.value ? Number(e.target.value) : null })} /></td>
                      <td className="p-2"><input className={inp + ' text-right'} inputMode="decimal" value={a.pe_direito_m ?? ''} onChange={(e) => atualizarAmb(a, { pe_direito_m: e.target.value ? Number(e.target.value) : null })} /></td>
                      <td className="p-2">
                        <select className={inp} value={a.servico_id ?? ''} onChange={(e) => atualizarAmb(a, { servico_id: e.target.value || null })}>
                          <option value="">—</option>
                          {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}{s.unidade ? ` (${s.unidade})` : ''}</option>)}
                        </select>
                      </td>
                      <td className="p-2">
                        <select className={inp} value={a.base_calculo} onChange={(e) => atualizarAmb(a, { base_calculo: e.target.value as BaseCalc })}>
                          <option value="area">Área (m²)</option>
                          <option value="perimetro">Perímetro (ml)</option>
                          <option value="pe_direito_parede">Parede (ml×pé-dir.)</option>
                        </select>
                      </td>
                      <td className="p-2 text-center"><input type="checkbox" checked={a.confirmado} onChange={(e) => atualizarAmb(a, { confirmado: e.target.checked })} /></td>
                      <td className="p-2 text-right tabular-nums text-xs" style={{ color: ESP60 }}>{a.servico_id ? Number(qtdAmbiente(a).toFixed(2)) : '—'}</td>
                      <td className="p-2 text-center"><button type="button" data-testid="engenharia-ambiente-excluir" onClick={() => { setExcluirA(a); setMotivo(''); setErroAcao(null) }} disabled={busy} className="text-xs font-semibold" style={{ color: '#B91C1C' }}>Excluir</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="p-3 flex flex-wrap items-center justify-end gap-2 border-t border-[#E7DECF]" style={{ background: BG }}>
            <button onClick={gerar} disabled={busy || !orcId} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: ESP, color: '#fff', opacity: (busy || !orcId) ? 0.6 : 1 }}>
              <Sparkles size={15} /> Gerar orçamento (BOM + mão de obra)
            </button>
          </div>
        </section>
      )}

      {/* Passo 3 · quantitativo previsto (na hora) + orçamento gerado */}
      {(itensGerados.length > 0 || bom.length > 0) && (
        <section data-testid="engenharia-quantitativo" className="rounded-2xl bg-white border border-[#E7DECF] overflow-hidden">
          <div className="p-3 border-b border-[#E7DECF] flex items-center gap-2">
            <Check size={16} style={{ color: itensGerados.length > 0 ? '#16A34A' : GOLD }} />
            <span className="text-sm font-semibold text-[#3D2314]">{itensGerados.length > 0 ? 'Orçamento gerado' : 'Quantitativo previsto'}</span>
            <AjudaCampo chave="projetos.engenharia.quantitativo" rota="/dashboard/projetos/engenharia" />
            {itensGerados.length === 0 && <span className="text-xs" style={{ color: ESP60 }}>atualiza sozinho a cada ambiente confirmado — gere o orçamento para gravar os itens</span>}
          </div>
          {itensGerados.length > 0 && (<div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs" style={{ color: ESP60, background: BG }}>
                <tr><th className="text-left p-2">Serviço · ambiente</th><th className="text-right p-2">Qtd</th><th className="p-2">Un.</th><th className="text-right p-2">Preço un.</th><th className="text-right p-2">Subtotal</th></tr>
              </thead>
              <tbody>
                {itensGerados.map((i) => (
                  <tr key={i.id} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td className="p-2 text-[#3D2314]">{i.produto_nome ?? i.servico_descricao ?? '—'}</td>
                    <td className="p-2 text-right tabular-nums">{i.quantidade ?? 0}</td>
                    <td className="p-2 text-center" style={{ color: ESP60 }}>{i.unidade ?? '—'}</td>
                    <td className="p-2 text-right tabular-nums">{money(i.preco_unitario ?? 0)}</td>
                    <td className="p-2 text-right tabular-nums font-medium">{money(i.subtotal ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${LINE}`, background: BG }}>
                  <td className="p-2 font-semibold text-[#3D2314]" colSpan={4}>Total do orçamento</td>
                  <td className="p-2 text-right font-bold tabular-nums text-[#3D2314]">{money(totalOrcamento)}</td>
                </tr>
              </tfoot>
            </table>
          </div>)}

          {/* BOM / materiais + mão de obra (composição dos serviços usados) */}
          <div className="grid md:grid-cols-2 gap-0 border-t border-[#E7DECF]">
            <div className="p-3 md:border-r border-[#E7DECF]">
              <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: GOLD }}>BOM · Materiais</div>
              {materiais.length === 0 ? <div className="text-xs" style={{ color: ESP60 }}>Sem materiais no BOM dos serviços usados.</div> : (
                <ul className="text-xs divide-y" style={{ borderColor: LINE }}>
                  {materiais.map((b, k) => (
                    <li key={k} className="py-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[#3D2314]">{b.item_nome ?? '—'} <span style={{ color: ESP60 }}>· {b.servico_nome}</span></span>
                      <span className="tabular-nums shrink-0" style={{ color: ESP60 }}>{Number(((b.quantidade ?? 0) * (qtdPorServico.get(b.servico_id) ?? 0)).toFixed(2))} {b.unidade ?? ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 pt-2 border-t flex justify-between text-sm font-semibold text-[#3D2314]" style={{ borderColor: LINE }}>
                <span>Total materiais</span><span className="tabular-nums">{money(totalMateriais)}</span>
              </div>
            </div>
            <div className="p-3">
              <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: GOLD }}>Mão de obra</div>
              {maoObra.length === 0 ? <div className="text-xs" style={{ color: ESP60 }}>Sem mão de obra no BOM dos serviços usados.</div> : (
                <ul className="text-xs divide-y" style={{ borderColor: LINE }}>
                  {maoObra.map((b, k) => (
                    <li key={k} className="py-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[#3D2314]">{b.item_nome ?? '—'} <span style={{ color: ESP60 }}>· {b.servico_nome}</span></span>
                      <span className="tabular-nums shrink-0" style={{ color: ESP60 }}>{Number(((b.quantidade ?? 0) * (qtdPorServico.get(b.servico_id) ?? 0)).toFixed(2))} h</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 pt-2 border-t flex justify-between text-sm font-semibold text-[#3D2314]" style={{ borderColor: LINE }}>
                <span>Total horas</span><span className="tabular-nums">{Number(totalHoras.toFixed(1))} h</span>
              </div>
              <div className="flex justify-between text-xs mt-1" style={{ color: ESP60 }}>
                <span>Custo mão de obra</span><span className="tabular-nums">{money(totalMaoObra)}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {editar && (
        <div onClick={() => setEditar(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Editar take-off" data-ajuda="1" className="bg-[#FAF7F2] rounded-2xl border border-[#E7DECF] w-full max-w-md p-5">
            <h3 className="text-lg font-semibold text-[#3D2314] mb-3">Editar take-off</h3>
            <label className="block text-[11px] font-medium mb-1" style={{ color: ESP60 }}>Nome <AjudaCampo chave="projetos.engenharia.edit_nome" rota="/dashboard/projetos/engenharia" /></label>
            <input className={inp} value={edNome} onChange={(e) => setEdNome(e.target.value)} data-testid="engenharia-edit-nome" data-ajuda="1" />
            <label className="block text-[11px] font-medium mt-3 mb-1" style={{ color: ESP60 }}>Orçamento de destino <AjudaCampo chave="projetos.engenharia.edit_orcamento" rota="/dashboard/projetos/engenharia" /></label>
            <select className={inp} value={edOrc} onChange={(e) => setEdOrc(e.target.value)} data-testid="engenharia-edit-orcamento" data-ajuda="1">
              <option value="">— manter o atual —</option>
              {orcamentos.map((o) => <option key={o.id} value={o.id}>{o.numero ?? o.id.slice(0, 8)} · {o.cliente_nome ?? 'sem cliente'} · {o.status}</option>)}
            </select>
            {erroAcao && <div role="alert" className="mt-3 rounded-lg p-2 text-xs" style={{ background: '#FEE', color: '#A65A3A' }}>{erroAcao}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditar(null)} className="px-4 py-2 rounded-xl text-sm border border-[#E7DECF] text-[#3D2314]">Cancelar</button>
              <button onClick={() => void salvarEdicao()} disabled={salvandoAcao || !edNome.trim()} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: GOLD, opacity: (salvandoAcao || !edNome.trim()) ? 0.6 : 1 }} data-testid="engenharia-edit-salvar">{salvandoAcao ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
      {(excluirP || excluirA) && (
        <div onClick={() => { setExcluirP(null); setExcluirA(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Excluir" data-ajuda="1" className="bg-[#FAF7F2] rounded-2xl border border-[#E7DECF] w-full max-w-md p-5">
            <h3 className="text-lg font-semibold text-[#3D2314] mb-2">{excluirP ? 'Excluir take-off' : 'Excluir ambiente'}</h3>
            <p className="text-sm" style={{ color: ESP }}>Excluir <b>{excluirP ? excluirP.nome : excluirA!.nome}</b>? Some da lista e do cálculo; o registro fica guardado com quem excluiu e quando.</p>
            <label className="block text-[11px] font-medium mt-3 mb-1" style={{ color: ESP60 }}>Motivo <AjudaCampo chave="projetos.engenharia.excluir_motivo" rota="/dashboard/projetos/engenharia" /></label>
            <input className={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: criado em duplicidade" data-testid="engenharia-excluir-motivo" data-ajuda="1" />
            {erroAcao && <div role="alert" className="mt-3 rounded-lg p-2 text-xs" style={{ background: '#FEE', color: '#A65A3A' }}>{erroAcao}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setExcluirP(null); setExcluirA(null) }} className="px-4 py-2 rounded-xl text-sm border border-[#E7DECF] text-[#3D2314]">Voltar</button>
              <button onClick={() => void confirmarExcluir()} disabled={salvandoAcao} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: '#B91C1C', opacity: salvandoAcao ? 0.6 : 1 }} data-testid="engenharia-excluir-confirmar">{salvandoAcao ? 'Excluindo…' : 'Excluir'}</button>
            </div>
          </div>
        </div>
      )}

      {addAberto && <AmbienteModal onFechar={() => setAddAberto(false)} onSalvar={adicionarAmbiente} busy={busy} />}
    </div>
  )
}

function AmbienteModal({ onFechar, onSalvar, busy }: {
  onFechar: () => void
  onSalvar: (f: { nome: string; area_m2: string; largura_m: string; comprimento_m: string; perimetro_ml: string; pe_direito_m: string }) => void
  busy: boolean
}) {
  const [nome, setNome] = useState('')
  const [areaM2, setAreaM2] = useState('')
  const [largura, setLargura] = useState('')
  const [comprimento, setComprimento] = useState('')
  const [perimetro, setPerimetro] = useState('')
  const [peDireito, setPeDireito] = useState('')
  const areaCalc = largura.trim() && comprimento.trim() ? Number(largura) * Number(comprimento) : null
  const perimCalc = largura.trim() && comprimento.trim() ? 2 * (Number(largura) + Number(comprimento)) : null
  const inp = 'w-full rounded-xl border border-[#E7DECF] bg-white p-2 text-sm text-[#3D2314]'
  const lbl = 'block text-[11px] font-medium mb-1'
  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#FAF7F2] rounded-2xl border border-[#E7DECF] w-full max-w-md p-5" style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}>
        <h3 className="text-lg font-semibold text-[#3D2314] mb-1">Adicionar ambiente</h3>
        <p className="text-[11px] mb-4" style={{ color: ESP60 }}>Informe a área direto, ou largura × comprimento que a gente calcula.</p>
        <div className="mb-3" data-ajuda="1">
          <label className={lbl} style={{ color: ESP60 }}><span className="inline-flex items-center gap-1">Nome do ambiente * <AjudaCampo chave="projetos.engenharia.m_nome" rota="/dashboard/projetos/engenharia" /></span></label>
          <input autoFocus className={inp} value={nome} onChange={(e) => setNome(e.target.value)} placeholder='ex: "Sala 01", "Banheiro"' />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div data-ajuda="1"><label className={lbl} style={{ color: ESP60 }}><span className="inline-flex items-center gap-1">Área (m²) <AjudaCampo chave="projetos.engenharia.m_area" rota="/dashboard/projetos/engenharia" /></span></label><input className={inp + ' text-right'} inputMode="decimal" value={areaM2} onChange={(e) => setAreaM2(e.target.value)} placeholder={areaCalc != null ? areaCalc.toFixed(2) : '0,00'} /></div>
          <div data-ajuda="1"><label className={lbl} style={{ color: ESP60 }}><span className="inline-flex items-center gap-1">Pé-direito (m) <AjudaCampo chave="projetos.engenharia.m_pe_direito" rota="/dashboard/projetos/engenharia" /></span></label><input className={inp + ' text-right'} inputMode="decimal" value={peDireito} onChange={(e) => setPeDireito(e.target.value)} placeholder="2,80" /></div>
          <div data-ajuda="1"><label className={lbl} style={{ color: ESP60 }}><span className="inline-flex items-center gap-1">Largura (m) <AjudaCampo chave="projetos.engenharia.m_largura" rota="/dashboard/projetos/engenharia" /></span></label><input className={inp + ' text-right'} inputMode="decimal" value={largura} onChange={(e) => setLargura(e.target.value)} /></div>
          <div data-ajuda="1"><label className={lbl} style={{ color: ESP60 }}><span className="inline-flex items-center gap-1">Comprimento (m) <AjudaCampo chave="projetos.engenharia.m_comprimento" rota="/dashboard/projetos/engenharia" /></span></label><input className={inp + ' text-right'} inputMode="decimal" value={comprimento} onChange={(e) => setComprimento(e.target.value)} /></div>
          <div className="col-span-2" data-ajuda="1"><label className={lbl} style={{ color: ESP60 }}><span className="inline-flex items-center gap-1">Perímetro (ml) <AjudaCampo chave="projetos.engenharia.m_perimetro" rota="/dashboard/projetos/engenharia" /></span></label><input className={inp + ' text-right'} inputMode="decimal" value={perimetro} onChange={(e) => setPerimetro(e.target.value)} placeholder={perimCalc != null ? perimCalc.toFixed(2) : '0,00'} /></div>
        </div>
        {areaCalc != null && !areaM2.trim() && (
          <div className="text-[11px] mb-3" style={{ color: '#7A5A0B' }}>Área calculada: <b>{areaCalc.toFixed(2)} m²</b> · Perímetro: <b>{perimCalc?.toFixed(2)} ml</b> (L×C)</div>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onFechar} disabled={busy} className="px-4 py-2 rounded-xl text-sm border border-[#E7DECF] text-[#3D2314]">Cancelar</button>
          <button onClick={() => onSalvar({ nome, area_m2: areaM2, largura_m: largura, comprimento_m: comprimento, perimetro_ml: perimetro, pe_direito_m: peDireito })} disabled={busy || !nome.trim()} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: GOLD, opacity: (busy || !nome.trim()) ? 0.6 : 1 }}>
            {busy ? 'Salvando…' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}
