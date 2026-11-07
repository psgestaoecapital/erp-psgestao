'use client'
// P&M · Eventos & Produções (CEO 31/10). Lista + CRUD completo (incluir/editar/excluir rastreável) sobre
// agency_eventos, por company_id (RD-45). Escrita só pelas RPCs fn_pm_evento_salvar/_excluir (guarda de empresa,
// audit_log_global, soft-delete). Passo 3 (itens/fornecedores + checklist): painel por evento sobre
// agency_evento_item/agency_evento_checklist (escrita só pelas RPCs fn_pm_evento_item_* / fn_pm_evento_checklist_*).
// "?" em todo campo/indicador/ação (RD-95). Previsto × Realizado: o realizado vem do financeiro da GE (erp_pagar)
// pelos custos vinculados ao evento (agency_evento_pagar / fn_pm_evento_resultado). Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import { erroAmigavel, codigoAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/pm/eventos'
const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const RED = '#7A1F1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')

const STATUS: { v: string; l: string; cor: string }[] = [
  { v: 'planejado', l: 'Planejado', cor: '#FFF3D6' }, { v: 'confirmado', l: 'Confirmado', cor: '#FCE9C2' },
  { v: 'realizado', l: 'Realizado', cor: '#DCEFD7' }, { v: 'cancelado', l: 'Cancelado', cor: '#F4D6D6' },
]
const stCfg = (v: string) => STATUS.find((s) => s.v === v) ?? { v, l: v, cor: OFFWHITE }
const ITEM_STATUS: { v: string; l: string; cor: string }[] = [
  { v: 'a_contratar', l: 'A contratar', cor: '#FFF3D6' }, { v: 'contratado', l: 'Contratado', cor: '#FCE9C2' },
  { v: 'entregue', l: 'Entregue', cor: '#DCEFD7' }, { v: 'cancelado', l: 'Cancelado', cor: '#F4D6D6' },
]
const itCfg = (v: string) => ITEM_STATUS.find((s) => s.v === v) ?? { v, l: v, cor: OFFWHITE }

type Evento = { id: string; cliente_id: string | null; nome: string; tipo: string | null; data_inicio: string | null; data_fim: string | null; local: string | null; status: string; orcamento_previsto: number | null; responsavel_id: string | null; observacoes: string | null }
type Cli = { id: string; nome: string }
type Pessoa = { id: string; nome: string }
type FormState = { id: string | null; nome: string; cliente_id: string; tipo: string; data_inicio: string; data_fim: string; local: string; status: string; orcamento_previsto: string; responsavel_id: string; observacoes: string }
const FORM_VAZIO: FormState = { id: null, nome: '', cliente_id: '', tipo: '', data_inicio: '', data_fim: '', local: '', status: 'planejado', orcamento_previsto: '', responsavel_id: '', observacoes: '' }

type Item = { id: string; descricao: string; categoria: string | null; fornecedor: string | null; quantidade: number; valor_unitario: number; valor_total: number; status: string; observacao: string | null; ordem: number }
type ItemForm = { id: string | null; descricao: string; categoria: string; fornecedor: string; quantidade: string; valor_unitario: string; status: string; observacao: string }
const ITEM_VAZIO: ItemForm = { id: null, descricao: '', categoria: '', fornecedor: '', quantidade: '1', valor_unitario: '', status: 'a_contratar', observacao: '' }
type Chk = { id: string; descricao: string; concluido: boolean; prazo: string | null; ordem: number }
type ChkForm = { id: string | null; descricao: string; prazo: string }
const CHK_VAZIO: ChkForm = { id: null, descricao: '', prazo: '' }

type Resultado = { previsto: number; realizado: number; saldo: number; pct: number | null }
type CustoVinc = { vinculo_id: string; lancamento_id: string; descricao: string; fornecedor: string; valor: number; valor_pago: number; status: string; data_vencimento: string | null; data_pagamento: string | null }
type CustoDisp = { lancamento_id: string; descricao: string; fornecedor: string; valor: number; status: string; data_vencimento: string | null }
const PAGAR_ST: Record<string, { l: string; cor: string }> = {
  pago: { l: 'Pago', cor: '#DCEFD7' }, aberto: { l: 'Em aberto', cor: '#FFF3D6' }, vencido: { l: 'Vencido', cor: '#F4D6D6' },
  parcial: { l: 'Parcial', cor: '#FCE9C2' }, incluido_remessa: { l: 'Em remessa', cor: '#E3E8F0' },
}
const pgCfg = (v: string) => PAGAR_ST[v] ?? { l: v, cor: OFFWHITE }

