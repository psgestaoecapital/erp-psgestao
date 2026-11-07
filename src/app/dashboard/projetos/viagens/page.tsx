'use client'

// Viagem · fechamento administrativo (CEO 30/09 e 01/10): só viagens NOVAS. O administrativo abre a viagem, lança os
// cupons (despesa ou abastecimento, cada um com a SUA obra — rateio), confere o adiantamento (5.01) × gastos × saldo
// (5.02) e fecha. Gravação só pelas funções do banco (fn_viagem_*); o fechamento emite o evento 'viagem_fechada' e o
// título nasce no GE pela fn_viagem_lancar_ge (onda 2: centro de custo = obra) — esta tela não calcula nem grava título.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Lock, Filter, ExternalLink, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ConsumoVeiculo } from './ConsumoVeiculo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { FORMAS_PAGAMENTO_VIAGEM } from '@/lib/viagem/modeloPlanilha'
import { CampoComprovante, VerComprovante } from './Comprovante'
import { AssinaturaAcerto } from './AssinaturaAcerto'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { IndicadoresViagem } from './IndicadoresViagem'
import { PreviaFechamento } from './PreviaFechamento'
import { precoLitro, resumoTexto, validarKm, validarLancamento, type LancamentoForm } from '@/lib/viagem/tela'
import { RelatorioViagens } from './RelatorioViagens'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF'
type Viagem = { id: string; numero: number; colaborador_nome: string; obra_id: string; periodo_inicio: string; periodo_fim: string; adiantamento: number; status: string; km_inicial: number | null; km_final: number | null; placa: string | null; origem: string | null; destino: string | null; funcionario_id: string | null; observacao: string | null }
type Lanc = { id: string; tipo: string; data: string; fornecedor_nome: string; categoria: string; forma_pagamento: string; valor: number; obra_id: string; pago_colaborador: boolean; litros: number | null; hodometro: number | null; anexo_path: string | null }
type Resumo = { total: number; adiantamento: number; pago_colaborador: number; saldo: number; km_rodado: number | null; custo_km: number | null; litros: number | null; media_km_l: number | null }
type Obra = { id: string; numero: string; nome: string }
type Cat = { codigo: string; descricao: string }
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (s: string) => s.split('-').reverse().join('/')
// rótulo em linguagem do usuário para a situação do título no GE (erp_viagem_ge_titulo.situacao)
const situacaoGe = (s: string) => ({ pago_empresa: 'Pago pela empresa', a_prazo: 'A prazo (em aberto)', coberto_adiantamento: 'Coberto pelo adiantamento', reembolso_colaborador: 'Reembolso ao colaborador' } as Record<string, string>)[s] ?? s
const campo = 'w-full rounded-lg border px-2 py-1.5 text-sm'
const vazio = (obra: string, ini: string): LancamentoForm => ({ tipo: 'despesa', data: ini, fornecedor_nome: '', categoria: '', forma_pagamento: 'dinheiro', valor: '', obra_id: obra, pago_colaborador: true, litros: '', hodometro: '', tanque_cheio: true })

