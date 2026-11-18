'use client'

// Hub · Gestão de Obras · Subempreiteiros (Blueprint §16 H7) — aba SUBEMPREITEIROS.
// Esta fatia (slice 4): criar / editar / listar / excluir (rastreável) o contrato do subempreiteiro
// sobre a camada de dados publicada (#3913: obra_subempreiteiro_contrato + _item, RPCs
// fn_obra_subempreiteiro_contrato_listar/_salvar/_excluir). Chama só RPCs já publicadas e guardadas
// (company_id da obra e do fornecedor conferidos no banco).
// A PONTE financeira (medição do sub -> erp_pagar na GE, com retenção/INSS/ISS) é fatia SEPARADA e
// sensível — NÃO entra aqui: esta tela só registra o contrato e seus itens (sem movimento financeiro).
// RD-95: "?" em todo campo / filtro / indicador / ação. RD-96/RD-100: linguagem e layout próprios.

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { parseNumBR } from '@/lib/num'

const ROTA = '/dashboard/projetos/obras/[id]/subempreiteiros'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = 'rgba(61,35,20,0.18)', MUT = 'rgba(61,35,20,0.55)', VERM = '#A32D2D', VERDE = '#2E7D32'

// A camada de dados pode chegar à produção depois desta tela; enquanto não chegar, PostgREST
// responde "relation does not exist". RD-98: degrada para aviso de "recurso sendo liberado".
function recursoEmLiberacao(e: unknown): boolean {
  const err = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  if (['42P01', 'PGRST202', 'PGRST205'].includes(code)) return true
  return /does not exist|not found|schema cache/.test(msg)
}

const brl = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const STATUS_LABEL: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: MUT },
  ativo: { l: 'Ativo', cor: VERDE },
  concluido: { l: 'Concluído', cor: ESP },
  cancelado: { l: 'Cancelado', cor: VERM },
}
// Situação da medição do subempreiteiro (quanto foi executado/medido por período).
const MED_STATUS: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: MUT },
  aprovada: { l: 'Aprovada', cor: VERDE },
  cancelada: { l: 'Cancelada', cor: VERM },
}
const fmtComp = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }) : '—'

type Obra = { id: string; nome: string | null; company_id: string }
type Fornecedor = { id: string; nome_fantasia: string | null; razao_social: string | null }
type ContratoItem = {
  id?: string; descricao: string | null; unidade: string | null
  quantidade: number | null; preco_unitario: number | null; valor: number | null; ordem: number | null
}
type Contrato = {
  id: string; numero: string | null; objeto: string | null
  fornecedor_id: string; fornecedor_nome: string | null
  valor_total: number | null; retencao_pct: number | null
  data_inicio: string | null; data_fim_prevista: string | null
  status: string; observacoes: string | null; criado_em: string | null
  itens: ContratoItem[]
}

type LinhaForm = { descricao: string; unidade: string; quantidade: string; preco_unitario: string }
const linhaVazia = (): LinhaForm => ({ descricao: '', unidade: '', quantidade: '', preco_unitario: '' })

type Medicao = {
  id: string; numero: string | null; competencia: string | null; data_medicao: string | null
  valor_bruto: number | null; retencao_pct: number | null; valor_retencao: number | null
  inss_pct: number | null; iss_pct: number | null; valor_inss: number | null; valor_iss: number | null
  valor_liquido: number | null
  status: string; observacoes: string | null; criado_em: string | null
}
type MedForm = {
  medicao_id: string | null; contrato_id: string
  competencia: string; data_medicao: string; valor_bruto: string; status: string; observacoes: string
  inss_pct: string; iss_pct: string
}
const medFormVazio = (contratoId: string): MedForm => ({
  medicao_id: null, contrato_id: contratoId, competencia: '', data_medicao: '', valor_bruto: '', status: 'rascunho', observacoes: '',
  inss_pct: '', iss_pct: '',
})

type FormState = {
  contrato_id: string | null
  fornecedor_id: string
  numero: string
  objeto: string
  retencao_pct: string
  data_inicio: string
  data_fim_prevista: string
  status: string
  observacoes: string
  itens: LinhaForm[]
}
const formVazio = (): FormState => ({
  contrato_id: null, fornecedor_id: '', numero: '', objeto: '', retencao_pct: '',
  data_inicio: '', data_fim_prevista: '', status: 'rascunho', observacoes: '', itens: [linhaVazia()],
})

