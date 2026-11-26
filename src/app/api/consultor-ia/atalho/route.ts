import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exigirUsuario, exigirEmpresas } from '@/lib/auth/guardaApi'

// Consultor IA — ATALHOS determinísticos (PR B): os chips, a "situação de um parceiro", saldo, divergência e
// listas continuam GRÁTIS (SEM LLM). O cliente diz QUAL ferramenta (o botão já sabe); o servidor executa a RPC
// guardada com o company_id FORÇADO e monta o mesmo payload que a tela já renderiza. O texto livre "por quê"
// vai para o AGENTE (rota /api/consultor-ia, com custo). Mesma régua de datas/status e montagem da rota antiga.

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const brl = (v: number) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDataBR = (s?: string | null) => { if (!s) return '—'; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s) }

function getUsuario(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function hojeSP(): Date { return new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00') }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function resolvePeriodo(periodo?: string): { de: string; ate: string } {
  const h = hojeSP()
  switch ((periodo || 'todos').toLowerCase()) {
    case 'hoje': return { de: iso(h), ate: iso(h) }
    case 'amanha': return { de: iso(addDias(h, 1)), ate: iso(addDias(h, 1)) }
    case 'semana': return { de: iso(h), ate: iso(addDias(h, 7)) }
    case 'mes': { const i = new Date(h.getFullYear(), h.getMonth(), 1); const f = new Date(h.getFullYear(), h.getMonth() + 1, 0); return { de: iso(i), ate: iso(f) } }
    case 'vencidos': return { de: iso(addDias(h, -730)), ate: iso(h) }
    default: return { de: iso(addDias(h, -365)), ate: iso(addDias(h, 365)) }
  }
}
const STATUS_FILTROS: Record<string, string[]> = { todos: ['todos'], aberto: ['vencidos', 'hoje', 'avencer'], vencido: ['vencidos'], pago: ['pagos', 'conciliado'] }

// ── Situação de um parceiro: a RPC traz diagnósticos crus; a frase e o resumo são montados AQUI ───────────────
type Diag = Record<string, unknown> & { codigo?: string; link?: string }
function fraseDiag(d: Diag): string {
  const num = d.numero ? `nº ${d.numero}` : 'sem número'
  const venc = fmtDataBR(d.vencimento as string)
  switch (d.codigo) {
    case 'pago_com_juros_parcial': return `O título ${num} (venc. ${venc}) foi pago (${brl(Number(d.valor_pago))}) com ${brl(Number(d.juros_multa))} de juros/multa, mas ficou marcado como "${d.status}". O saldo de ${brl(Number(d.saldo))} é só o juro/multa não liquidado — reabrir e salvar o título acerta o status.`
    case 'saldo_negativo': return `O título ${num} (venc. ${venc}) está com saldo negativo: foi pago ${brl(Number(d.a_mais))} a mais (crédito do cliente).`
    case 'juros_nao_lancados': return `A baixa conciliada do título ${num} (venc. ${venc}) recebeu ${brl(Number(d.diferenca))} a mais no banco do que o valor lançado — provável juros/multa não lançado no título.`
    case 'pago_sem_conciliar': return `O título ${num} (venc. ${venc}) está pago, mas ainda não foi conciliado com o banco.`
    case 'vencido_em_aberto': return `O título ${num} (venc. ${venc}) está vencido há ${Number(d.dias)} dia(s) com ${brl(Number(d.saldo))} em aberto.`
    default: return ''
  }
}
function montarSituacao(data: unknown): Record<string, unknown> {
  const r = data as { ok?: boolean; encontrou?: boolean; motivo?: string; termo?: string; opcoes?: unknown[]; parceiro?: { nome?: string; tipo?: string }; titulos?: unknown[]; diagnosticos?: Diag[]; totais?: Record<string, number> } | null
  if (!r?.ok) return { ok: false, error: 'Você não tem acesso aos dados desta empresa.', _status: 403 }
  if (r.encontrou === false) {
    if (r.motivo === 'varios') return { ok: true, tipo: 'situacao_parceiro', titulo: 'situação', resumo: `Encontrei mais de um cadastro para "${r.termo}". Toque no que você quer ver.`, opcoes: r.opcoes ?? [] }
    if (r.motivo === 'nao_encontrado') return { ok: true, tipo: 'situacao_parceiro', titulo: 'situação', resumo: `Não encontrei nenhum cliente ou fornecedor com "${r.termo}" nesta empresa.`, titulos: [], diagnosticos: [] }
    return { ok: true, naoEntendi: true, mensagem: 'Diga o nome ou o CNPJ do cliente/fornecedor que você quer consultar.' }
  }
  const diag = (r.diagnosticos ?? []).map((d) => ({ ...d, frase: fraseDiag(d) }))
  const t = r.totais ?? {}
  const nome = r.parceiro?.nome || 'Parceiro'
  const partes = [`${nome}: ${Number(t.em_aberto || 0) > 0 ? brl(t.em_aberto) + ' em aberto' : 'nada em aberto'}`]
  if (Number(t.vencido || 0) > 0) partes.push(`${brl(t.vencido)} vencido`)
  const base = partes.join(' · ') + '.'
  const resumo = diag.length ? base + ' ' + diag.slice(0, 2).map((d) => d.frase).join(' ') : base + ' Nenhuma pendência de lançamento encontrada.'
  return { ok: true, tipo: 'situacao_parceiro', titulo: `situação de ${r.parceiro?.tipo === 'fornecedor' ? 'fornecedor' : 'cliente'}`, resumo, parceiro: r.parceiro, titulos: r.titulos ?? [], diagnosticos: diag, totais: r.totais }
}

export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Requisição inválida.' }, { status: 400 }) }

  const tool = typeof body.tool === 'string' ? body.tool : ''
  const params = (body.params && typeof body.params === 'object') ? body.params as Record<string, unknown> : {}
  const companyId = typeof body.company_id === 'string' ? body.company_id : ''
  if (!UUID_RE.test(companyId)) return NextResponse.json({ ok: false, error: 'Selecione uma empresa (um CNPJ) no topo da tela.' }, { status: 400 })
  const negado = await exigirEmpresas(u, [companyId])
  if (negado) return negado
  const sb = getUsuario(u.token)

  try {
    if (tool === 'contas_receber' || tool === 'contas_pagar') {
      const tipo = tool === 'contas_receber' ? 'receber' : 'pagar'
      const { de, ate } = resolvePeriodo(typeof params.periodo === 'string' ? params.periodo : undefined)
      const pedido = typeof params.status === 'string' && STATUS_FILTROS[params.status.toLowerCase()] ? params.status.toLowerCase() : 'todos'
      const { data, error } = await sb.rpc('fn_ge_listagem_v2', { p_company_id: companyId, p_tipo: tipo, p_data_inicio: de, p_data_fim: ate, p_status_filtro: 'todos', p_status_filtros: STATUS_FILTROS[pedido] ?? ['todos'] })
      if (error) throw error
      if ((data as { sem_plano?: boolean })?.sem_plano) return NextResponse.json({ ok: true, naoEntendi: true, mensagem: 'Esta empresa não tem o módulo financeiro da Gestão Empresarial ativo.' })
      const r = data as { kpis?: Record<string, { valor?: number } | number>; resultados?: unknown[]; total_rows?: number }
      const tot = r?.kpis?.total
      const totalValor = typeof tot === 'number' ? tot : (tot as { valor?: number })?.valor ?? 0
      const n = r?.total_rows ?? (r?.resultados?.length ?? 0)
      const nome = tool === 'contas_receber' ? 'conta(s) a receber' : 'conta(s) a pagar'
      return NextResponse.json({ ok: true, tipo: 'lista', titulo: nome, resumo: `${n} ${nome} no período — total ${brl(totalValor)}.`, kpis: r?.kpis, linhas: r?.resultados ?? [] })
    }
    if (tool === 'inadimplentes') {
      const { de, ate } = resolvePeriodo('vencidos')
      const { data, error } = await sb.rpc('fn_ge_listagem_v2', { p_company_id: companyId, p_tipo: 'receber', p_data_inicio: de, p_data_fim: ate, p_status_filtro: 'vencidos' })
      if (error) throw error
      const r = data as { kpis?: { vencidos?: { qtd?: number; valor?: number } }; resultados?: unknown[] }
      const v = r?.kpis?.vencidos ?? {}
      return NextResponse.json({ ok: true, tipo: 'lista', titulo: 'inadimplência', resumo: `${v.qtd ?? 0} título(s) vencido(s) — total ${brl(v.valor ?? 0)}.`, kpis: r?.kpis, linhas: r?.resultados ?? [] })
    }
    if (tool === 'saldo_contas') {
      const { data, error } = await sb.rpc('fn_saldo_bancos_dinamico', { p_company_ids: [companyId] })
      if (error) throw error
      const saldo = Number(data ?? 0)
      return NextResponse.json({ ok: true, tipo: 'valor', titulo: 'saldo das contas', resumo: `Saldo atual das contas bancárias: ${brl(saldo)}.`, valor: saldo })
    }
    if (tool === 'situacao_parceiro') {
      const termo = typeof params.termo === 'string' ? params.termo.trim().slice(0, 120) : ''
      const tp = typeof params.tipo === 'string' && ['cliente', 'fornecedor'].includes(params.tipo.toLowerCase()) ? params.tipo.toLowerCase() : 'auto'
      if (termo.length < 2) return NextResponse.json({ ok: true, naoEntendi: true, mensagem: 'Diga o nome ou o CNPJ do cliente/fornecedor que você quer consultar.' })
      const { data, error } = await sb.rpc('fn_consultor_situacao_parceiro', { p_company_id: companyId, p_termo: termo, p_tipo: tp })
      if (error) throw error
      const payload = montarSituacao(data)
      if (payload.ok === false) return NextResponse.json({ ok: false, error: payload.error }, { status: (payload._status as number) ?? 403 })
      return NextResponse.json(payload)
    }
    if (tool === 'divergencia_saldo') {
      const { data, error } = await sb.rpc('fn_consultor_divergencia_contas', { p_company_id: companyId })
      if (error) throw error
      const r = data as { ok?: boolean; tem_divergencia?: boolean; contas?: { conta_nome: string; saldo_sistema: number; saldo_banco: number; diferenca: number }[]; contas_sem_extrato?: { conta_nome: string }[] } | null
      if (!r?.ok) return NextResponse.json({ ok: false, error: 'Você não tem acesso aos dados desta empresa.' }, { status: 403 })
      const contas = r.contas ?? []
      const semExtrato = r.contas_sem_extrato ?? []
      const notaSem = semExtrato.length ? ` Sem extrato para comparar: ${semExtrato.map((c) => c.conta_nome).join(', ')}.` : ''
      const divergentes = contas.filter((c) => Math.abs(Number(c.diferenca)) > 0.005)
      const linhas: Record<string, unknown>[] = []
      if (divergentes.length) {
        const detalhes = await Promise.all(divergentes.map((c) => sb.rpc('fn_consultor_lancamentos_detalhe', { p_company_id: companyId, p_filtro: 'nao_conciliados', p_termo: null, p_conta: c.conta_nome, p_limite: 50 })))
        divergentes.forEach((c, i) => {
          const dd = detalhes[i].data as { ok?: boolean; linhas?: Record<string, unknown>[] } | null
          if (dd?.ok && Array.isArray(dd.linhas)) for (const ln of dd.linhas) linhas.push({ ...ln, conta: (ln as { conta?: unknown }).conta ?? c.conta_nome })
        })
      }
      const resumo = r.tem_divergencia
        ? 'Não batem: ' + contas.map((c) => `conta ${c.conta_nome} tem ${brl(Math.abs(c.diferenca))} de diferença (sistema ${brl(c.saldo_sistema)} × banco ${brl(c.saldo_banco)})`).join('; ') + '.' + (linhas.length ? ` Encontrei ${linhas.length} lançamento(s) sem conciliar que explicam a maior parte da diferença.` : '') + notaSem
        : 'Sim, todas as contas com extrato estão batendo com o banco.' + notaSem
      return NextResponse.json({ ok: true, tipo: 'divergencia', titulo: 'saldo do sistema × banco', resumo, contas, contas_sem_extrato: semExtrato, linhas })
    }
    if (tool === 'lancamentos_sem_conciliar' || tool === 'lancamentos_sem_cnpj' || tool === 'buscar_lancamento') {
      const filtro = tool === 'lancamentos_sem_conciliar' ? 'nao_conciliados' : tool === 'lancamentos_sem_cnpj' ? 'sem_cnpj' : 'por_termo'
      const termo = typeof params.termo === 'string' ? params.termo.trim().slice(0, 100) : ''
      const conta = typeof params.conta === 'string' ? params.conta.trim().slice(0, 80) : ''
      if (filtro === 'por_termo' && termo.length < 2) return NextResponse.json({ ok: true, naoEntendi: true, mensagem: 'Diga o valor, o documento, a descrição ou o nome do lançamento.' })
      const { data, error } = await sb.rpc('fn_consultor_lancamentos_detalhe', { p_company_id: companyId, p_filtro: filtro, p_termo: termo || null, p_conta: conta || null, p_limite: 50 })
      if (error) throw error
      const r = data as { ok?: boolean; total?: number; mostrando?: number; linhas?: unknown[] } | null
      if (!r?.ok) return NextResponse.json({ ok: false, error: 'Você não tem acesso aos dados desta empresa.' }, { status: 403 })
      const total = r.total ?? 0, mostrando = r.mostrando ?? 0
      const extra = total > mostrando ? ` Mostrando os ${mostrando} mais recentes.` : ''
      const resumo = filtro === 'nao_conciliados'
        ? (total ? `${total} lançamento(s) pago(s)/recebido(s) sem conciliar${conta ? ` na conta "${conta}"` : ''}. São eles que fazem o saldo não bater com o banco.${extra}` : 'Nenhum lançamento pago/recebido está sem conciliar.')
        : filtro === 'sem_cnpj'
          ? (total ? `${total} lançamento(s) com fornecedor/cliente sem CNPJ ou sem cadastro.${extra}` : 'Todos os lançamentos têm fornecedor/cliente cadastrado com CNPJ.')
          : (total ? `Encontrei ${total} lançamento(s) para "${termo}".${extra}` : `Não encontrei lançamento com "${termo}" nesta empresa.`)
      return NextResponse.json({ ok: true, tipo: 'lista_lancamentos', titulo: 'lançamentos', resumo, linhas: r.linhas ?? [] })
    }
    if (tool === 'raio_x') {
      const { data, error } = await sb.rpc('fn_consultor_raiox', { p_company_id: companyId })
      if (error) throw error
      const r = data as { resumo?: { total?: number; alta?: number; media?: number; baixa?: number }; achados?: unknown[] }
      const res = r?.resumo ?? {}
      return NextResponse.json({ ok: true, tipo: 'raiox', titulo: 'raio-x', resumo: (res.total ?? 0) === 0 ? 'Analisei seus dados e não achei problema.' : `${res.total} achado(s): ${res.alta ?? 0} grave(s), ${res.media ?? 0} atenção, ${res.baixa ?? 0} ok.`, achados: r?.achados ?? [] })
    }
    return NextResponse.json({ ok: false, error: 'Atalho desconhecido.' }, { status: 400 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Não consegui buscar esses dados agora. Tente de novo em instantes.' }, { status: 500 })
  }
}