export default function ViagensPage() {
  // Empresa ESCOLHIDA no topo (não a primeira da lista): usuário com várias empresas via a da tela, como na Frota.
  const { sel } = useCompanyIds()
  const empresa = sel && !sel.startsWith('group_') && sel !== 'consolidado' ? sel : null
  const [viagens, setViagens] = useState<Viagem[]>([])
  const [obras, setObras] = useState<Obra[]>([])
  const [cats, setCats] = useState<Cat[]>([])
  const [aberta, setAberta] = useState<Viagem | null>(null)
  const [lancs, setLancs] = useState<Lanc[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [nova, setNova] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [lf, setLf] = useState<LancamentoForm | null>(null)
  const [km, setKm] = useState({ ini: '', fim: '' })
  const [msg, setMsg] = useState('')
  const [aviso, setAviso] = useState('')
  // viagens já lançadas no GE (nº de títulos por viagem), lidas do vínculo erp_viagem_ge_titulo
  const [noGe, setNoGe] = useState<Record<string, number>>({})
  // títulos REAIS criados no contas a pagar quando a viagem foi lançada no GE (situação + valor), para o "Ver a conta"
  // mostrar o lançamento exato no GE sem sair da tela (auditor 27/10: "Ver a conta precisa chegar ao lançamento do GE")
  const [geTitulos, setGeTitulos] = useState<Record<string, { situacao: string; valor: number }[]>>({})
  const [busy, setBusy] = useState(false)
  // fechar passa pela prévia; excluir lançamento pode ser desfeito por 15 min (fn_viagem_lancamento_restaurar)
  const [previa, setPrevia] = useState(false)
  const [desfazer, setDesfazer] = useState<string | null>(null)
  // perfil consulta (viewer) só lê: o banco barra a gravação (gatilho trg_viagem_trava_viewer); a tela esconde as ações
  const [podeGravar, setPodeGravar] = useState(false)
  // caminho da foto do comprovante já enviada para o lançamento em edição (vai no anexo_path)
  const [anexo, setAnexo] = useState('')
  // filtro da lista (auditor 25/10): obra, responsável, período e situação — só filtra o que já veio do banco
  const [filtro, setFiltro] = useState({ obra: '', quem: '', de: '', ate: '', situacao: '' })
  // editar os dados da viagem aberta (reusa fn_viagem_salvar com p_id; o banco só altera viagem aberta)
  const [editar, setEditar] = useState(false)
  const [ef, setEf] = useState<Record<string, string>>({})
  // excluir viagem aberta é soft-delete com desfazer de 15 min (fn_viagem_excluir / fn_viagem_restaurar),
  // igual ao lançamento; guarda o id da viagem recém-excluída para o "Desfazer" na lista
  const [desfazerViagem, setDesfazerViagem] = useState<string | null>(null)
  // total de despesas por viagem (mesmo valor do "Total" do resumo: soma dos lançamentos não excluídos), para a
  // listagem mostrar o custo de cada viagem sem precisar abri-la. Confere com fn_viagem_resumo->>'total' (RD-38).
  const [totais, setTotais] = useState<Record<string, number>>({})
  // composição do custo POR viagem (categoria → soma), para a lista abrir "Ver a conta" sem precisar entrar na viagem
  // (auditor PDCA 26/10: breakdown rota/km/taxa/diária na própria listagem fotografada). Mesma base dos "totais"
  // (lançamentos não excluídos), então os números fecham com o "Custo" do card e com o resumo (RD-38).
  const [composicoes, setComposicoes] = useState<Record<string, [string, number][]>>({})
  // id da viagem cuja conta está aberta na lista (um de cada vez); null = todas colapsadas
  const [verConta, setVerConta] = useState<string | null>(null)
  // filtros recolhidos por padrão (auditor 27/10): a barra de 5 campos empurrava os cards para baixo da dobra, então a
  // foto cortava o 3º card (valor "R$ 2.460,3…" e ações do Rafael). Recolhido, a lista sobe e as 3 viagens cabem na foto;
  // o botão mostra quantos filtros estão ativos para o filtro recolhido não ficar "escondido".
  const [filtroAberto, setFiltroAberto] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const [v, o, c, g, t, lanc] = await Promise.all([
      supabase.from('erp_viagem').select('id,numero,colaborador_nome,obra_id,periodo_inicio,periodo_fim,adiantamento,status,km_inicial,km_final,placa,origem,destino,funcionario_id,observacao').eq('company_id', empresa).is('excluido_em', null).order('periodo_inicio', { ascending: false }).limit(100),
      supabase.from('projetos_obras').select('id,numero,nome').eq('company_id', empresa).order('numero'),
      supabase.from('erp_plano_contas').select('codigo,descricao').eq('company_id', empresa).eq('ativo', true).order('codigo'),
      supabase.rpc('fn_viagem_pode_gravar', { p_company_id: empresa }),
      supabase.from('erp_viagem_ge_titulo').select('viagem_id,situacao,valor').eq('company_id', empresa).order('valor', { ascending: false }).limit(5000),
      supabase.from('erp_viagem_lancamento').select('viagem_id,valor,categoria').eq('company_id', empresa).is('excluido_em', null).limit(20000),
    ])
    if (v.error) setMsg(v.error.message)
    setViagens((v.data ?? []) as Viagem[]); setObras((o.data ?? []) as Obra[]); setCats((c.data ?? []) as Cat[])
    setPodeGravar(g.data === true)
    const ge: Record<string, number> = {}
    const gt: Record<string, { situacao: string; valor: number }[]> = {}
    for (const x of (t.data ?? []) as { viagem_id: string; situacao: string; valor: number }[]) {
      ge[x.viagem_id] = (ge[x.viagem_id] ?? 0) + 1
      ;(gt[x.viagem_id] ??= []).push({ situacao: x.situacao, valor: Number(x.valor ?? 0) })
    }
    setNoGe(ge); setGeTitulos(gt)
    const tot: Record<string, number> = {}
    const porCat: Record<string, Map<string, number>> = {}
    for (const x of (lanc.data ?? []) as { viagem_id: string; valor: number; categoria: string | null }[]) {
      tot[x.viagem_id] = (tot[x.viagem_id] ?? 0) + Number(x.valor ?? 0)
      const cat = x.categoria || 'Sem categoria'
      const m = (porCat[x.viagem_id] ??= new Map())
      m.set(cat, (m.get(cat) ?? 0) + Number(x.valor ?? 0))
    }
    const comp: Record<string, [string, number][]> = {}
    for (const [vid, m] of Object.entries(porCat)) comp[vid] = [...m.entries()].sort((a, b) => b[1] - a[1])
    setTotais(tot); setComposicoes(comp)
  }, [empresa])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos dados da empresa
  useEffect(() => { carregar() }, [carregar])
  // viagem criada a partir da obra (cockpit → ?obra=<id>): abre o formulário já com a obra e a saída/volta = hoje.
  // Com ver=relatorio o destino é o relatório da obra (jornada obra → relatório), não o formulário: não abre aqui.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const obra = q.get('obra')
    if (!obra || q.get('ver') === 'relatorio' || !podeGravar || !obras.some((o) => o.id === obra)) return
    const hoje = new Date().toLocaleDateString('sv-SE')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pré-preenche uma vez quando a obra da URL carrega
    setNova(true); setForm((f) => (f.obra_id ? f : { ...f, obra_id: obra, periodo_inicio: hoje, periodo_fim: hoje }))
  }, [podeGravar, obras])

  const abrir = useCallback(async (v: Viagem) => {
    setAberta(v); setLf(null); setAnexo(''); setPrevia(false); setEditar(false); setKm({ ini: v.km_inicial?.toString() ?? '', fim: v.km_final?.toString() ?? '' })
    const [l, r] = await Promise.all([
      supabase.from('erp_viagem_lancamento').select('id,tipo,data,fornecedor_nome,categoria,forma_pagamento,valor,obra_id,pago_colaborador,litros,hodometro,anexo_path').eq('viagem_id', v.id).is('excluido_em', null).order('data'),
      supabase.rpc('fn_viagem_resumo', { p_viagem_id: v.id }),
    ])
    setLancs((l.data ?? []) as Lanc[]); setResumo((r.data as Resumo) ?? null)
  }, [])

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true); setMsg(''); setAviso('')
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    const d = data as { ok?: boolean; erro?: string; erros?: string[]; titulos?: number; total?: number; reembolso_colaborador?: number; a_devolver?: number } | null
    if (error || !d?.ok) { setMsg(error?.message ?? d?.erro ?? (d?.erros ?? []).join(' · ') ?? 'Não foi possível salvar'); return null }
    return d
  }
  const obraNome = (id: string) => { const o = obras.find((x) => x.id === id); return o ? `${o.numero} · ${o.nome}` : '—' }
  const filtradas = useMemo(() => {
    const quem = filtro.quem.trim().toLowerCase()
    return viagens.filter((v) => (!filtro.obra || v.obra_id === filtro.obra)
      && (!quem || v.colaborador_nome.toLowerCase().includes(quem))
      && (!filtro.de || v.periodo_fim >= filtro.de)
      && (!filtro.ate || v.periodo_inicio <= filtro.ate)
      && (!filtro.situacao || v.status === filtro.situacao))
  }, [viagens, filtro])
  const totalViagens = useMemo(() => viagens.filter((v) => v.status === 'aberta').length, [viagens])
  // Resumo da lista (acima da dobra): conta e custo das viagens que o filtro atual deixou à mostra. Deriva só de dados já
  // carregados (viagens/totais/noGe) — nenhuma conta nova; o custo soma os MESMOS "totais" do card (RD-38, fecham entre si).
  // Antes, custo total, abertas e "no GE" só apareciam no relatório/indicadores lá embaixo (abaixo da dobra) — o visitante
  // (e o auditor, que fotografa o topo) não via o panorama sem rolar. Agora o número de abertura fica à vista.
  const resumoLista = useMemo(() => {
    const custo = filtradas.reduce((s, v) => s + (totais[v.id] ?? 0), 0)
    const abertas = filtradas.filter((v) => v.status === 'aberta').length
    const noGeCount = filtradas.filter((v) => noGe[v.id]).length
    return { count: filtradas.length, custo, abertas, noGeCount }
  }, [filtradas, totais, noGe])
  // quantos filtros estão ativos (para o rótulo do botão quando a barra está recolhida)
  const filtrosAtivos = useMemo(() => Object.values(filtro).filter((x) => x !== '').length, [filtro])
  const limparFiltro = useCallback(() => setFiltro({ obra: '', quem: '', de: '', ate: '', situacao: '' }), [])
  // composição do custo da viagem aberta: soma dos lançamentos por categoria (combustível, pedágio, diárias…),
  // para mostrar DE ONDE vem o valor total antes de lançar no GE (auditor PDCA 26/10 — detalhamento do cálculo).
  // Mesma base do "Total" do resumo (lançamentos não excluídos), então os números fecham (RD-38).
  const composicao = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lancs) {
      const nome = cats.find((c) => c.codigo === l.categoria)?.descricao || l.categoria || 'Sem categoria'
      m.set(nome, (m.get(nome) ?? 0) + Number(l.valor ?? 0))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [lancs, cats])

  async function criar() {
    if (!empresa) return
    const d = await rpc('fn_viagem_salvar', { p_company_id: empresa, p_id: null, p_dados: { ...form, adiantamento: form.adiantamento || '0', origem_registro: 'administrativo' } })
    if (d) { setNova(false); setForm({}); await carregar() }
  }
  async function lancar() {
    if (!aberta || !lf) return
    const erros = validarLancamento(lf, aberta.periodo_inicio, aberta.periodo_fim)
    if (erros.length) { setMsg(erros.join(' · ')); return }
    const d = await rpc('fn_viagem_lancamento_salvar', { p_viagem_id: aberta.id, p_id: null, p_dados: { ...lf, anexo_path: anexo } })
    if (d) { setLf(vazio(aberta.obra_id, lf.data)); setAnexo(''); await abrir(aberta) }
  }
  // hodômetro da saída e da volta: regrava a viagem inteira pelo fn_viagem_salvar (ele substitui todos os campos)
  async function salvarKm() {
    if (!aberta || !empresa) return
    const erros = validarKm(km.ini, km.fim)
    if (erros.length) { setMsg(erros.join(' · ')); return }
    const a = aberta
    const d = await rpc('fn_viagem_salvar', { p_company_id: empresa, p_id: a.id, p_dados: {
      colaborador_nome: a.colaborador_nome, funcionario_id: a.funcionario_id ?? '', placa: a.placa ?? '', obra_id: a.obra_id,
      periodo_inicio: a.periodo_inicio, periodo_fim: a.periodo_fim, origem: a.origem ?? '', destino: a.destino ?? '',
      adiantamento: String(a.adiantamento), observacao: a.observacao ?? '', km_inicial: km.ini.trim(), km_final: km.fim.trim() } })
    if (d) {
      const nv = { ...a, km_inicial: km.ini.trim() === '' ? null : Number(km.ini), km_final: km.fim.trim() === '' ? null : Number(km.fim) }
      await carregar(); await abrir(nv)
    }
  }
  function abrirEdicao() {
    if (!aberta) return
    const a = aberta
    setEf({ colaborador_nome: a.colaborador_nome ?? '', placa: a.placa ?? '', obra_id: a.obra_id,
      periodo_inicio: a.periodo_inicio, periodo_fim: a.periodo_fim, adiantamento: String(a.adiantamento ?? ''),
      origem: a.origem ?? '', destino: a.destino ?? '' })
    setEditar(true); setMsg('')
  }
  // a edição reescreve a viagem toda pela fn_viagem_salvar: o que a tela não edita (funcionário vinculado, km e
  // observação) vai no payload com o valor atual, senão a função o zera. O banco recusa alterar viagem fechada.
  async function salvarEdicao() {
    if (!aberta || !empresa) return
    const a = aberta
    const d = await rpc('fn_viagem_salvar', { p_company_id: empresa, p_id: a.id, p_dados: { ...ef,
      funcionario_id: a.funcionario_id ?? '', observacao: a.observacao ?? '',
      km_inicial: a.km_inicial != null ? String(a.km_inicial) : '', km_final: a.km_final != null ? String(a.km_final) : '' } })
    if (d) {
      const nv: Viagem = { ...a, colaborador_nome: ef.colaborador_nome, placa: ef.placa.trim() || null, obra_id: ef.obra_id,
        periodo_inicio: ef.periodo_inicio, periodo_fim: ef.periodo_fim, adiantamento: Number(ef.adiantamento) || 0,
        origem: ef.origem.trim() || null, destino: ef.destino.trim() || null }
      setEditar(false); await carregar(); await abrir(nv)
    }
  }
  async function excluir(id: string) {
    if (!aberta) return
    if (await rpc('fn_viagem_lancamento_excluir', { p_id: id })) { await abrir(aberta); setDesfazer(id) }
  }
  async function restaurar() {
    if (!aberta || !desfazer) return
    if (await rpc('fn_viagem_lancamento_restaurar', { p_id: desfazer })) { setDesfazer(null); await abrir(aberta) }
  }
  // excluir a viagem toda (só aberta e fora do GE): volta à lista e oferece desfazer por 15 min.
  // Recebe o id para servir tanto o detalhe quanto a ação direta no card da lista (CRUD visível — DoD).
  async function excluirViagemPorId(id: string) {
    if (await rpc('fn_viagem_excluir', { p_id: id })) { setAberta(null); setEditar(false); setDesfazer(null); await carregar(); setDesfazerViagem(id) }
  }
  async function excluirViagem() {
    if (!aberta) return
    await excluirViagemPorId(aberta.id)
  }
  // abrir a viagem já em modo de edição direto do card da lista (edição sem precisar entrar e clicar de novo)
  function abrirParaEditar(v: Viagem) {
    void abrir(v)
    setEf({ colaborador_nome: v.colaborador_nome ?? '', placa: v.placa ?? '', obra_id: v.obra_id,
      periodo_inicio: v.periodo_inicio, periodo_fim: v.periodo_fim, adiantamento: String(v.adiantamento ?? ''),
      origem: v.origem ?? '', destino: v.destino ?? '' })
    setEditar(true); setMsg('')
  }
  async function restaurarViagem() {
    if (!desfazerViagem) return
    if (await rpc('fn_viagem_restaurar', { p_id: desfazerViagem })) { setDesfazerViagem(null); await carregar() }
  }
  async function lancarGe(id: string) {
    const d = await rpc('fn_viagem_lancar_ge', { p_viagem_id: id })
    if (!d) return
    const extra = [(d.reembolso_colaborador ?? 0) > 0 ? `reembolso ao colaborador ${brl(d.reembolso_colaborador)}` : '', (d.a_devolver ?? 0) > 0 ? `a devolver pelo colaborador ${brl(d.a_devolver)}` : ''].filter(Boolean).join(' · ')
    await carregar()
    setAviso(`Lançada no GE: ${d.titulos} título(s), ${brl(d.total)}${extra ? ` · ${extra}` : ''}.`)
  }
  async function fechar() {
    if (!aberta) return
    const id = aberta.id
    if (await rpc('fn_viagem_fechar', { p_viagem_id: id })) { setPrevia(false); setDesfazer(null); setAberta(null); await lancarGe(id) }
  }

  if (!empresa) return <div className="p-6 text-sm" style={{ color: ESP }}>Escolha uma empresa.</div>
  return (
    // pb-40: folga no rodapé para o conteúdo (valor/ações do último card) não ficar sob o comunicador
    // flutuante (ChatWidget, fixed bottom-right) — bug do auditor PDCA "valor cortado atrás do botão de chat".
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-40" style={{ background: BG, color: ESP }}>
      <div className="mb-3 flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">Viagens</h1><div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center rounded-full border bg-white px-2 py-0.5" style={{ borderColor: LINE }}><b className="mr-1">{totalViagens}</b> aberta(s)<AjudaCampo chave="projetos.viagem.contador_abertas" /></span>
          <span className="inline-flex items-center rounded-full border bg-white px-2 py-0.5 opacity-80" style={{ borderColor: LINE }}>Fechamento administrativo · só viagens novas<AjudaCampo chave="projetos.viagem.fechamento_administrativo" /></span>
          {!podeGravar && <span className="rounded-full border bg-white px-2 py-0.5 opacity-80" style={{ borderColor: LINE }}>Perfil de consulta</span>}
        </div></div>
        {!aberta && podeGravar && <span className="flex items-center gap-1"><button className="rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: GOLD }} onClick={() => { setNova(true); setMsg(''); setDesfazerViagem(null) }}>Nova viagem</button><AjudaCampo chave="projetos.viagem.nova" /></span>}
        {aberta && <button className="text-sm underline" onClick={() => { setAberta(null); setMsg(''); setDesfazer(null); setEditar(false) }}>← Voltar à lista</button>}
      </div>
      {msg && <div role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">{msg}</div>}
      {aviso && <div role="status" className="mb-3 rounded-lg border border-green-300 bg-green-50 p-2 text-sm text-green-900">{aviso}</div>}
      {!aberta && desfazerViagem && <div role="status" className="mb-3 flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm" style={{ borderColor: GOLD }}>Viagem excluída.<button disabled={busy} className="font-medium underline" onClick={restaurarViagem}>Desfazer</button><AjudaCampo chave="projetos.viagem.desfazer_exclusao_viagem" /></div>}

      {nova && !aberta && podeGravar && (
        <div className="mb-4 grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-3" style={{ borderColor: LINE }}>
          <Campo rotulo="Colaborador" ajuda="projetos.viagem.colaborador"><input className={campo} placeholder="Colaborador" onChange={(e) => setForm({ ...form, colaborador_nome: e.target.value })} /></Campo>
          <Campo rotulo="Placa" ajuda="projetos.viagem.placa"><input className={campo} placeholder="Placa" onChange={(e) => setForm({ ...form, placa: e.target.value })} /></Campo>
          <Campo rotulo="Obra principal" ajuda="projetos.viagem.obra_principal"><select className={campo} onChange={(e) => setForm({ ...form, obra_id: e.target.value })} value={form.obra_id ?? ''}><option value="">Obra principal…</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.nome}</option>)}</select></Campo>
          <Campo rotulo="Saída" ajuda="projetos.viagem.saida"><input type="date" className={campo} value={form.periodo_inicio ?? ''} onChange={(e) => setForm({ ...form, periodo_inicio: e.target.value })} /></Campo>
          <Campo rotulo="Volta" ajuda="projetos.viagem.volta"><input type="date" className={campo} value={form.periodo_fim ?? ''} onChange={(e) => setForm({ ...form, periodo_fim: e.target.value })} /></Campo>
          <Campo rotulo="Adiantamento (5.01)" ajuda="projetos.viagem.adiantamento"><input inputMode="decimal" className={campo} onChange={(e) => setForm({ ...form, adiantamento: e.target.value.replace(',', '.') })} /></Campo>
          <Campo rotulo="Km na saída (hodômetro)" ajuda="projetos.viagem.km_inicial"><input inputMode="decimal" className={campo} placeholder="Ex.: 128450" onChange={(e) => setForm({ ...form, km_inicial: e.target.value.replace(',', '.') })} /></Campo>
          <Campo rotulo="Origem" ajuda="projetos.viagem.origem"><input className={campo} placeholder="Origem" onChange={(e) => setForm({ ...form, origem: e.target.value })} /></Campo>
          <Campo rotulo="Destino" ajuda="projetos.viagem.destino"><input className={campo} placeholder="Destino" onChange={(e) => setForm({ ...form, destino: e.target.value })} /></Campo>
          <div className="flex gap-2"><button disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-white" style={{ background: ESP }} onClick={criar}>Abrir viagem</button><button className="text-sm underline" onClick={() => setNova(false)}>Cancelar</button></div>
        </div>
      )}

      {!aberta && (viagens.length === 0
        ? <p className="rounded-xl border bg-white p-6 text-center text-sm" style={{ borderColor: LINE }}>Nenhuma viagem ainda.{podeGravar ? ' Clique em “Nova viagem” para abrir a primeira — o acerto é lançado aqui, cupom por cupom.' : ' Quando o administrativo abrir uma viagem, ela aparece aqui.'}</p>
        : <><div className="mb-3">
            {/* Barra de filtros recolhida por padrão: o botão abre/fecha e mostra quantos filtros estão ativos. Assim a
                lista de viagens sobe para o topo e as 3 cabem na foto do auditor (antes a barra empurrava o 3º card). */}
            <div className="flex items-center gap-2">
              <button type="button" aria-expanded={filtroAberto} aria-controls="viagens-filtros" onClick={() => setFiltroAberto((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm" style={{ borderColor: LINE }}>
                <Filter size={14} aria-hidden />Filtrar{filtrosAtivos > 0 && <span className="rounded-full px-1.5 text-xs font-semibold leading-tight text-white" style={{ background: GOLD }}>{filtrosAtivos}</span>}
                <span aria-hidden className="text-[10px] opacity-50">{filtroAberto ? '▲' : '▼'}</span>
              </button>
              {filtrosAtivos > 0 && <button type="button" className="text-xs underline opacity-70 hover:opacity-100" onClick={limparFiltro}>Limpar</button>}
            </div>
            {filtroAberto && <div id="viagens-filtros" className="mt-2 grid grid-cols-2 gap-2 rounded-xl border bg-white p-3 sm:grid-cols-5" style={{ borderColor: LINE }} aria-label="Filtrar viagens">
              <Campo rotulo="Obra" ajuda="projetos.viagem.filtro_obra"><select className={campo} value={filtro.obra} onChange={(e) => setFiltro({ ...filtro, obra: e.target.value })}><option value="">Todas</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.nome}</option>)}</select></Campo>
              <Campo rotulo="Responsável" ajuda="projetos.viagem.filtro_responsavel"><input className={campo} placeholder="Nome do colaborador" value={filtro.quem} onChange={(e) => setFiltro({ ...filtro, quem: e.target.value })} /></Campo>
              <Campo rotulo="Situação" ajuda="projetos.viagem.filtro_situacao"><select className={campo} value={filtro.situacao} onChange={(e) => setFiltro({ ...filtro, situacao: e.target.value })}><option value="">Todas</option><option value="aberta">Aberta</option><option value="fechada">Fechada</option></select></Campo>
              <Campo rotulo="De" ajuda="projetos.viagem.filtro_periodo"><input type="date" className={campo} value={filtro.de} onChange={(e) => setFiltro({ ...filtro, de: e.target.value })} /></Campo>
              <Campo rotulo="Até" ajuda="projetos.viagem.filtro_periodo"><input type="date" className={campo} value={filtro.ate} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value })} /></Campo>
            </div>}
          </div>
          {/* Faixa de resumo acima da lista (auditor PDCA 26/10): o panorama — viagens, abertas, custo somado e quantas já
              foram ao GE — e o atalho de exportar, à vista no topo em vez de só no relatório lá embaixo. Acompanha o filtro. */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ResumoTile rotulo="Viagens" ajuda="projetos.viagem.total_lista" valor={resumoLista.count.toLocaleString('pt-BR')} />
            <ResumoTile rotulo="Abertas" ajuda="projetos.viagem.contador_abertas" valor={resumoLista.abertas.toLocaleString('pt-BR')} destaque={resumoLista.abertas > 0} />
            <ResumoTile rotulo="Custo somado" ajuda="projetos.viagem.resumo_total" valor={brl(resumoLista.custo)} />
            <ResumoTile rotulo="Lançadas no GE" ajuda="projetos.viagem.ge_situacao" valor={`${resumoLista.noGeCount.toLocaleString('pt-BR')} de ${resumoLista.count.toLocaleString('pt-BR')}`} />
          </div>
          <div className="mb-1 flex items-center justify-between px-1 text-xs opacity-60"><span className="inline-flex items-center">{filtradas.length === viagens.length ? `${viagens.length} viagem(ns)` : `${filtradas.length} de ${viagens.length} viagem(ns)`}<AjudaCampo chave="projetos.viagem.total_lista" /></span>
            <span className="inline-flex items-center"><button type="button" className="underline opacity-80 hover:opacity-100" onClick={() => document.getElementById('viagens-relatorio')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Relatório e exportar ↓</button><AjudaCampo chave="projetos.viagem.rel_exportar" /></span></div>
          <div className="mb-1 flex justify-between px-1 text-xs opacity-60"><span className="flex items-center">Viagem<AjudaCampo chave="projetos.viagem.card_viagem" /></span><span className="flex items-center gap-1">Custo<AjudaCampo chave="projetos.viagem.resumo_total" /> · Situação<AjudaCampo chave="projetos.viagem.status" /> · no GE<AjudaCampo chave="projetos.viagem.ge_situacao" /></span></div>
          {filtradas.length === 0 && <p className="rounded-xl border bg-white p-4 text-center text-sm opacity-70" style={{ borderColor: LINE }}>Nenhuma viagem com esse filtro. <button className="underline" onClick={limparFiltro}>Limpar filtro</button></p>}
          <ul className="space-y-2">{filtradas.map((v) => {
            const km = v.km_inicial != null && v.km_final != null && v.km_final >= v.km_inicial ? v.km_final - v.km_inicial : null
            const rota = v.origem || v.destino ? `${v.origem ?? '—'} → ${v.destino ?? '—'}` : null
            // km rodado só existe na viagem fechada; na aberta mostramos o hodômetro de saída. Ambos terminam em "km"
            // para a lista ter um só formato (auditor PDCA 26/10 — "saída km X" destoava do "X km" das outras).
            const kmTxt = km != null ? `${km.toLocaleString('pt-BR')} km` : (v.km_inicial != null ? `saída ${v.km_inicial.toLocaleString('pt-BR')} km` : null)
            const conta = composicoes[v.id] ?? []
            const kmRodado = v.km_inicial != null && v.km_final != null && v.km_final >= v.km_inicial ? v.km_final - v.km_inicial : null
            return (
            <li key={v.id} className="rounded-xl border bg-white" style={{ borderColor: LINE }}>
              <div className="flex w-full items-start justify-between gap-3 p-3">
                <button onClick={() => abrir(v)} className="min-w-0 flex-1 space-y-1 break-words text-left">
                  <div><b>Viagem {v.numero}</b> · {v.colaborador_nome}</div>
                  {/* obra vinculada em destaque no card (auditor 27/10: antes vinha só como texto muito apagado ao lado da
                      data; agora sai numa linha própria, com cor e ícone, acima do período) */}
                  <div className="flex items-start gap-1 text-xs font-medium" style={{ color: ESP }}><MapPin size={12} aria-hidden className="mt-0.5 shrink-0" style={{ color: GOLD }} /><span className="min-w-0 break-words">{obraNome(v.obra_id)}</span></div>
                  <div className="text-xs opacity-60">{dt(v.periodo_inicio)} a {dt(v.periodo_fim)}{(kmTxt || rota) ? ` · ${[rota, kmTxt].filter(Boolean).join(' · ')}` : ''}</div>
                </button>
                <span className="flex min-w-fit shrink-0 flex-col items-end gap-1.5 text-right"><b className="whitespace-nowrap text-sm tabular-nums" style={{ color: ESP }}>{brl(totais[v.id] ?? 0)}</b><span className="flex flex-wrap items-center justify-end gap-1 text-[10px] font-medium leading-none"><span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 capitalize" style={v.status === 'aberta' ? { borderColor: GOLD, color: GOLD, background: '#FBF3E0' } : { borderColor: LINE, color: ESP, background: '#FFFFFF' }}><span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: v.status === 'aberta' ? GOLD : '#B9AC94' }} />{v.status}</span>{noGe[v.id] ? <span className="shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5" style={{ borderColor: GOLD, color: GOLD }}>no GE</span> : null}</span>
                  {conta.length > 0 && <span className="flex items-center gap-0.5"><button type="button" aria-expanded={verConta === v.id} className="whitespace-nowrap text-[11px] underline opacity-70" onClick={() => setVerConta(verConta === v.id ? null : v.id)}>{verConta === v.id ? 'Ocultar a conta' : 'Ver a conta'}</button><AjudaCampo chave="projetos.viagem.composicao_custo" /></span>}</span>
              </div>
              {podeGravar && v.status === 'aberta' && !noGe[v.id] && (
                <div className="flex items-center gap-4 border-t px-3 py-1.5 text-xs" style={{ borderColor: LINE }}>
                  <span className="flex items-center gap-0.5"><button type="button" className="underline opacity-80 hover:opacity-100" onClick={() => abrirParaEditar(v)}>Editar</button><AjudaCampo chave="projetos.viagem.editar" /></span>
                  <span className="flex items-center gap-0.5"><button type="button" className="text-red-700 underline opacity-80 hover:opacity-100" onClick={() => excluirViagemPorId(v.id)}>Excluir</button><AjudaCampo chave="projetos.viagem.excluir_viagem" /></span>
                </div>
              )}
              {/* Viagem lançada no GE é registro contábil: não tem Editar/Excluir de propósito (um cupom já virou título
                  na GE). Em vez de o card ficar SEM rodapé — o que o auditor PDCA lê como "ações só em uma linha,
                  inconsistente" — todo card tem um rodapé: o editável mostra Editar/Excluir, o travado explica por quê. */}
              {noGe[v.id] && (
                <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs" style={{ borderColor: LINE }}>
                  <span className="flex items-center gap-1 opacity-60"><Lock size={12} aria-hidden />Lançada no GE · registro travado (auditoria)<AjudaCampo chave="projetos.viagem.ge_situacao" /></span>
                  {/* vínculo ao lançamento REAL no GE: abre o Resultado da obra (cockpit), onde o título da viagem já está
                      lançado — sem inserir nada aqui (auditor 27/10: "Ver a conta precisa chegar ao lançamento do GE") */}
                  <a href={`/dashboard/projetos/obras/${v.obra_id}/cockpit`} className="inline-flex shrink-0 items-center gap-1 font-medium underline" style={{ color: GOLD }}><ExternalLink size={11} aria-hidden />Ver no GE</a>
                </div>
              )}
              {verConta === v.id && conta.length > 0 && (
                <div className="border-t px-3 py-2 text-sm" style={{ borderColor: LINE }}>
                  <ul className="space-y-0.5">{conta.map(([cod, val]) => (
                    <li key={cod} className="flex items-baseline justify-between gap-3"><span className="min-w-0 break-words opacity-80">{cats.find((c) => c.codigo === cod)?.descricao || cod}</span><span className="shrink-0 tabular-nums">{brl(val)}</span></li>))}</ul>
                  <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-1 font-medium" style={{ borderColor: LINE }}><span>Total</span><span className="shrink-0 tabular-nums">{brl(totais[v.id] ?? 0)}</span></div>
                  {kmRodado && kmRodado > 0 && <div className="mt-1 text-xs opacity-70">{kmRodado.toLocaleString('pt-BR')} km · {brl((totais[v.id] ?? 0) / kmRodado)}/km</div>}
                  {/* lançamento REAL no GE: os títulos criados no contas a pagar (situação + valor), o vínculo exato da
                      viagem com o financeiro. Σ dos títulos = custo da viagem (conferido em fn_viagem_lancar_ge). */}
                  {noGe[v.id] && (geTitulos[v.id]?.length ?? 0) > 0 && (
                    <div className="mt-2 border-t pt-2" style={{ borderColor: LINE }}>
                      <div className="mb-1 flex items-center text-[11px] font-medium opacity-70">Títulos no GE (contas a pagar)<AjudaCampo chave="projetos.viagem.ge_titulos_conta" /></div>
                      <ul className="space-y-0.5">{geTitulos[v.id].map((g, i) => (
                        <li key={`${g.situacao}-${i}`} className="flex items-baseline justify-between gap-3 text-xs"><span className="min-w-0 break-words opacity-80">{situacaoGe(g.situacao)}</span><span className="shrink-0 tabular-nums">{brl(g.valor)}</span></li>))}</ul>
                    </div>
                  )}
                  {noGe[v.id] && <a href={`/dashboard/projetos/obras/${v.obra_id}/cockpit`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium underline" style={{ color: GOLD }}><ExternalLink size={12} aria-hidden />Ver o lançamento no Resultado da obra (GE)</a>}
                </div>
              )}
            </li>)})}</ul></>)}

      {!aberta && <div id="viagens-relatorio" className="scroll-mt-4"><RelatorioViagens empresa={empresa} obras={obras} /></div>}

      {aberta && (
        <div className="space-y-3">
          <div className="rounded-xl border bg-white p-3" style={{ borderColor: LINE }}>
            <b>Viagem {aberta.numero} · {aberta.colaborador_nome}</b> <span className="text-xs opacity-60">({aberta.status})<AjudaCampo chave="projetos.viagem.status" /></span>
            <div className="text-xs opacity-70">{dt(aberta.periodo_inicio)} a {dt(aberta.periodo_fim)} · {aberta.placa ?? 'sem placa'} · {aberta.origem ?? '—'} → {aberta.destino ?? '—'}</div>
            {resumo && <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>Total<AjudaCampo chave="projetos.viagem.resumo_total" /><br /><b>{brl(resumo.total)}</b></div><div>Adiantamento<AjudaCampo chave="projetos.viagem.resumo_adiantamento" /><br /><b>{brl(resumo.adiantamento)}</b></div>
              <div>Pago pelo colaborador<AjudaCampo chave="projetos.viagem.resumo_pago_colaborador" /><br /><b>{brl(resumo.pago_colaborador)}</b></div><div>Saldo<AjudaCampo chave="projetos.viagem.resumo_saldo" /><br /><b>{brl(Math.abs(resumo.saldo))}</b></div>
              <div>Km rodado<AjudaCampo chave="projetos.viagem.resumo_km" /><br /><b>{resumo.km_rodado != null ? `${resumo.km_rodado.toLocaleString('pt-BR')} km` : '—'}</b></div>
              <div>Custo por km<AjudaCampo chave="projetos.viagem.resumo_custo_km" /><br /><b>{resumo.custo_km != null ? `${brl(resumo.custo_km)}/km` : '—'}</b></div>
              <div>Litros<AjudaCampo chave="projetos.viagem.resumo_litros" /><br /><b>{resumo.litros ? `${resumo.litros.toLocaleString('pt-BR')} L` : '—'}</b></div>
              <div>Consumo desta viagem<AjudaCampo chave="projetos.viagem.resumo_consumo" /><br /><b>{resumo.media_km_l != null ? `${resumo.media_km_l.toLocaleString('pt-BR')} km/l` : '—'}</b></div>
              <div className="col-span-2 sm:col-span-4 text-xs opacity-80">{resumoTexto(resumo.saldo)}{resumo.km_rodado == null ? ' · informe o km da saída e da volta para ver o custo por km e o consumo' : ''}</div></div>}
            {composicao.length > 0 && (
              <div className="mt-3 rounded-lg border p-2 text-sm" style={{ borderColor: LINE }}>
                <div className="mb-1 flex items-center text-xs font-medium opacity-70">Composição do custo<AjudaCampo chave="projetos.viagem.composicao_custo" /></div>
                <ul className="space-y-0.5">{composicao.map(([nome, valor]) => (
                  <li key={nome} className="flex items-baseline justify-between gap-3"><span className="min-w-0 break-words opacity-80">{nome}</span><span className="shrink-0 tabular-nums">{brl(valor)}</span></li>))}</ul>
                <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-1 font-medium" style={{ borderColor: LINE }}><span>Total</span><span className="shrink-0 tabular-nums">{brl(composicao.reduce((s, [, v]) => s + v, 0))}</span></div>
                {resumo?.km_rodado != null && resumo.custo_km != null && <div className="mt-1 text-xs opacity-70">{resumo.km_rodado.toLocaleString('pt-BR')} km × {brl(resumo.custo_km)}/km</div>}
              </div>
            )}
            {aberta.status === 'aberta' && podeGravar && <div className="mt-2 flex flex-wrap items-end gap-2">
              <Campo rotulo="Km na saída" ajuda="projetos.viagem.km_inicial"><input inputMode="decimal" className={campo} value={km.ini} onChange={(e) => setKm({ ...km, ini: e.target.value.replace(',', '.') })} /></Campo>
              <Campo rotulo="Km na volta" ajuda="projetos.viagem.km_final"><input inputMode="decimal" className={campo} value={km.fim} onChange={(e) => setKm({ ...km, fim: e.target.value.replace(',', '.') })} /></Campo>
              <button disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: ESP }} onClick={salvarKm}>Salvar km</button><AjudaCampo chave="projetos.viagem.salvar_km" /></div>}
            {aberta.status === 'aberta' && podeGravar && <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1"><button className="text-sm underline" onClick={() => (editar ? setEditar(false) : abrirEdicao())}>{editar ? 'Fechar edição' : 'Editar dados da viagem'}</button><AjudaCampo chave="projetos.viagem.editar" /></span>
              {!noGe[aberta.id] && <span className="flex items-center gap-1"><button disabled={busy} className="text-sm text-red-700 underline" onClick={excluirViagem}>Excluir viagem</button><AjudaCampo chave="projetos.viagem.excluir_viagem" /></span>}
            </div>}
          </div>
          {aberta.obra_id && <MobilizacaoViagem empresa={empresa} obraId={aberta.obra_id} />}
          {editar && aberta.status === 'aberta' && podeGravar && (
            <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-3" style={{ borderColor: LINE }}>
              <Campo rotulo="Colaborador" ajuda="projetos.viagem.colaborador"><input className={campo} value={ef.colaborador_nome ?? ''} onChange={(e) => setEf({ ...ef, colaborador_nome: e.target.value })} /></Campo>
              <Campo rotulo="Placa" ajuda="projetos.viagem.placa"><input className={campo} value={ef.placa ?? ''} onChange={(e) => setEf({ ...ef, placa: e.target.value })} /></Campo>
              <Campo rotulo="Obra principal" ajuda="projetos.viagem.obra_principal"><select className={campo} value={ef.obra_id ?? ''} onChange={(e) => setEf({ ...ef, obra_id: e.target.value })}><option value="">Obra principal…</option>{obras.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.nome}</option>)}</select></Campo>
              <Campo rotulo="Saída" ajuda="projetos.viagem.saida"><input type="date" className={campo} value={ef.periodo_inicio ?? ''} onChange={(e) => setEf({ ...ef, periodo_inicio: e.target.value })} /></Campo>
              <Campo rotulo="Volta" ajuda="projetos.viagem.volta"><input type="date" className={campo} value={ef.periodo_fim ?? ''} onChange={(e) => setEf({ ...ef, periodo_fim: e.target.value })} /></Campo>
              <Campo rotulo="Adiantamento (5.01)" ajuda="projetos.viagem.adiantamento"><input inputMode="decimal" className={campo} value={ef.adiantamento ?? ''} onChange={(e) => setEf({ ...ef, adiantamento: e.target.value.replace(',', '.') })} /></Campo>
              <Campo rotulo="Origem" ajuda="projetos.viagem.origem"><input className={campo} value={ef.origem ?? ''} onChange={(e) => setEf({ ...ef, origem: e.target.value })} /></Campo>
              <Campo rotulo="Destino" ajuda="projetos.viagem.destino"><input className={campo} value={ef.destino ?? ''} onChange={(e) => setEf({ ...ef, destino: e.target.value })} /></Campo>
              <div className="flex gap-2 sm:col-span-3"><button disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-white" style={{ background: ESP }} onClick={salvarEdicao}>Salvar alterações</button><button className="text-sm underline" onClick={() => setEditar(false)}>Cancelar</button></div>
            </div>
          )}
          {aberta.status === 'fechada' && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 text-sm" style={{ borderColor: LINE }}>
              <span>Situação no GE<AjudaCampo chave="projetos.viagem.ge_situacao" />: <b>{noGe[aberta.id] ? `lançada · ${noGe[aberta.id]} título(s)` : 'ainda não lançada'}</b></span>
              {resumo && resumo.saldo > 0 && <span>· A devolver pelo colaborador<AjudaCampo chave="projetos.viagem.ge_a_devolver" />: <b>{brl(resumo.saldo)}</b></span>}
              {!noGe[aberta.id] && podeGravar && <span className="flex items-center gap-1"><button disabled={busy} className="rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: GOLD }} onClick={() => lancarGe(aberta.id)}>Lançar no GE</button><AjudaCampo chave="projetos.viagem.ge_lancar" /></span>}
            </div>
          )}
          <ul className="space-y-1">{lancs.map((l) => (
            <li key={l.id} className="flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm" style={{ borderColor: LINE }}>
              <span>{dt(l.data)} · {l.fornecedor_nome} <span className="text-xs opacity-60">· {l.categoria} · {obraNome(l.obra_id)}{l.tipo === 'abastecimento' ? ` · ${l.litros} L` : ''}</span>{l.tipo === 'abastecimento' && precoLitro(l.valor, l.litros) != null && <span className="text-xs opacity-60"> · {brl(precoLitro(l.valor, l.litros))}/L<AjudaCampo chave="projetos.viagem.lanc_preco_litro" /></span>}</span>
              <span>{brl(l.valor)}{l.anexo_path && <VerComprovante path={l.anexo_path} />} {aberta.status === 'aberta' && podeGravar && <><button aria-label="Excluir lançamento" className="ml-2 text-xs underline" onClick={() => excluir(l.id)}>excluir</button><AjudaCampo chave="projetos.viagem.excluir_lancamento" /></>}</span></li>))}
            {lancs.length === 0 && <li className="text-sm opacity-60">Sem lançamentos.</li>}</ul>
          {desfazer && aberta.status === 'aberta' && <div role="status" className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm" style={{ borderColor: GOLD }}>Lançamento excluído.<button disabled={busy} className="font-medium underline" onClick={restaurar}>Desfazer</button><AjudaCampo chave="projetos.viagem.desfazer_exclusao" /></div>}
          {previa && aberta.status === 'aberta' && podeGravar && resumo && <PreviaFechamento viagemId={aberta.id} total={resumo.total} saldoTexto={resumo.saldo ? `${resumoTexto(resumo.saldo)}: ${brl(Math.abs(resumo.saldo))}` : resumoTexto(resumo.saldo)} obraNome={obraNome} busy={busy} onConfirmar={fechar} onCancelar={() => setPrevia(false)} />}
          {aberta.placa && <ConsumoVeiculo key={lancs.length} empresa={empresa} placa={aberta.placa} />}
          {lancs.length > 0 && <AssinaturaAcerto viagemId={aberta.id} colaborador={aberta.colaborador_nome} podeGravar={podeGravar} versao={`${lancs.map((l) => `${l.id}:${l.valor}:${l.obra_id}:${l.pago_colaborador}`).join('|')}|${resumo?.adiantamento ?? ''}`} />}
          {aberta.status === 'aberta' && podeGravar && !previa && (lf ? (
            <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-4" style={{ borderColor: LINE }}>
              <Campo rotulo="Tipo do lançamento" ajuda="projetos.viagem.lanc_tipo"><select className={campo} value={lf.tipo} onChange={(e) => setLf({ ...lf, tipo: e.target.value as LancamentoForm['tipo'] })}><option value="despesa">Despesa</option><option value="abastecimento">Abastecimento</option></select></Campo>
              <Campo rotulo="Data do cupom" ajuda="projetos.viagem.lanc_data"><input type="date" className={campo} value={lf.data} onChange={(e) => setLf({ ...lf, data: e.target.value })} /></Campo>
              <Campo rotulo={lf.tipo === 'abastecimento' ? 'Posto' : 'Fornecedor'} ajuda="projetos.viagem.lanc_fornecedor"><input className={campo} placeholder={lf.tipo === 'abastecimento' ? 'Posto' : 'Fornecedor'} value={lf.fornecedor_nome} onChange={(e) => setLf({ ...lf, fornecedor_nome: e.target.value })} /></Campo>
              <Campo rotulo="Valor" ajuda="projetos.viagem.lanc_valor"><input inputMode="decimal" className={campo} placeholder="Valor" value={lf.valor} onChange={(e) => setLf({ ...lf, valor: e.target.value.replace(',', '.') })} /></Campo>
              <Campo rotulo="Categoria" ajuda="projetos.viagem.lanc_categoria"><select className={campo} value={lf.categoria} onChange={(e) => setLf({ ...lf, categoria: e.target.value })}><option value="">Categoria…</option>{cats.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}</select></Campo>
              <Campo rotulo="Forma de pagamento" ajuda="projetos.viagem.lanc_forma"><select className={campo} value={lf.forma_pagamento} onChange={(e) => setLf({ ...lf, forma_pagamento: e.target.value })}>{FORMAS_PAGAMENTO_VIAGEM.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>)}</select></Campo>
              <CampoComprovante key={lancs.length} empresa={empresa} viagemId={aberta.id} valor={anexo} onChange={setAnexo} />
              <Campo rotulo="Obra deste cupom" ajuda="projetos.viagem.lanc_obra"><select className={campo} value={lf.obra_id} onChange={(e) => setLf({ ...lf, obra_id: e.target.value })}>{obras.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.nome}</option>)}</select></Campo>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={lf.pago_colaborador} onChange={(e) => setLf({ ...lf, pago_colaborador: e.target.checked })} />Pago pelo colaborador<AjudaCampo chave="projetos.viagem.lanc_pago_colaborador" /></label>
              {lf.tipo === 'abastecimento' && <><Campo rotulo="Litros" ajuda="projetos.viagem.lanc_litros"><input inputMode="decimal" className={campo} placeholder="Litros" value={lf.litros} onChange={(e) => setLf({ ...lf, litros: e.target.value.replace(',', '.') })} /></Campo><Campo rotulo="Hodômetro" ajuda="projetos.viagem.lanc_hodometro"><input inputMode="decimal" className={campo} placeholder="Hodômetro" value={lf.hodometro} onChange={(e) => setLf({ ...lf, hodometro: e.target.value.replace(',', '.') })} /></Campo>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={lf.tanque_cheio} onChange={(e) => setLf({ ...lf, tanque_cheio: e.target.checked })} />Tanque cheio<AjudaCampo chave="projetos.viagem.cons_tanque_cheio" /></label></>}
              <div className="flex gap-2 sm:col-span-4"><button disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-white" style={{ background: ESP }} onClick={lancar}>Lançar e novo</button><button className="text-sm underline" onClick={() => setLf(null)}>Fechar formulário</button></div>
            </div>
          ) : (
            <div className="flex items-center gap-2"><button className="rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: GOLD }} onClick={() => setLf(vazio(aberta.obra_id, aberta.periodo_inicio))}>Novo lançamento</button><AjudaCampo chave="projetos.viagem.novo_lancamento" />
              <button disabled={busy || lancs.length === 0} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-40" style={{ borderColor: ESP }} onClick={() => { setPrevia(true); setLf(null); setMsg('') }}>Fechar viagem</button><AjudaCampo chave="projetos.viagem.fechar" /></div>
          ))}
        </div>
      )}

      {!aberta && <IndicadoresViagem empresa={empresa} />}
    </div>
  )
}