export default function SubempreiteirosObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<Obra | null>(null)
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [contratos, setContratos] = useState<Contrato[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [emLiberacao, setEmLiberacao] = useState(false)
  const [filtro, setFiltro] = useState<'todos' | 'rascunho' | 'ativo' | 'concluido' | 'cancelado'>('todos')
  const [expandido, setExpandido] = useState<string | null>(null)

  const [abrirForm, setAbrirForm] = useState(false)
  const [form, setForm] = useState<FormState>(formVazio)
  const [salvando, setSalvando] = useState(false)

  // Medições do subempreiteiro (slice 2a: camada de dados já publicada — fn_obra_subempreiteiro_medicao_*).
  const [medExpandido, setMedExpandido] = useState<string | null>(null)
  const [medicoes, setMedicoes] = useState<Record<string, Medicao[]>>({})
  const [medCarregando, setMedCarregando] = useState<string | null>(null)
  const [medForm, setMedForm] = useState<MedForm | null>(null)
  const [medSalvando, setMedSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null); setEmLiberacao(false)
    const { data: o, error: eo } = await supabase
      .from('projetos_obras').select('id, nome, company_id').eq('id', id).maybeSingle()
    if (eo) { setCarregando(false); setErro(erroAmigavel(eo, 'Não foi possível abrir a obra. Tente de novo.')); return }
    if (!o) { setCarregando(false); setObra(null); return }
    setObra(o as Obra)

    const { data: forn } = await supabase
      .from('erp_fornecedores')
      .select('id, nome_fantasia, razao_social')
      .eq('company_id', (o as Obra).company_id)
      .order('razao_social', { ascending: true })
    setFornecedores((forn as Fornecedor[]) ?? [])

    const { data, error } = await supabase.rpc('fn_obra_subempreiteiro_contrato_listar', { p_obra_id: id })
    setCarregando(false)
    if (error) {
      if (recursoEmLiberacao(error)) { setEmLiberacao(true); return }
      setErro(erroAmigavel(error, 'Não foi possível carregar os contratos. Tente de novo.')); return
    }
    const r = (data ?? {}) as { ok?: boolean; erro?: string; contratos?: Contrato[] }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível carregar os contratos.'); return }
    setContratos(r.contratos ?? [])
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const nomeForn = (f: Fornecedor) => f.nome_fantasia?.trim() || f.razao_social?.trim() || '(sem nome)'

  // Valor do contrato na prévia: soma dos itens (quantidade × preço), espelhando a RPC
  // (valor_total = soma dos itens quando houver). Mostra 0 enquanto não há item preenchido.
  const previaTotal = useMemo(() => {
    let total = 0
    for (const l of form.itens) {
      const q = parseNumBR(l.quantidade) ?? NaN
      const p = parseNumBR(l.preco_unitario) ?? NaN
      if (l.descricao.trim() && isFinite(q) && isFinite(p)) total += q * p
    }
    return total
  }, [form])

  const contratosFiltrados = contratos.filter((c) => filtro === 'todos' || c.status === filtro)

  function abrirNovo() {
    setForm(formVazio()); setAbrirForm(true); setErro(null)
  }

  function abrirEdicao(c: Contrato) {
    setForm({
      contrato_id: c.id,
      fornecedor_id: c.fornecedor_id,
      numero: c.numero ?? '',
      objeto: c.objeto ?? '',
      retencao_pct: c.retencao_pct != null ? String(c.retencao_pct) : '',
      data_inicio: c.data_inicio ?? '',
      data_fim_prevista: c.data_fim_prevista ?? '',
      status: c.status || 'rascunho',
      observacoes: c.observacoes ?? '',
      itens: c.itens.length
        ? c.itens.map((it) => ({
            descricao: it.descricao ?? '', unidade: it.unidade ?? '',
            quantidade: it.quantidade != null ? String(it.quantidade) : '',
            preco_unitario: it.preco_unitario != null ? String(it.preco_unitario) : '',
          }))
        : [linhaVazia()],
    })
    setAbrirForm(true); setErro(null)
  }

  function setItem(i: number, campo: keyof LinhaForm, valor: string) {
    setForm((f) => ({ ...f, itens: f.itens.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)) }))
  }
  function addItem() { setForm((f) => ({ ...f, itens: [...f.itens, linhaVazia()] })) }
  function removerItem(i: number) {
    setForm((f) => ({ ...f, itens: f.itens.length > 1 ? f.itens.filter((_, idx) => idx !== i) : f.itens }))
  }

  async function salvar() {
    if (!obra) return
    if (!form.fornecedor_id) { setErro('Escolha o subempreiteiro (fornecedor) do contrato.'); return }
    const itens = form.itens
      .map((l, i) => {
        if (!l.descricao.trim()) return null
        return {
          descricao: l.descricao.trim(),
          unidade: l.unidade.trim() || null,
          quantidade: parseNumBR(l.quantidade) || 0,
          preco_unitario: parseNumBR(l.preco_unitario) || 0,
          ordem: i,
        }
      })
      .filter(Boolean)
    const retencao = parseNumBR(form.retencao_pct) || 0
    if (retencao < 0 || retencao > 100) { setErro('A retenção deve estar entre 0 e 100%.'); return }

    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_subempreiteiro_contrato_salvar', {
      p_contrato: {
        contrato_id: form.contrato_id,
        obra_id: id,
        fornecedor_id: form.fornecedor_id,
        numero: form.numero.trim() || null,
        objeto: form.objeto.trim() || null,
        retencao_pct: retencao,
        data_inicio: form.data_inicio || null,
        data_fim_prevista: form.data_fim_prevista || null,
        status: form.status,
        observacoes: form.observacoes.trim() || null,
        itens,
      },
    })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível salvar o contrato.')); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível salvar o contrato.'); return }
    setAbrirForm(false); setForm(formVazio())
    await carregar()
  }

  async function excluir(c: Contrato) {
    const motivo = prompt(`Excluir o contrato de ${c.fornecedor_nome ?? 'subempreiteiro'}? Fica registrado quem excluiu e o motivo (o contrato não some do histórico). Motivo:`)
    if (motivo === null) return
    if (!motivo.trim()) { setErro('Informe o motivo da exclusão.'); return }
    setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_subempreiteiro_contrato_excluir', { p_contrato_id: c.id, p_motivo: motivo })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível excluir o contrato.')); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível excluir o contrato.'); return }
    await carregar()
  }

  // ---- Medições do subempreiteiro (slice 2a) -----------------------------------------------------------
  const carregarMedicoes = useCallback(async (contratoId: string) => {
    setMedCarregando(contratoId); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_subempreiteiro_medicao_listar', { p_contrato_id: contratoId })
    setMedCarregando(null)
    if (error) {
      if (recursoEmLiberacao(error)) { setMedicoes((m) => ({ ...m, [contratoId]: [] })); return }
      setErro(erroAmigavel(error, 'Não foi possível carregar as medições.')); return
    }
    const r = (data ?? {}) as { ok?: boolean; erro?: string; medicoes?: Medicao[] }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível carregar as medições.'); return }
    setMedicoes((m) => ({ ...m, [contratoId]: r.medicoes ?? [] }))
  }, [])

  function alternarMedicoes(contratoId: string) {
    setMedForm(null)
    if (medExpandido === contratoId) { setMedExpandido(null); return }
    setMedExpandido(contratoId)
    if (!medicoes[contratoId]) void carregarMedicoes(contratoId)
  }

  function abrirMedNova(contratoId: string) { setMedForm(medFormVazio(contratoId)); setErro(null) }
  function abrirMedEdicao(contratoId: string, m: Medicao) {
    setMedForm({
      medicao_id: m.id, contrato_id: contratoId,
      competencia: m.competencia ?? '', data_medicao: m.data_medicao ?? '',
      valor_bruto: m.valor_bruto != null ? String(m.valor_bruto) : '',
      status: m.status || 'rascunho', observacoes: m.observacoes ?? '',
      inss_pct: m.inss_pct != null ? String(m.inss_pct) : '',
      iss_pct: m.iss_pct != null ? String(m.iss_pct) : '',
    })
    setErro(null)
  }

  async function salvarMedicao() {
    if (!medForm) return
    const bruto = parseNumBR(medForm.valor_bruto) || 0
    if (bruto <= 0) { setErro('Informe o valor bruto medido (maior que zero).'); return }
    const inss = parseNumBR(medForm.inss_pct) || 0
    const iss = parseNumBR(medForm.iss_pct) || 0
    if (inss < 0 || inss > 100) { setErro('O INSS deve estar entre 0 e 100%.'); return }
    if (iss < 0 || iss > 100) { setErro('O ISS deve estar entre 0 e 100%.'); return }
    setMedSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_subempreiteiro_medicao_salvar', {
      p_medicao: {
        medicao_id: medForm.medicao_id,
        contrato_id: medForm.contrato_id,
        competencia: medForm.competencia || null,
        data_medicao: medForm.data_medicao || null,
        valor_bruto: bruto,
        inss_pct: inss,
        iss_pct: iss,
        status: medForm.status,
        observacoes: medForm.observacoes.trim() || null,
      },
    })
    setMedSalvando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível salvar a medição.')); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível salvar a medição.'); return }
    const cid = medForm.contrato_id
    setMedForm(null)
    await carregarMedicoes(cid)
  }

  async function excluirMedicao(contratoId: string, m: Medicao) {
    const motivo = prompt('Excluir esta medição? Fica registrado quem excluiu e o motivo (a medição não some do histórico). Motivo:')
    if (motivo === null) return
    if (!motivo.trim()) { setErro('Informe o motivo da exclusão.'); return }
    setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_subempreiteiro_medicao_excluir', { p_medicao_id: m.id, p_motivo: motivo })
    if (error) { setErro(erroAmigavel(error, 'Não foi possível excluir a medição.')); return }
    const r = (data ?? {}) as { ok?: boolean; erro?: string }
    if (r.ok === false) { setErro(r.erro ?? 'Não foi possível excluir a medição.'); return }
    await carregarMedicoes(contratoId)
  }

  const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18 }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: ESP, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }
  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: ESP, background: BG, width: '100%' }
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({ background: bg, color: fg, border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })

  const totalSubs = useMemo(() => contratos.reduce((s, c) => s + (Number(c.valor_total) || 0), 0), [contratos])

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: 0 }}>Subempreiteiros</h1>
          {obra?.nome && <span style={{ fontSize: 14, color: MUT }}>{obra.nome}</span>}
        </div>
        <p style={{ fontSize: 13, color: MUT, marginTop: 4, maxWidth: 680 }}>
          Os contratos de mão de obra terceirizada desta obra: quem executa, o escopo contratado e a retenção prevista. O pagamento por medição (com retenção/encargos) é tratado no financeiro, em etapa própria.
        </p>

        {erro && <div style={{ ...card, borderColor: VERM, color: VERM, marginTop: 14, fontSize: 13 }}>{erro}</div>}

        {emLiberacao ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Recurso de subempreiteiros sendo liberado para esta empresa. Atualize em instantes.</div>
        ) : carregando ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Carregando…</div>
        ) : !obra ? (
          <div style={{ ...card, marginTop: 16, color: MUT, fontSize: 13 }}>Obra não encontrada ou sem acesso.</div>
        ) : (
          <>
            {/* Indicador: total contratado em subempreiteiros */}
            <div style={{ ...card, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: MUT }}>Total contratado em subempreiteiros</span>
              <AjudaCampo chave="projetos.subempreiteiro.total_contratado" rota={ROTA} />
              <strong style={{ color: ESP, fontSize: 18, marginLeft: 'auto' }}>{brl(totalSubs)}</strong>
            </div>

            {/* Barra de ações + filtro */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={abrirNovo} style={btn(GOLD, ESP)} data-testid="sub-novo">+ Novo contrato</button>
              <AjudaCampo chave="projetos.subempreiteiro.novo" rota={ROTA} />
              <span style={{ flex: 1 }} />
              <label style={lbl}>
                Mostrar <AjudaCampo chave="projetos.subempreiteiro.filtro_status" rota={ROTA} />
                <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} style={{ ...inp, width: 'auto' }} data-testid="sub-filtro">
                  <option value="todos">Todos</option>
                  <option value="rascunho">Rascunho</option>
                  <option value="ativo">Ativo</option>
                  <option value="concluido">Concluído</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </label>
            </div>

            {/* Formulário de contrato (criar/editar) */}
            {abrirForm && (
              <div style={{ ...card, marginTop: 12 }} data-testid="sub-form">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ color: ESP, fontSize: 15 }}>{form.contrato_id ? 'Editar contrato' : 'Novo contrato'}</strong>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => { setAbrirForm(false); setForm(formVazio()) }} style={{ ...btn('transparent', MUT), border: `1px solid ${LINE}`, padding: '6px 12px' }}>Fechar</button>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                  <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 260, flex: 1 }}>
                    <span>Subempreiteiro (fornecedor) <AjudaCampo chave="projetos.subempreiteiro.fornecedor" rota={ROTA} /></span>
                    <select value={form.fornecedor_id} onChange={(e) => setForm((f) => ({ ...f, fornecedor_id: e.target.value }))} style={{ ...inp, marginTop: 4 }} data-testid="sub-fornecedor">
                      <option value="">Selecione…</option>
                      {fornecedores.map((f) => <option key={f.id} value={f.id}>{nomeForn(f)}</option>)}
                    </select>
                    {fornecedores.length === 0 && <span style={{ fontSize: 12, color: MUT, marginTop: 4 }}>Nenhum fornecedor cadastrado nesta empresa. Cadastre o subempreiteiro em Fornecedores antes.</span>}
                  </label>
                  <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 160 }}>
                    <span>Nº do contrato <AjudaCampo chave="projetos.subempreiteiro.numero" rota={ROTA} /></span>
                    <input value={form.numero} onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))} style={{ ...inp, marginTop: 4 }} placeholder="Opcional" data-testid="sub-numero" />
                  </label>
                </div>

                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', marginTop: 14 }}>
                  <span>Objeto do contrato <AjudaCampo chave="projetos.subempreiteiro.objeto" rota={ROTA} /></span>
                  <input value={form.objeto} onChange={(e) => setForm((f) => ({ ...f, objeto: e.target.value }))} style={{ ...inp, marginTop: 4 }} placeholder="Ex.: Execução da estrutura de concreto armado" data-testid="sub-objeto" />
                </label>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
                  <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 140 }}>
                    <span>Retenção (%) <AjudaCampo chave="projetos.subempreiteiro.retencao" rota={ROTA} /></span>
                    <input inputMode="decimal" value={form.retencao_pct} onChange={(e) => setForm((f) => ({ ...f, retencao_pct: e.target.value }))} style={{ ...inp, marginTop: 4 }} placeholder="0" data-testid="sub-retencao" />
                  </label>
                  <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 160 }}>
                    <span>Início <AjudaCampo chave="projetos.subempreiteiro.data_inicio" rota={ROTA} /></span>
                    <input type="date" value={form.data_inicio} onChange={(e) => setForm((f) => ({ ...f, data_inicio: e.target.value }))} style={{ ...inp, marginTop: 4 }} data-testid="sub-data-inicio" />
                  </label>
                  <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 160 }}>
                    <span>Fim previsto <AjudaCampo chave="projetos.subempreiteiro.data_fim" rota={ROTA} /></span>
                    <input type="date" value={form.data_fim_prevista} onChange={(e) => setForm((f) => ({ ...f, data_fim_prevista: e.target.value }))} style={{ ...inp, marginTop: 4 }} data-testid="sub-data-fim" />
                  </label>
                  <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 160 }}>
                    <span>Situação <AjudaCampo chave="projetos.subempreiteiro.status" rota={ROTA} /></span>
                    <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={{ ...inp, marginTop: 4 }} data-testid="sub-status">
                      <option value="rascunho">Rascunho</option>
                      <option value="ativo">Ativo</option>
                      <option value="concluido">Concluído</option>
                      <option value="cancelado">Cancelado</option>
                    </select>
                  </label>
                </div>

                <div style={{ ...lbl, marginTop: 16 }}>Itens do contrato <AjudaCampo chave="projetos.subempreiteiro.itens" rota={ROTA} /></div>
                <div style={{ marginTop: 6, overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: MUT, textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>Descrição <AjudaCampo chave="projetos.subempreiteiro.item_descricao" rota={ROTA} /></th>
                        <th style={{ padding: '6px 8px', width: 90 }}>Unidade</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', width: 110 }}>Quantidade</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', width: 130 }}>Preço unit.</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', width: 130 }}>Valor</th>
                        <th style={{ padding: '6px 8px', width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {form.itens.map((l, i) => {
                        const q = parseNumBR(l.quantidade) ?? NaN
                        const p = parseNumBR(l.preco_unitario) ?? NaN
                        const v = isFinite(q) && isFinite(p) ? q * p : 0
                        return (
                          <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                            <td style={{ padding: '6px 8px' }}>
                              <input value={l.descricao} onChange={(e) => setItem(i, 'descricao', e.target.value)} style={inp} placeholder="Ex.: Alvenaria de vedação" data-testid={`sub-item-desc-${i}`} />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input value={l.unidade} onChange={(e) => setItem(i, 'unidade', e.target.value)} style={inp} placeholder="m², vb…" data-testid={`sub-item-un-${i}`} />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input inputMode="decimal" value={l.quantidade} onChange={(e) => setItem(i, 'quantidade', e.target.value)} style={{ ...inp, textAlign: 'right' }} placeholder="0" data-testid={`sub-item-qtd-${i}`} />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input inputMode="decimal" value={l.preco_unitario} onChange={(e) => setItem(i, 'preco_unitario', e.target.value)} style={{ ...inp, textAlign: 'right' }} placeholder="0,00" data-testid={`sub-item-preco-${i}`} />
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(v)}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <button onClick={() => removerItem(i)} title="Remover item" style={{ ...btn('transparent', VERM), padding: '4px 8px', border: `1px solid ${LINE}` }} data-testid={`sub-item-remover-${i}`}>×</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <button onClick={addItem} style={{ ...btn('transparent', GOLD), border: `1px dashed ${LINE}`, marginTop: 8 }} data-testid="sub-item-add">+ Adicionar item</button>

                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', marginTop: 14 }}>
                  <span>Observações <AjudaCampo chave="projetos.subempreiteiro.observacoes" rota={ROTA} /></span>
                  <textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={2} style={{ ...inp, marginTop: 4, resize: 'vertical' }} placeholder="Opcional — condições, garantias, referências do contrato." data-testid="sub-obs" />
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, color: ESP }}>
                    <span style={{ color: MUT }}>Valor do contrato </span>
                    <AjudaCampo chave="projetos.subempreiteiro.valor_total" rota={ROTA} />
                    <strong style={{ marginLeft: 6 }}>{brl(previaTotal)}</strong>
                  </div>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => void salvar()} disabled={salvando} style={{ ...btn(ESP), opacity: salvando ? 0.6 : 1 }} data-testid="sub-salvar">
                    {salvando ? 'Salvando…' : form.contrato_id ? 'Salvar alterações' : 'Salvar contrato'}
                  </button>
                </div>
              </div>
            )}

            {/* Lista de contratos */}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {contratosFiltrados.length === 0 ? (
                <div style={{ ...card, color: MUT, fontSize: 13 }}>
                  {contratos.length === 0 ? 'Nenhum subempreiteiro contratado nesta obra ainda. Use “+ Novo contrato” para registrar quem executa parte do escopo.' : 'Nenhum contrato no filtro selecionado.'}
                </div>
              ) : contratosFiltrados.map((c) => {
                const st = STATUS_LABEL[c.status] ?? { l: c.status, cor: MUT }
                const aberto = expandido === c.id
                return (
                  <div key={c.id} style={card} data-testid={`sub-row-${c.id}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <strong style={{ color: ESP, fontSize: 15 }}>{c.fornecedor_nome ?? '(sem nome)'}</strong>
                      {c.numero && <span style={{ fontSize: 12, color: MUT }}>Contrato {c.numero}</span>}
                      <span style={{ fontSize: 12, fontWeight: 700, color: st.cor, border: `1px solid ${st.cor}`, borderRadius: 999, padding: '2px 10px' }}>{st.l}</span>
                      {(c.retencao_pct ?? 0) > 0 && <span style={{ fontSize: 12, color: MUT }}>Retenção {Number(c.retencao_pct)}%</span>}
                      <span style={{ flex: 1 }} />
                      <strong style={{ color: ESP, fontSize: 15 }}>{brl(c.valor_total)}</strong>
                    </div>
                    {c.objeto && <p style={{ fontSize: 13, color: ESP, margin: '8px 0 0' }}>{c.objeto}</p>}
                    <div style={{ fontSize: 12, color: MUT, marginTop: 6 }}>
                      {fmtData(c.data_inicio)} → {fmtData(c.data_fim_prevista)}
                    </div>
                    {c.observacoes && <p style={{ fontSize: 13, color: MUT, margin: '6px 0 0' }}>{c.observacoes}</p>}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => setExpandido(aberto ? null : c.id)} style={{ ...btn('transparent', GOLD), padding: '6px 10px', border: `1px solid ${LINE}` }}>
                        {aberto ? 'Ocultar itens' : `Ver itens (${c.itens.length})`}
                      </button>
                      <button onClick={() => alternarMedicoes(c.id)} style={{ ...btn('transparent', GOLD), padding: '6px 10px', border: `1px solid ${LINE}` }} data-testid={`sub-medicoes-${c.id}`}>
                        {medExpandido === c.id ? 'Ocultar medições' : 'Medições'}
                      </button>
                      <AjudaCampo chave="projetos.subempreiteiro.medicoes" rota={ROTA} />
                      <button onClick={() => abrirEdicao(c)} style={{ ...btn('transparent', ESP), padding: '6px 10px', border: `1px solid ${LINE}` }} data-testid={`sub-editar-${c.id}`}>Editar</button>
                      <AjudaCampo chave="projetos.subempreiteiro.editar" rota={ROTA} />
                      <span style={{ flex: 1 }} />
                      <button onClick={() => void excluir(c)} style={{ ...btn('transparent', VERM), padding: '6px 10px', border: `1px solid ${VERM}` }} data-testid={`sub-excluir-${c.id}`}>Excluir</button>
                      <AjudaCampo chave="projetos.subempreiteiro.excluir" rota={ROTA} />
                    </div>

                    {aberto && (
                      <div style={{ marginTop: 12, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ color: MUT, textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px' }}>Item</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qtd.</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Preço unit.</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.itens.length === 0 ? (
                              <tr><td colSpan={4} style={{ padding: '6px 8px', color: MUT }}>Sem itens detalhados.</td></tr>
                            ) : c.itens.map((it, idx) => (
                              <tr key={it.id ?? idx} style={{ borderTop: `1px solid ${LINE}` }}>
                                <td style={{ padding: '6px 8px', color: ESP }}>{it.descricao || '—'}{it.unidade ? <span style={{ color: MUT }}> ({it.unidade})</span> : null}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{Number(it.quantidade) || 0}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(it.preco_unitario)}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(it.valor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {medExpandido === c.id && (
                      <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 12 }} data-testid={`sub-medicoes-painel-${c.id}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ color: ESP, fontSize: 14 }}>Medições do subempreiteiro</strong>
                          <AjudaCampo chave="projetos.subempreiteiro.medicoes" rota={ROTA} />
                          <span style={{ flex: 1 }} />
                          <button onClick={() => abrirMedNova(c.id)} style={{ ...btn(GOLD, ESP), padding: '6px 12px' }} data-testid={`sub-medicao-nova-${c.id}`}>+ Nova medição</button>
                          <AjudaCampo chave="projetos.subempreiteiro.medicao_nova" rota={ROTA} />
                        </div>
                        <p style={{ fontSize: 12, color: MUT, margin: '6px 0 0' }}>
                          Registre o quanto foi medido do subempreiteiro por período. O pagamento (com retenção, INSS e ISS) é gerado no financeiro, em etapa própria.
                        </p>

                        {/* Progresso de execução: quanto já foi medido (aprovado) do contratado — margem de execução H7 */}
                        {(() => {
                          const lista = medicoes[c.id] ?? []
                          const contratado = Number(c.valor_total) || 0
                          const medidoAprovado = lista
                            .filter((m) => m.status === 'aprovada')
                            .reduce((s, m) => s + (Number(m.valor_bruto) || 0), 0)
                          if (contratado <= 0 && medidoAprovado <= 0) return null
                          const pct = contratado > 0 ? Math.min(100, Math.round((medidoAprovado / contratado) * 100)) : 0
                          const saldo = contratado - medidoAprovado
                          return (
                            <div style={{ marginTop: 10 }} data-testid={`sub-execucao-${c.id}`}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: MUT, flexWrap: 'wrap' }}>
                                <span>
                                  Medido (aprovado) <strong style={{ color: ESP }}>{brl(medidoAprovado)}</strong>
                                  {contratado > 0 && <> de <strong style={{ color: ESP }}>{brl(contratado)}</strong> contratado — <strong style={{ color: ESP }}>{pct}%</strong></>}
                                </span>
                                <AjudaCampo chave="projetos.subempreiteiro.execucao_progresso" rota={ROTA} />
                                <span style={{ flex: 1 }} />
                                {contratado > 0 && (
                                  <span>Saldo a medir <strong style={{ color: saldo < 0 ? VERM : ESP }}>{brl(saldo)}</strong></span>
                                )}
                              </div>
                              {contratado > 0 && (
                                <div style={{ height: 6, borderRadius: 999, background: LINE, marginTop: 6, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: GOLD, borderRadius: 999 }} />
                                </div>
                              )}
                            </div>
                          )
                        })()}

                        {medForm && medForm.contrato_id === c.id && (() => {
                          const bruto = parseNumBR(medForm.valor_bruto) || 0
                          const ret = Number(c.retencao_pct) || 0
                          const inss = parseNumBR(medForm.inss_pct) || 0
                          const iss = parseNumBR(medForm.iss_pct) || 0
                          const vret = Math.round(bruto * ret) / 100
                          const vinss = Math.round(bruto * inss) / 100
                          const viss = Math.round(bruto * iss) / 100
                          const liq = bruto - vret - vinss - viss
                          return (
                            <div style={{ ...card, marginTop: 10, background: BG }} data-testid={`sub-medicao-form-${c.id}`}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <strong style={{ color: ESP, fontSize: 14 }}>{medForm.medicao_id ? 'Editar medição' : 'Nova medição'}</strong>
                                <span style={{ flex: 1 }} />
                                <button onClick={() => setMedForm(null)} style={{ ...btn('transparent', MUT), border: `1px solid ${LINE}`, padding: '6px 12px' }}>Fechar</button>
                              </div>
                              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
                                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 150 }}>
                                  <span>Competência <AjudaCampo chave="projetos.subempreiteiro.medicao_competencia" rota={ROTA} /></span>
                                  <input type="month" value={medForm.competencia ? medForm.competencia.slice(0, 7) : ''} onChange={(e) => setMedForm((f) => f && ({ ...f, competencia: e.target.value ? `${e.target.value}-01` : '' }))} style={{ ...inp, marginTop: 4 }} data-testid={`sub-medicao-competencia-${c.id}`} />
                                </label>
                                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 160 }}>
                                  <span>Data da medição <AjudaCampo chave="projetos.subempreiteiro.medicao_data" rota={ROTA} /></span>
                                  <input type="date" value={medForm.data_medicao} onChange={(e) => setMedForm((f) => f && ({ ...f, data_medicao: e.target.value }))} style={{ ...inp, marginTop: 4 }} data-testid={`sub-medicao-data-${c.id}`} />
                                </label>
                                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 160 }}>
                                  <span>Valor bruto medido <AjudaCampo chave="projetos.subempreiteiro.medicao_valor_bruto" rota={ROTA} /></span>
                                  <input inputMode="decimal" value={medForm.valor_bruto} onChange={(e) => setMedForm((f) => f && ({ ...f, valor_bruto: e.target.value }))} style={{ ...inp, marginTop: 4 }} placeholder="0,00" data-testid={`sub-medicao-valor-${c.id}`} />
                                </label>
                                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 120 }}>
                                  <span>INSS retido (%) <AjudaCampo chave="projetos.subempreiteiro.medicao_inss" rota={ROTA} /></span>
                                  <input inputMode="decimal" value={medForm.inss_pct} onChange={(e) => setMedForm((f) => f && ({ ...f, inss_pct: e.target.value }))} style={{ ...inp, marginTop: 4 }} placeholder="0" data-testid={`sub-medicao-inss-${c.id}`} />
                                </label>
                                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 120 }}>
                                  <span>ISS retido (%) <AjudaCampo chave="projetos.subempreiteiro.medicao_iss" rota={ROTA} /></span>
                                  <input inputMode="decimal" value={medForm.iss_pct} onChange={(e) => setMedForm((f) => f && ({ ...f, iss_pct: e.target.value }))} style={{ ...inp, marginTop: 4 }} placeholder="0" data-testid={`sub-medicao-iss-${c.id}`} />
                                </label>
                                <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', minWidth: 150 }}>
                                  <span>Situação <AjudaCampo chave="projetos.subempreiteiro.medicao_status" rota={ROTA} /></span>
                                  <select value={medForm.status} onChange={(e) => setMedForm((f) => f && ({ ...f, status: e.target.value }))} style={{ ...inp, marginTop: 4 }} data-testid={`sub-medicao-status-${c.id}`}>
                                    <option value="rascunho">Rascunho</option>
                                    <option value="aprovada">Aprovada</option>
                                    <option value="cancelada">Cancelada</option>
                                  </select>
                                </label>
                              </div>
                              <label style={{ ...lbl, flexDirection: 'column', alignItems: 'stretch', marginTop: 12 }}>
                                <span>Observações <AjudaCampo chave="projetos.subempreiteiro.medicao_observacoes" rota={ROTA} /></span>
                                <textarea value={medForm.observacoes} onChange={(e) => setMedForm((f) => f && ({ ...f, observacoes: e.target.value }))} rows={2} style={{ ...inp, marginTop: 4, resize: 'vertical' }} placeholder="Opcional — referência da medição, boletim, nota." data-testid={`sub-medicao-obs-${c.id}`} />
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                                <div style={{ fontSize: 13, color: ESP }}>
                                  <span style={{ color: MUT }}>Líquido (após retenção, INSS e ISS) </span>
                                  <AjudaCampo chave="projetos.subempreiteiro.medicao_liquido" rota={ROTA} />
                                  <strong style={{ marginLeft: 6 }}>{brl(liq)}</strong>
                                  {(vret + vinss + viss) > 0 && (
                                    <span style={{ color: MUT, marginLeft: 8 }}>
                                      ({[ret > 0 ? `retenção ${brl(vret)}` : null, inss > 0 ? `INSS ${brl(vinss)}` : null, iss > 0 ? `ISS ${brl(viss)}` : null].filter(Boolean).join(' · ')})
                                    </span>
                                  )}
                                </div>
                                <span style={{ flex: 1 }} />
                                <button onClick={() => void salvarMedicao()} disabled={medSalvando} style={{ ...btn(ESP), opacity: medSalvando ? 0.6 : 1 }} data-testid={`sub-medicao-salvar-${c.id}`}>
                                  {medSalvando ? 'Salvando…' : medForm.medicao_id ? 'Salvar alterações' : 'Salvar medição'}
                                </button>
                              </div>
                            </div>
                          )
                        })()}

                        <div style={{ marginTop: 10, overflowX: 'auto' }}>
                          {medCarregando === c.id ? (
                            <div style={{ fontSize: 13, color: MUT }}>Carregando medições…</div>
                          ) : (medicoes[c.id]?.length ?? 0) === 0 ? (
                            <div style={{ fontSize: 13, color: MUT }}>Nenhuma medição registrada para este contrato ainda. Use “+ Nova medição” para lançar a primeira.</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                              <thead>
                                <tr style={{ color: MUT, textAlign: 'left' }}>
                                  <th style={{ padding: '6px 8px' }}>Competência</th>
                                  <th style={{ padding: '6px 8px' }}>Data</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Bruto</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Retenção</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>INSS</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>ISS</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Líquido</th>
                                  <th style={{ padding: '6px 8px' }}>Situação</th>
                                  <th style={{ padding: '6px 8px', width: 150 }} />
                                </tr>
                              </thead>
                              <tbody>
                                {(medicoes[c.id] ?? []).map((m) => {
                                  const mst = MED_STATUS[m.status] ?? { l: m.status, cor: MUT }
                                  return (
                                    <tr key={m.id} style={{ borderTop: `1px solid ${LINE}` }} data-testid={`sub-medicao-row-${m.id}`}>
                                      <td style={{ padding: '6px 8px', color: ESP }}>{fmtComp(m.competencia)}</td>
                                      <td style={{ padding: '6px 8px', color: ESP }}>{fmtData(m.data_medicao)}</td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(m.valor_bruto)}</td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{brl(m.valor_retencao)}</td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{brl(m.valor_inss)}</td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT }}>{brl(m.valor_iss)}</td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', color: ESP }}>{brl(m.valor_liquido)}</td>
                                      <td style={{ padding: '6px 8px' }}><span style={{ fontSize: 12, fontWeight: 700, color: mst.cor }}>{mst.l}</span></td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        <button onClick={() => abrirMedEdicao(c.id, m)} style={{ ...btn('transparent', ESP), padding: '4px 8px', border: `1px solid ${LINE}` }} data-testid={`sub-medicao-editar-${m.id}`}>Editar</button>
                                        <AjudaCampo chave="projetos.subempreiteiro.medicao_editar" rota={ROTA} />
                                        <button onClick={() => void excluirMedicao(c.id, m)} style={{ ...btn('transparent', VERM), padding: '4px 8px', border: `1px solid ${VERM}`, marginLeft: 6 }} data-testid={`sub-medicao-excluir-${m.id}`}>Excluir</button>
                                        <AjudaCampo chave="projetos.subempreiteiro.medicao_excluir" rota={ROTA} />
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