export default function EventosPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [eventos, setEventos] = useState<Evento[]>([]); const [clientes, setClientes] = useState<Cli[]>([]); const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [fCliente, setFCliente] = useState(''); const [fStatus, setFStatus] = useState(''); const [fDe, setFDe] = useState(''); const [fAte, setFAte] = useState('')
  // painel de detalhe (itens + checklist) do evento selecionado
  const [detalhe, setDetalhe] = useState<Evento | null>(null)
  const [itens, setItens] = useState<Item[]>([]); const [checklist, setChecklist] = useState<Chk[]>([])
  const [carregandoDet, setCarregandoDet] = useState(false)
  const [itemForm, setItemForm] = useState<ItemForm | null>(null); const [chkForm, setChkForm] = useState<ChkForm | null>(null)
  // resultado previsto × realizado por evento (vem do financeiro da GE)
  const [resultados, setResultados] = useState<Record<string, Resultado>>({})
  const [custos, setCustos] = useState<CustoVinc[]>([])
  const [disponiveis, setDisponiveis] = useState<CustoDisp[]>([]); const [vincularOpen, setVincularOpen] = useState(false)
  const [buscaCusto, setBuscaCusto] = useState(''); const [carregandoDisp, setCarregandoDisp] = useState(false)

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const [e, c, u, r] = await Promise.all([
      supabase.from('agency_eventos').select('*').eq('company_id', empresa).is('excluido_em', null).order('data_inicio', { ascending: false, nullsFirst: false }),
      supabase.from('erp_clientes').select('id, nome_fantasia, razao_social').eq('company_id', empresa).eq('ativo', true),
      supabase.rpc('fn_usuarios_da_empresa', { p_company_id: empresa }),
      supabase.rpc('fn_pm_eventos_resultado', { p_company_id: empresa }),
    ])
    setEventos((e.data ?? []) as Evento[])
    setClientes(((c.data ?? []) as { id: string; nome_fantasia: string | null; razao_social: string | null }[]).map((x) => ({ id: x.id, nome: x.nome_fantasia || x.razao_social || 'cliente' })))
    setPessoas(((u.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((x) => ({ id: x.id, nome: x.full_name ?? x.email })))
    const mapa: Record<string, Resultado> = {}
    ;((r.data ?? []) as { evento_id: string; previsto: number; realizado: number; saldo: number; pct: number | null }[]).forEach((x) => {
      mapa[x.evento_id] = { previsto: Number(x.previsto), realizado: Number(x.realizado), saldo: Number(x.saldo), pct: x.pct == null ? null : Number(x.pct) }
    })
    setResultados(mapa)
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])
  const nomeCli = (id: string | null) => clientes.find((x) => x.id === id)?.nome ?? '—'

  const filtrados = useMemo(() => eventos.filter((e) =>
    (!fCliente || e.cliente_id === fCliente) && (!fStatus || e.status === fStatus) &&
    (!fDe || (e.data_inicio ?? '') >= fDe) && (!fAte || (e.data_inicio ?? '') <= fAte)
  ), [eventos, fCliente, fStatus, fDe, fAte])

  const hoje = new Date().toISOString().slice(0, 10)
  const kpis = useMemo(() => ({
    total: filtrados.length,
    proximos: filtrados.filter((e) => ['planejado', 'confirmado'].includes(e.status) && (e.data_inicio ?? '') >= hoje).length,
    orcamento: filtrados.reduce((s, e) => s + Number(e.orcamento_previsto ?? 0), 0),
    realizado: filtrados.reduce((s, e) => s + (resultados[e.id]?.realizado ?? 0), 0),
  }), [filtrados, hoje, resultados])
  const kpiSaldo = kpis.orcamento - kpis.realizado

  function abrirNovo() { setForm({ ...FORM_VAZIO }) }
  function abrirEditar(e: Evento) {
    setForm({ id: e.id, nome: e.nome, cliente_id: e.cliente_id ?? '', tipo: e.tipo ?? '', data_inicio: e.data_inicio ?? '', data_fim: e.data_fim ?? '', local: e.local ?? '', status: e.status, orcamento_previsto: e.orcamento_previsto != null ? String(e.orcamento_previsto) : '', responsavel_id: e.responsavel_id ?? '', observacoes: e.observacoes ?? '' })
  }
  async function salvar() {
    if (!empresa || !form) return
    if (!form.nome.trim()) { setToast('Informe o nome do evento.'); return }
    setBusy(true)
    const dados = {
      nome: form.nome.trim(), cliente_id: form.cliente_id || null, tipo: form.tipo || null,
      data_inicio: form.data_inicio || null, data_fim: form.data_fim || null, local: form.local || null,
      status: form.status, orcamento_previsto: form.orcamento_previsto.replace(',', '.') || null,
      responsavel_id: form.responsavel_id || null, observacoes: form.observacoes || null,
    }
    const { data, error } = await supabase.rpc('fn_pm_evento_salvar', { p_company_id: empresa, p_id: form.id, p_dados: dados })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível salvar o evento. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível salvar o evento. Tente de novo.')); return }
    setForm(null); setToast(form.id ? 'Evento atualizado.' : 'Evento criado.'); void carregar()
  }
  async function excluir(e: Evento) {
    const motivo = prompt(`Excluir o evento "${e.nome}"? Informe o motivo (fica na auditoria):`)
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_evento_excluir', { p_id: e.id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível excluir o evento. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível excluir o evento. Tente de novo.')); return }
    setToast('Evento excluído (registrado na auditoria).'); void carregar()
  }

  // ---- Painel de detalhe (itens + checklist)
  async function abrirDetalhe(e: Evento) {
    setDetalhe(e); setItemForm(null); setChkForm(null); await carregarDetalhe(e.id)
  }
  async function carregarDetalhe(eventoId: string) {
    setCarregandoDet(true)
    const [i, c, pg] = await Promise.all([
      supabase.from('agency_evento_item').select('id, descricao, categoria, fornecedor, quantidade, valor_unitario, valor_total, status, observacao, ordem').eq('evento_id', eventoId).is('excluido_em', null).order('ordem', { ascending: true }).order('criado_em', { ascending: true }),
      supabase.from('agency_evento_checklist').select('id, descricao, concluido, prazo, ordem').eq('evento_id', eventoId).is('excluido_em', null).order('ordem', { ascending: true }).order('criado_em', { ascending: true }),
      supabase.rpc('fn_pm_evento_pagar_listar', { p_evento_id: eventoId }),
    ])
    setItens(((i.data ?? []) as Item[]).map((x) => ({ ...x, quantidade: Number(x.quantidade), valor_unitario: Number(x.valor_unitario), valor_total: Number(x.valor_total) })))
    setChecklist((c.data ?? []) as Chk[])
    setCustos(((pg.data ?? []) as CustoVinc[]).map((x) => ({ ...x, valor: Number(x.valor), valor_pago: Number(x.valor_pago) })))
    setCarregandoDet(false)
  }
  async function abrirVincular() {
    if (!empresa) return
    setVincularOpen(true); setCarregandoDisp(true); setBuscaCusto('')
    const { data } = await supabase.rpc('fn_pm_evento_pagar_disponiveis', { p_company_id: empresa, p_busca: null })
    setDisponiveis(((data ?? []) as CustoDisp[]).map((x) => ({ ...x, valor: Number(x.valor) })))
    setCarregandoDisp(false)
  }
  async function buscarDisponiveis(termo: string) {
    if (!empresa) return
    setBuscaCusto(termo); setCarregandoDisp(true)
    const { data } = await supabase.rpc('fn_pm_evento_pagar_disponiveis', { p_company_id: empresa, p_busca: termo || null })
    setDisponiveis(((data ?? []) as CustoDisp[]).map((x) => ({ ...x, valor: Number(x.valor) })))
    setCarregandoDisp(false)
  }
  async function vincularCusto(lancamentoId: string) {
    if (!detalhe) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_evento_pagar_vincular', { p_evento_id: detalhe.id, p_lancamento_id: lancamentoId })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível vincular o custo ao evento. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível vincular o custo ao evento. Tente de novo.')); return }
    setToast('Custo vinculado ao evento.'); setVincularOpen(false)
    await carregarDetalhe(detalhe.id); void carregar()
  }
  async function desvincularCusto(c: CustoVinc) {
    if (!detalhe) return
    const motivo = prompt(`Desvincular "${c.descricao}" deste evento? (o lançamento continua intacto no financeiro)\nInforme o motivo (fica na auditoria):`)
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_evento_pagar_desvincular', { p_id: c.vinculo_id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível desvincular o custo. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível desvincular o custo. Tente de novo.')); return }
    setToast('Custo desvinculado (registrado na auditoria).')
    await carregarDetalhe(detalhe.id); void carregar()
  }
  async function salvarItem() {
    if (!detalhe || !itemForm) return
    if (!itemForm.descricao.trim()) { setToast('Informe a descrição do item.'); return }
    setBusy(true)
    const dados = {
      descricao: itemForm.descricao.trim(), categoria: itemForm.categoria || null, fornecedor: itemForm.fornecedor || null,
      quantidade: itemForm.quantidade.replace(',', '.') || '1', valor_unitario: itemForm.valor_unitario.replace(',', '.') || '0',
      status: itemForm.status, observacao: itemForm.observacao || null,
    }
    const { data, error } = await supabase.rpc('fn_pm_evento_item_salvar', { p_evento_id: detalhe.id, p_id: itemForm.id, p_dados: dados })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível salvar o item. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível salvar o item. Tente de novo.')); return }
    setItemForm(null); setToast(itemForm.id ? 'Item atualizado.' : 'Item adicionado.'); await carregarDetalhe(detalhe.id)
  }
  async function excluirItem(it: Item) {
    if (!detalhe) return
    const motivo = prompt(`Excluir o item "${it.descricao}"? Informe o motivo (fica na auditoria):`)
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_evento_item_excluir', { p_id: it.id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível excluir o item. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível excluir o item. Tente de novo.')); return }
    setToast('Item excluído (registrado na auditoria).'); await carregarDetalhe(detalhe.id)
  }
  async function salvarChk() {
    if (!detalhe || !chkForm) return
    if (!chkForm.descricao.trim()) { setToast('Informe a tarefa.'); return }
    setBusy(true)
    const dados = { descricao: chkForm.descricao.trim(), prazo: chkForm.prazo || null }
    const { data, error } = await supabase.rpc('fn_pm_evento_checklist_salvar', { p_evento_id: detalhe.id, p_id: chkForm.id, p_dados: dados })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível salvar a tarefa. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível salvar a tarefa. Tente de novo.')); return }
    setChkForm(null); setToast(chkForm.id ? 'Tarefa atualizada.' : 'Tarefa adicionada.'); await carregarDetalhe(detalhe.id)
  }
  async function toggleChk(c: Chk) {
    if (!detalhe) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_evento_checklist_toggle', { p_id: c.id, p_concluido: !c.concluido })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível atualizar a tarefa. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível atualizar a tarefa. Tente de novo.')); return }
    await carregarDetalhe(detalhe.id)
  }
  async function excluirChk(c: Chk) {
    if (!detalhe) return
    const motivo = prompt(`Excluir a tarefa "${c.descricao}"? Informe o motivo (fica na auditoria):`)
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_pm_evento_checklist_excluir', { p_id: c.id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(error ? erroAmigavel(error, 'Não foi possível excluir a tarefa. Tente de novo.') : codigoAmigavel(j?.erro, 'Não foi possível excluir a tarefa. Tente de novo.')); return }
    setToast('Tarefa excluída (registrada na auditoria).'); await carregarDetalhe(detalhe.id)
  }

  const itensTotal = useMemo(() => itens.reduce((s, i) => s + Number(i.valor_total ?? 0), 0), [itens])
  const chkFeitos = useMemo(() => checklist.filter((c) => c.concluido).length, [checklist])
  const custosRealizado = useMemo(() => custos.reduce((s, c) => s + (c.status !== 'cancelado' ? c.valor : 0), 0), [custos])
  const custosPago = useMemo(() => custos.reduce((s, c) => s + (['pago', 'parcial'].includes(c.status) ? c.valor_pago : 0), 0), [custos])
  const detPrevisto = detalhe ? Number(detalhe.orcamento_previsto ?? 0) : 0
  const detSaldo = detPrevisto - custosRealizado
  const detPct = detPrevisto > 0 ? Math.round((custosRealizado / detPrevisto) * 1000) / 10 : null

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🎬 P&amp;M · Produção</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Eventos &amp; Produções<AjudaCampo chave="pm.eventos.tela" rota={ROTA} /></h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>A agenda das produções da agência: datas, local, cliente, status, orçamento, itens e checklist.</p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={abrirNovo} style={btnPri} data-testid="evento-novo">+ Novo evento</button><AjudaCampo chave="pm.eventos.acao_novo" rota={ROTA} /></span>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
          <Kpi l="Eventos" v={String(kpis.total)} chave="pm.eventos.kpi_total" />
          <Kpi l="Próximos" v={String(kpis.proximos)} cor={DOURADO} chave="pm.eventos.kpi_proximos" />
          <Kpi l="Orçamento previsto" v={brl(kpis.orcamento)} chave="pm.eventos.kpi_orcamento" />
          <Kpi l="Realizado" v={brl(kpis.realizado)} chave="pm.eventos.kpi_realizado" />
          <Kpi l="Saldo" v={brl(kpiSaldo)} cor={kpiSaldo < 0 ? RED : GREEN} chave="pm.eventos.kpi_saldo" />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 10 }}>
          <Filtro label="Cliente" chave="pm.eventos.filtro_cliente">
            <select value={fCliente} onChange={(e) => setFCliente(e.target.value)} style={inp} data-testid="evento-filtro-cliente">
              <option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Filtro>
          <Filtro label="Status" chave="pm.eventos.filtro_status">
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inp} data-testid="evento-filtro-status">
              <option value="">Todos</option>{STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Filtro>
          <Filtro label="De" chave="pm.eventos.filtro_de"><input type="date" value={fDe} onChange={(e) => setFDe(e.target.value)} style={inp} data-testid="evento-filtro-de" /></Filtro>
          <Filtro label="Até" chave="pm.eventos.filtro_ate"><input type="date" value={fAte} onChange={(e) => setFAte(e.target.value)} style={inp} data-testid="evento-filtro-ate" /></Filtro>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : filtrados.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhum evento no filtro. Use “+ Novo evento” para cadastrar.</div>
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 12, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
                <thead style={{ background: OFFWHITE }}><tr><Th chave="pm.eventos.campo_nome">Evento</Th><Th chave="pm.eventos.campo_cliente">Cliente</Th><Th chave="pm.eventos.campo_data_inicio">Início</Th><Th chave="pm.eventos.campo_orcamento">Previsto</Th><Th chave="pm.eventos.col_realizado">Realizado</Th><Th chave="pm.eventos.col_saldo">Saldo / %</Th><Th chave="pm.eventos.campo_status">Status</Th><Th chave="pm.eventos.col_acoes">Ações</Th></tr></thead>
                <tbody>
                  {filtrados.map((e) => {
                    const cfg = stCfg(e.status)
                    return (
                      <tr key={e.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`evento-${e.id}`}>
                        <Td><b>{e.nome}</b>{e.tipo && <span style={{ color: TEXTM, fontSize: 12 }}> · {e.tipo}</span>}</Td>
                        <Td>{nomeCli(e.cliente_id)}</Td>
                        <Td>{dataBR(e.data_inicio)}{e.data_fim && e.data_fim !== e.data_inicio ? `–${dataBR(e.data_fim)}` : ''}</Td>
                        <Td>{brl(Number(e.orcamento_previsto ?? 0))}</Td>
                        <Td>{(resultados[e.id]?.realizado ?? 0) > 0 ? brl(resultados[e.id].realizado) : <span style={{ color: TEXTM }}>—</span>}</Td>
                        <Td>{resultados[e.id] && resultados[e.id].realizado > 0
                          ? <span style={{ color: resultados[e.id].saldo < 0 ? RED : GREEN, fontWeight: 600 }}>{brl(resultados[e.id].saldo)}{resultados[e.id].pct != null ? ` · ${resultados[e.id].pct}%` : ''}</span>
                          : <span style={{ color: TEXTM }}>—</span>}</Td>
                        <Td><span style={{ fontSize: 11, fontWeight: 700, background: cfg.cor, padding: '2px 8px', borderRadius: 999 }}>{cfg.l}</span></Td>
                        <Td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => void abrirDetalhe(e)} style={btnGhost} data-testid={`evento-detalhe-${e.id}`}>Itens e checklist</button><AjudaCampo chave="pm.eventos.acao_detalhe" rota={ROTA} /></span>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => abrirEditar(e)} style={btnGhost} data-testid={`evento-editar-${e.id}`}>Editar</button><AjudaCampo chave="pm.eventos.acao_editar" rota={ROTA} /></span>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => excluir(e)} style={btnDel} data-testid={`evento-excluir-${e.id}`}>Excluir</button><AjudaCampo chave="pm.eventos.acao_excluir" rota={ROTA} /></span>
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* ---- Modal: novo/editar evento ---- */}
      {form && (
        <div role="dialog" aria-modal="true" style={modalWrap} onClick={() => !busy && setForm(null)}>
          <div style={modalBox} onClick={(ev) => ev.stopPropagation()} data-testid="evento-form">
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>{form.id ? 'Editar evento' : 'Novo evento'}</h2>
            <Campo label="Nome" chave="pm.eventos.campo_nome"><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} style={inp} data-testid="evento-f-nome" /></Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo label="Cliente" chave="pm.eventos.campo_cliente" flex>
                <select value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })} style={inp} data-testid="evento-f-cliente">
                  <option value="">— sem cliente —</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
              <Campo label="Tipo" chave="pm.eventos.campo_tipo" flex><input value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} placeholder="gravação, ativação…" style={inp} data-testid="evento-f-tipo" /></Campo>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo label="Início" chave="pm.eventos.campo_data_inicio" flex><input type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} style={inp} data-testid="evento-f-inicio" /></Campo>
              <Campo label="Término" chave="pm.eventos.campo_data_fim" flex><input type="date" value={form.data_fim} onChange={(e) => setForm({ ...form, data_fim: e.target.value })} style={inp} data-testid="evento-f-fim" /></Campo>
            </div>
            <Campo label="Local" chave="pm.eventos.campo_local"><input value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} style={inp} data-testid="evento-f-local" /></Campo>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Campo label="Status" chave="pm.eventos.campo_status" flex>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inp} data-testid="evento-f-status">
                  {STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </Campo>
              <Campo label="Orçamento previsto (R$)" chave="pm.eventos.campo_orcamento" flex><input type="number" min="0" step="0.01" value={form.orcamento_previsto} onChange={(e) => setForm({ ...form, orcamento_previsto: e.target.value })} style={inp} data-testid="evento-f-orcamento" /></Campo>
            </div>
            <Campo label="Responsável" chave="pm.eventos.campo_responsavel">
              <select value={form.responsavel_id} onChange={(e) => setForm({ ...form, responsavel_id: e.target.value })} style={inp} data-testid="evento-f-responsavel">
                <option value="">— a definir —</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Observações" chave="pm.eventos.campo_observacoes"><textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} style={{ ...inp, resize: 'vertical' }} data-testid="evento-f-observacoes" /></Campo>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button disabled={busy} onClick={() => setForm(null)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={salvar} style={btnPri} data-testid="evento-f-salvar">{form.id ? 'Salvar' : 'Criar evento'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Modal: detalhe (itens + checklist) ---- */}
      {detalhe && (
        <div role="dialog" aria-modal="true" style={modalWrap} onClick={() => !busy && setDetalhe(null)}>
          <div style={{ ...modalBox, maxWidth: 720 }} onClick={(ev) => ev.stopPropagation()} data-testid="evento-detalhe">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: DOURADO, fontWeight: 700 }}>Evento</div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 0' }}>{detalhe.nome}</h2>
                <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{nomeCli(detalhe.cliente_id)} · {dataBR(detalhe.data_inicio)} · {stCfg(detalhe.status).l}</div>
              </div>
              <button onClick={() => setDetalhe(null)} style={btnGhost} aria-label="Fechar">Fechar</button>
            </div>

            {/* Previsto × Realizado (financeiro da GE) */}
            <section style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'inline-flex', alignItems: 'center' }}>Custos realizados (financeiro)<AjudaCampo chave="pm.eventos.custos_titulo" rota={ROTA} /></h3>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => void abrirVincular()} style={btnGhost} data-testid="evento-custo-vincular">+ Vincular custo</button><AjudaCampo chave="pm.eventos.custos_vincular" rota={ROTA} /></span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px,1fr))', gap: 8, margin: '10px 0' }}>
                <MiniKpi l="Previsto" v={brl(detPrevisto)} />
                <MiniKpi l="Realizado" v={brl(custosRealizado)} testid="evento-det-realizado" />
                <MiniKpi l="Saldo" v={brl(detSaldo)} cor={detSaldo < 0 ? RED : GREEN} />
                <MiniKpi l="% do previsto" v={detPct != null ? `${detPct}%` : '—'} cor={detPct != null && detPct > 100 ? RED : ESPRESSO} />
              </div>
              {custos.length > 0 && custosPago > 0 && <div style={{ fontSize: 11.5, color: TEXTM, margin: '-2px 0 8px' }}>Pago {brl(custosPago)} · A pagar {brl(custosRealizado - custosPago)}</div>}
              {carregandoDet ? <div style={{ color: TEXTM, fontSize: 13, padding: 12 }}>Carregando…</div>
                : custos.length === 0 ? <div style={{ fontSize: 13, color: TEXTM, background: OFFWHITE, border: `1px dashed ${BORDA}`, borderRadius: 10, padding: 14 }} data-testid="evento-custos-vazio">Nenhum custo lançado ainda. Os custos vêm do financeiro da empresa (Contas a pagar): use “+ Vincular custo” para ligar um lançamento já existente a este evento e acompanhar o realizado.</div>
                : (
                  <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520 }}>
                      <thead style={{ background: OFFWHITE }}><tr>
                        <Th>Custo</Th><Th>Fornecedor</Th><Th>Vencimento</Th><Th>Valor</Th><Th>Situação</Th><Th chave="pm.eventos.custos_desvincular">Ações</Th>
                      </tr></thead>
                      <tbody>
                        {custos.map((c) => (
                          <tr key={c.vinculo_id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`evento-custo-${c.vinculo_id}`}>
                            <Td><b>{c.descricao}</b></Td>
                            <Td style={{ color: TEXTM }}>{c.fornecedor}</Td>
                            <Td>{dataBR(c.data_vencimento)}</Td>
                            <Td><b>{brl(c.valor)}</b></Td>
                            <Td><span style={{ fontSize: 10.5, fontWeight: 700, background: pgCfg(c.status).cor, padding: '2px 7px', borderRadius: 999 }}>{pgCfg(c.status).l}</span></Td>
                            <Td><button disabled={busy} onClick={() => void desvincularCusto(c)} style={btnDel} data-testid={`evento-custo-desvincular-${c.vinculo_id}`}>Desvincular</button></Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </section>

            {/* Itens e fornecedores */}
            <section style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'inline-flex', alignItems: 'center' }}>Itens e fornecedores<AjudaCampo chave="pm.eventos.item_novo" rota={ROTA} /></h3>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => setItemForm({ ...ITEM_VAZIO })} style={btnGhost} data-testid="evento-item-novo">+ Adicionar item</button></span>
              </div>
              <div style={{ fontSize: 12, color: TEXTM, margin: '4px 0 8px', display: 'inline-flex', alignItems: 'center' }}>
                Itens somam <b style={{ color: ESPRESSO, margin: '0 4px' }}>{brl(itensTotal)}</b>
                {detalhe.orcamento_previsto != null && Number(detalhe.orcamento_previsto) > 0 && <> de {brl(Number(detalhe.orcamento_previsto))} previstos</>}
                <AjudaCampo chave="pm.eventos.item_total" rota={ROTA} />
              </div>
              {carregandoDet ? <div style={{ color: TEXTM, fontSize: 13, padding: 12 }}>Carregando…</div>
                : itens.length === 0 ? <div style={{ fontSize: 13, color: TEXTM, background: OFFWHITE, border: `1px dashed ${BORDA}`, borderRadius: 10, padding: 14 }}>Nenhum item ainda. Use “+ Adicionar item” para montar o orçamento do evento.</div>
                : (
                  <div style={{ overflowX: 'auto', border: `1px solid ${BORDA}`, borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
                      <thead style={{ background: OFFWHITE }}><tr>
                        <Th chave="pm.eventos.item_descricao">Item</Th><Th chave="pm.eventos.item_fornecedor">Fornecedor</Th>
                        <Th chave="pm.eventos.item_quantidade">Qtd.</Th><Th chave="pm.eventos.item_valor_unitario">Valor unit.</Th>
                        <Th chave="pm.eventos.item_valor_total">Total</Th><Th chave="pm.eventos.item_status">Situação</Th><Th chave="pm.eventos.item_acao">Ações</Th>
                      </tr></thead>
                      <tbody>
                        {itens.map((it) => (
                          <tr key={it.id} style={{ borderTop: `1px solid ${BORDA}` }} data-testid={`evento-item-${it.id}`}>
                            <Td><b>{it.descricao}</b>{it.categoria && <span style={{ color: TEXTM }}> · {it.categoria}</span>}</Td>
                            <Td style={{ color: TEXTM }}>{it.fornecedor ?? '—'}</Td>
                            <Td>{Number(it.quantidade).toLocaleString('pt-BR')}</Td>
                            <Td>{brl(it.valor_unitario)}</Td>
                            <Td><b>{brl(it.valor_total)}</b></Td>
                            <Td><span style={{ fontSize: 10.5, fontWeight: 700, background: itCfg(it.status).cor, padding: '2px 7px', borderRadius: 999 }}>{itCfg(it.status).l}</span></Td>
                            <Td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                <button disabled={busy} onClick={() => setItemForm({ id: it.id, descricao: it.descricao, categoria: it.categoria ?? '', fornecedor: it.fornecedor ?? '', quantidade: String(it.quantidade), valor_unitario: String(it.valor_unitario), status: it.status, observacao: it.observacao ?? '' })} style={btnGhost} data-testid={`evento-item-editar-${it.id}`}>Editar</button>
                                <button disabled={busy} onClick={() => void excluirItem(it)} style={btnDel} data-testid={`evento-item-excluir-${it.id}`}>Excluir</button>
                              </div>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              {itemForm && (
                <div style={{ border: `1px solid ${BORDA}`, borderRadius: 10, padding: 12, marginTop: 10, background: OFFWHITE }} data-testid="evento-item-form">
                  <Campo label="Descrição" chave="pm.eventos.item_descricao"><input value={itemForm.descricao} onChange={(e) => setItemForm({ ...itemForm, descricao: e.target.value })} style={inp} data-testid="evento-item-f-descricao" /></Campo>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Campo label="Categoria" chave="pm.eventos.item_categoria" flex><input value={itemForm.categoria} onChange={(e) => setItemForm({ ...itemForm, categoria: e.target.value })} placeholder="locação, equipe…" style={inp} data-testid="evento-item-f-categoria" /></Campo>
                    <Campo label="Fornecedor" chave="pm.eventos.item_fornecedor" flex><input value={itemForm.fornecedor} onChange={(e) => setItemForm({ ...itemForm, fornecedor: e.target.value })} style={inp} data-testid="evento-item-f-fornecedor" /></Campo>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Campo label="Qtd." chave="pm.eventos.item_quantidade" flex><input type="number" min="0" step="0.01" value={itemForm.quantidade} onChange={(e) => setItemForm({ ...itemForm, quantidade: e.target.value })} style={inp} data-testid="evento-item-f-quantidade" /></Campo>
                    <Campo label="Valor unit. (R$)" chave="pm.eventos.item_valor_unitario" flex><input type="number" min="0" step="0.01" value={itemForm.valor_unitario} onChange={(e) => setItemForm({ ...itemForm, valor_unitario: e.target.value })} style={inp} data-testid="evento-item-f-valor" /></Campo>
                    <Campo label="Situação" chave="pm.eventos.item_status" flex>
                      <select value={itemForm.status} onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })} style={inp} data-testid="evento-item-f-status">
                        {ITEM_STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                      </select>
                    </Campo>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                    <button disabled={busy} onClick={() => setItemForm(null)} style={btnGhost}>Cancelar</button>
                    <button disabled={busy} onClick={salvarItem} style={btnPri} data-testid="evento-item-f-salvar">{itemForm.id ? 'Salvar item' : 'Adicionar'}</button>
                  </div>
                </div>
              )}
            </section>

            {/* Checklist */}
            <section style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'inline-flex', alignItems: 'center' }}>Checklist de preparação<AjudaCampo chave="pm.eventos.chk_novo" rota={ROTA} /><span style={{ fontSize: 12, color: TEXTM, marginLeft: 6 }}>({chkFeitos}/{checklist.length})</span></h3>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => setChkForm({ ...CHK_VAZIO })} style={btnGhost} data-testid="evento-chk-novo">+ Adicionar tarefa</button></span>
              </div>
              {carregandoDet ? <div style={{ color: TEXTM, fontSize: 13, padding: 12 }}>Carregando…</div>
                : checklist.length === 0 ? <div style={{ fontSize: 13, color: TEXTM, background: OFFWHITE, border: `1px dashed ${BORDA}`, borderRadius: 10, padding: 14, marginTop: 6 }}>Nenhuma tarefa no checklist. Use “+ Adicionar tarefa” para montar a preparação.</div>
                : (
                  <div style={{ border: `1px solid ${BORDA}`, borderRadius: 10, marginTop: 6, overflow: 'hidden' }}>
                    {checklist.map((c) => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: `1px solid ${BORDA}`, background: c.concluido ? '#F6FAF4' : '#fff' }} data-testid={`evento-chk-${c.id}`}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <input type="checkbox" checked={c.concluido} disabled={busy} onChange={() => void toggleChk(c)} aria-label={`Concluir ${c.descricao}`} data-testid={`evento-chk-toggle-${c.id}`} style={{ width: 18, height: 18, accentColor: GREEN, cursor: 'pointer' }} />
                          <AjudaCampo chave="pm.eventos.chk_concluido" rota={ROTA} />
                        </label>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, textDecoration: c.concluido ? 'line-through' : 'none', color: c.concluido ? TEXTM : ESPRESSO }}>{c.descricao}</div>
                          {c.prazo && <div style={{ fontSize: 11, color: TEXTM }}>Prazo: {dataBR(c.prazo)}</div>}
                        </div>
                        <button disabled={busy} onClick={() => setChkForm({ id: c.id, descricao: c.descricao, prazo: c.prazo ?? '' })} style={btnGhost} data-testid={`evento-chk-editar-${c.id}`}>Editar</button>
                        <button disabled={busy} onClick={() => void excluirChk(c)} style={btnDel} data-testid={`evento-chk-excluir-${c.id}`}>Excluir</button>
                      </div>
                    ))}
                  </div>
                )}
              {chkForm && (
                <div style={{ border: `1px solid ${BORDA}`, borderRadius: 10, padding: 12, marginTop: 10, background: OFFWHITE }} data-testid="evento-chk-form">
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Campo label="Tarefa" chave="pm.eventos.chk_tarefa" flex><input value={chkForm.descricao} onChange={(e) => setChkForm({ ...chkForm, descricao: e.target.value })} style={inp} data-testid="evento-chk-f-descricao" /></Campo>
                    <Campo label="Prazo" chave="pm.eventos.chk_prazo" flex><input type="date" value={chkForm.prazo} onChange={(e) => setChkForm({ ...chkForm, prazo: e.target.value })} style={inp} data-testid="evento-chk-f-prazo" /></Campo>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                    <button disabled={busy} onClick={() => setChkForm(null)} style={btnGhost}>Cancelar</button>
                    <button disabled={busy} onClick={salvarChk} style={btnPri} data-testid="evento-chk-f-salvar">{chkForm.id ? 'Salvar tarefa' : 'Adicionar'}</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ---- Modal: vincular custo (erp_pagar) ---- */}
      {vincularOpen && detalhe && (
        <div role="dialog" aria-modal="true" style={modalWrap} onClick={() => !busy && setVincularOpen(false)}>
          <div style={{ ...modalBox, maxWidth: 620 }} onClick={(ev) => ev.stopPropagation()} data-testid="evento-vincular">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Vincular custo ao evento</h2>
                <p style={{ fontSize: 12.5, color: TEXTM, margin: '4px 0 0' }}>Lançamentos de Contas a pagar da empresa ainda não vinculados a nenhum evento. Escolha um para somar ao realizado de “{detalhe.nome}”.</p>
              </div>
              <button onClick={() => setVincularOpen(false)} style={btnGhost} aria-label="Fechar">Fechar</button>
            </div>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>Buscar custo<AjudaCampo chave="pm.eventos.custos_busca" rota={ROTA} /></span>
              <input value={buscaCusto} onChange={(e) => void buscarDisponiveis(e.target.value)} placeholder="Buscar por descrição ou fornecedor…" style={inp} data-testid="evento-vincular-busca" />
            </label>
            <div style={{ marginTop: 10, maxHeight: '50vh', overflowY: 'auto', border: `1px solid ${BORDA}`, borderRadius: 10 }}>
              {carregandoDisp ? <div style={{ color: TEXTM, fontSize: 13, padding: 16, textAlign: 'center' }}>Carregando…</div>
                : disponiveis.length === 0 ? <div style={{ color: TEXTM, fontSize: 13, padding: 16, textAlign: 'center' }} data-testid="evento-vincular-vazio">Nenhum custo disponível. Lance a despesa em Contas a pagar da empresa (financeiro da GE) e volte para vinculá-la aqui.</div>
                : disponiveis.map((d) => (
                  <div key={d.lancamento_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: `1px solid ${BORDA}` }} data-testid={`evento-disp-${d.lancamento_id}`}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{d.descricao}</div>
                      <div style={{ fontSize: 11.5, color: TEXTM }}>{d.fornecedor} · vence {dataBR(d.data_vencimento)} · <span style={{ fontWeight: 700 }}>{pgCfg(d.status).l}</span></div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{brl(d.valor)}</div>
                    <button disabled={busy} onClick={() => void vincularCusto(d.lancamento_id)} style={btnPri} data-testid={`evento-disp-vincular-${d.lancamento_id}`}>Vincular</button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function MiniKpi({ l, v, cor, testid }: { l: string; v: string; cor?: string; testid?: string }) {
  return <div style={{ background: OFFWHITE, border: `1px solid ${BORDA}`, borderRadius: 10, padding: '8px 10px' }} data-testid={testid}>
    <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, color: TEXTM, fontWeight: 700 }}>{l}</div>
    <div style={{ fontSize: 16, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 1 }}>{v}</div>
  </div>
}

function Campo({ label, chave, children, flex }: { label: string; chave: string; children: React.ReactNode; flex?: boolean }) {
  return <label style={{ display: 'block', marginBottom: 10, flex: flex ? '1 1 150px' : undefined }}>
    <span style={{ fontSize: 12, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>{label}<AjudaCampo chave={chave} rota={ROTA} /></span>
    {children}
  </label>
}
function Filtro({ label, chave, children }: { label: string; chave: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', flex: '1 1 140px' }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }}>{label}<AjudaCampo chave={chave} rota={ROTA} /></span>
    {children}
  </label>
}
function Kpi({ l, v, cor, chave }: { l: string; v: string; cor?: string; chave?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
function Th({ children, chave }: { children?: React.ReactNode; chave?: string }) { return <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: TEXTM }}>{children}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</th> }
function Td({ children, style }: { children?: React.ReactNode; style?: CSSProperties }) { return <td style={{ padding: '8px 12px', color: ESPRESSO, ...style }}>{children}</td> }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const btnDel: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const inp: CSSProperties = { width: '100%', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '9px 10px', fontSize: 14, marginTop: 4, boxSizing: 'border-box', minHeight: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
const modalWrap: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 70 }
const modalBox: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