// todo campo do Hub tem o "?" (AjudaCampo) ao lado do rótulo — CEO 01/10; o gate check-ajuda-campo reprova campo sem ajuda
function Campo({ rotulo, ajuda, children }: { rotulo: string; ajuda: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs"><span>{rotulo}<AjudaCampo chave={ajuda} /></span>{children}</label>
}

// Mobilização: real × orçado (gap PDCA auditor_pdca_1 01/11). Dentro da viagem/ao fechar, mostra o custo REAL das viagens
// da obra × o preço de mobilização PREVISTO no contrato do cliente, com o % e o alerta quando estoura — e o rastro para o
// Resultado da obra (cockpit). Mesma fonte do Resultado da obra: fn_viagem_indicadores → v_obra_resultado (não recalcula
// nada aqui). Sem verba de mobilização no contrato → estado vazio honesto, não inventa número (RD-38 / RD-96).
function MobilizacaoViagem({ empresa, obraId }: { empresa: string; obraId: string | null }) {
  const [o, setO] = useState<{ preco_mobilizacao: number | null; custo_viagens: number | null; mobilizacao_pct: number | null; mobilizacao_alerta: boolean | null; mobilizacao_tabela: string | null } | null>(null)
  const [carregou, setCarregou] = useState(false)
  useEffect(() => {
    let vivo = true
    setCarregou(false)
    if (!obraId) { setO(null); setCarregou(true); return () => { vivo = false } }
    void supabase.rpc('fn_viagem_indicadores', { p_company_id: empresa, p_obra_id: obraId, p_limite_pct: 0 }).then(({ data }) => {
      if (!vivo) return
      const row = ((data as { obras?: Array<Record<string, unknown>> } | null)?.obras ?? [])[0]
      setO(row ? {
        preco_mobilizacao: (row.preco_mobilizacao as number | null) ?? null,
        custo_viagens: (row.custo_viagens as number | null) ?? null,
        mobilizacao_pct: (row.mobilizacao_pct as number | null) ?? null,
        mobilizacao_alerta: (row.mobilizacao_alerta as boolean | null) ?? null,
        mobilizacao_tabela: (row.mobilizacao_tabela as string | null) ?? null,
      } : null)
      setCarregou(true)
    })
    return () => { vivo = false }
  }, [empresa, obraId])
  if (!obraId || !carregou) return null
  const acima = o?.mobilizacao_alerta === true
  return (
    <div className="rounded-xl border bg-white p-3 text-sm" style={{ borderColor: acima ? '#B42318' : LINE, background: acima ? '#FEF2F2' : '#FFFFFF' }}>
      <div className="mb-1 flex items-center text-xs font-medium opacity-70">Mobilização: real × orçado do contrato<AjudaCampo chave="projetos.viagem.ind_mobilizacao" /></div>
      {o == null || o.preco_mobilizacao == null ? (
        <div className="text-xs opacity-60">Sem verba de mobilização no contrato do cliente — cadastre na tabela de preços para comparar o custo real com o previsto.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="opacity-80">Previsto no contrato{o.mobilizacao_tabela ? ` · ${o.mobilizacao_tabela}` : ''}</span>
            <b className="shrink-0 tabular-nums" style={{ color: ESP }}>{brl(o.preco_mobilizacao)}</b>
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="opacity-80">Custo real das viagens da obra</span>
            <b className="shrink-0 tabular-nums" style={{ color: acima ? '#B42318' : ESP }}>{brl(o.custo_viagens)}</b>
          </div>
          {o.mobilizacao_pct != null && (
            <div className="mt-1 flex items-center justify-between border-t pt-1 text-xs" style={{ borderColor: LINE }}>
              <span className="inline-flex items-center font-medium" style={{ color: acima ? '#B42318' : GOLD }}>{acima ? '⚠ ' : ''}real {o.mobilizacao_pct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% do previsto{acima ? ' — o excesso sai da margem' : ''}<AjudaCampo chave="projetos.viagem.ind_mob_pct" /></span>
            </div>
          )}
        </>
      )}
      <a href={`/dashboard/projetos/obras/${obraId}/cockpit`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium underline" style={{ color: GOLD }}><ExternalLink size={12} aria-hidden />Ver no Resultado da obra (GE)</a>
    </div>
  )
}

// tile da faixa de resumo: rótulo + "?" (RD-95) em cima, número grande embaixo; destaque realça as viagens abertas (pendentes)
function ResumoTile({ rotulo, ajuda, valor, destaque = false }: { rotulo: string; ajuda: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border bg-white p-3" style={{ borderColor: destaque ? GOLD : LINE }}>
      <div className="flex items-center text-xs opacity-70">{rotulo}<AjudaCampo chave={ajuda} /></div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums" style={{ color: destaque ? GOLD : ESP }}>{valor}</div>
    </div>
  )
}
