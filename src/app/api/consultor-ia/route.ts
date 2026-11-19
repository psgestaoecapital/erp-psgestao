import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exigirUsuario, exigirEmpresas } from '@/lib/auth/guardaApi'
import { callAI } from '@/lib/aiProvider'
import { IABloqueadaError } from '@/lib/aiModel'

// Consultor IA — Assistente de dados (SPEC Eng. Chefe, RD-41 · CEO 17/11, RD-101).
// A IA é ROTEADOR: recebe só a PERGUNTA + o catálogo de ferramentas e devolve {tool, params}.
// Nunca gera SQL; os DADOS não vão ao LLM. O servidor executa a RPC guardada com o company_id
// FORÇADO (validado pela sessão) e monta um resumo determinístico. Teto GLOBAL US$ 2/dia (fn_ia_global_pode_gastar).

export const dynamic = 'force-dynamic'

const FEATURE = 'consultor_ia'
const CUSTO_ESTIMADO = 0.003 // US$/consulta (roteamento = prompt minúsculo); conservador p/ o teto global

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Credenciais Supabase não configuradas')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
// Cliente com o JWT do PRÓPRIO usuário: as RPCs guardadas (SECURITY DEFINER + get_user_company_ids())
// rodam no escopo dele — o guard da função barra outra empresa, e nós ainda forçamos o company_id validado.
function getUsuario(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

// ── Catálogo de ferramentas (whitelist de RPCs de leitura guardadas) ───────────────────────────
type Ferramenta = { tool: string; desc: string; params: Record<string, string> }
const CATALOGO: Ferramenta[] = [
  { tool: 'contas_receber', desc: 'Títulos a RECEBER (entradas) por vencimento e status.', params: { periodo: 'hoje|amanha|semana|mes|vencidos|todos', status: '(opcional) aberto|vencido|pago|todos' } },
  { tool: 'contas_pagar', desc: 'Títulos a PAGAR (despesas) por vencimento e status.', params: { periodo: 'hoje|amanha|semana|mes|vencidos|todos', status: '(opcional) aberto|vencido|pago|todos' } },
  { tool: 'saldo_contas', desc: 'Saldo atual das contas bancárias da empresa.', params: {} },
  { tool: 'inadimplentes', desc: 'Títulos a receber VENCIDOS e não pagos (inadimplência).', params: {} },
  { tool: 'buscar_cliente', desc: 'Verifica se um cliente está cadastrado e traz os dados dele. Use quando a pergunta cita um nome ou CNPJ de cliente.', params: { termo: 'nome ou CNPJ do cliente' } },
  { tool: 'divergencia_saldo', desc: 'Compara o saldo do SISTEMA com o saldo do BANCO/extrato por conta e mostra a diferença exata. Use para "meu saldo bate com o banco?", "os saldos são iguais?", "por que o saldo do sistema é diferente do banco?".', params: {} },
  { tool: 'lancamentos_sem_conciliar', desc: 'Lista os lançamentos já pagos/recebidos e SEM conciliar (os que fazem o saldo não bater), com valor, data, contraparte e CNPJ, e link para corrigir.', params: { conta: '(opcional) nome da conta bancária' } },
  { tool: 'lancamentos_sem_cnpj', desc: 'Lançamentos cujo fornecedor/cliente está sem CNPJ ou sem cadastro.', params: {} },
  { tool: 'buscar_lancamento', desc: 'Localiza um lançamento específico por valor, número do documento/NF, descrição ou nome do fornecedor/cliente, com link para abrir e corrigir.', params: { termo: 'valor, documento, descrição ou nome' } },
  { tool: 'raio_x', desc: 'Raio-X dos dados: inconsistências, saldo que não bate, boleto sem baixa, cadastro errado.', params: {} },
]
const TOOLS = new Set(CATALOGO.map((c) => c.tool))

const SYSTEM = [
  'Você é um ROTEADOR de consultas sobre os dados financeiros de UMA empresa.',
  'Dada a PERGUNTA do usuário (português) e a lista de FERRAMENTAS, escolha UMA ferramenta e seus parâmetros.',
  'NUNCA invente dados. NUNCA gere SQL. Não escolha empresa — o servidor já sabe qual é.',
  'Para datas use SOMENTE os valores de "periodo" do catálogo (hoje, amanha, semana, mes, vencidos, todos) — não calcule datas.',
  'Responda SOMENTE um JSON, sem texto fora dele: {"tool":"<nome>","params":{...}}.',
  'Se nenhuma ferramenta responder a pergunta, responda {"tool":"nenhuma"}.',
].join(' ')

// ── Datas relativas resolvidas no SERVIDOR (fuso America/Sao_Paulo) ─────────────────────────────
function hojeSP(): Date {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // YYYY-MM-DD
  return new Date(s + 'T00:00:00')
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function resolvePeriodo(periodo?: string): { de: string; ate: string; status: string } {
  const h = hojeSP()
  switch ((periodo || 'todos').toLowerCase()) {
    case 'hoje': return { de: iso(h), ate: iso(h), status: 'todos' }
    case 'amanha': return { de: iso(addDias(h, 1)), ate: iso(addDias(h, 1)), status: 'todos' }
    case 'semana': return { de: iso(h), ate: iso(addDias(h, 7)), status: 'todos' }
    case 'mes': { const ini = new Date(h.getFullYear(), h.getMonth(), 1); const fim = new Date(h.getFullYear(), h.getMonth() + 1, 0); return { de: iso(ini), ate: iso(fim), status: 'todos' } }
    case 'vencidos': return { de: iso(addDias(h, -730)), ate: iso(h), status: 'vencido' }
    default: return { de: iso(addDias(h, -365)), ate: iso(addDias(h, 365)), status: 'todos' }
  }
}
// Status do catálogo → filtros que o fn_ge_listagem_v2 entende (p_status_filtros). Antes passávamos 'vencido'/'aberto'/'pago',
// que a RPC não reconhece → lista sempre vazia em "inadimplentes" e nos filtros de status.
const STATUS_FILTROS: Record<string, string[]> = {
  todos: ['todos'],
  aberto: ['vencidos', 'hoje', 'avencer'],
  vencido: ['vencidos'],
  pago: ['pagos', 'conciliado'],
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const brl = (v: number) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function extrairJSON(texto: string): { tool?: string; params?: Record<string, unknown> } | null {
  if (!texto) return null
  const limpo = texto.replace(/```json/gi, '').replace(/```/g, '').trim()
  const i = limpo.indexOf('{'); const j = limpo.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try { return JSON.parse(limpo.slice(i, j + 1)) } catch { return null }
}

export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Envie uma pergunta em texto.' }, { status: 400 }) }

  // Escopo "só consulta de dados": rejeita imagem/anexo (a rota não processa IA de imagem).
  if (body.imagem || body.image || body.anexo || body.anexos || body.arquivo || body.file) {
    return NextResponse.json({ ok: false, error: 'Este assistente responde só a perguntas em texto sobre seus dados — não processa imagens ou anexos.' }, { status: 415 })
  }
  const pergunta = typeof body.pergunta === 'string' ? body.pergunta.trim() : ''
  const companyId = typeof body.company_id === 'string' ? body.company_id : ''
  if (!pergunta) return NextResponse.json({ ok: false, error: 'Escreva uma pergunta.' }, { status: 400 })
  if (pergunta.length > 500) return NextResponse.json({ ok: false, error: 'Pergunta muito longa — resuma em poucas palavras.' }, { status: 400 })

  // Multi-tenant / LGPD: a empresa vem do seletor do topo e é VALIDADA aqui contra get_user_company_ids() do
  // PRÓPRIO usuário (o LLM nunca escolhe empresa). "Consolidado"/grupo não é aceito: o consultor responde por UM CNPJ.
  if (!UUID_RE.test(companyId)) {
    return NextResponse.json({ ok: false, error: 'Selecione uma empresa (um CNPJ) no topo da tela para perguntar.' }, { status: 400 })
  }
  const negado = await exigirEmpresas(u, [companyId])
  if (negado) return negado

  const admin = getAdmin()

  // Gate 1 — teto GLOBAL US$ 2/dia (feature consultor_ia). Bloqueado → cai no determinístico (grátis).
  try {
    const { data: gate } = await admin.rpc('fn_ia_global_pode_gastar', { p_feature: FEATURE, p_custo_estimado: CUSTO_ESTIMADO })
    const g = gate as { pode?: boolean; motivo?: string; consumo?: number; teto?: number } | null
    if (!g?.pode) {
      return NextResponse.json({ ok: true, bloqueado: true, motivo: g?.motivo ?? 'indisponivel',
        mensagem: 'O assistente atingiu o limite diário do sistema. Use os atalhos abaixo (Raio-X) — eles não têm custo.' })
    }
  } catch {
    // fail-closed de custo: sem conseguir ler o teto, não gasta — cai no determinístico.
    return NextResponse.json({ ok: true, bloqueado: true, motivo: 'gate_indisponivel',
      mensagem: 'Não consegui checar o limite de custo agora. Use os atalhos abaixo (Raio-X) — eles não têm custo.' })
  }

  // Gate 2 — roteamento pelo LLM (só a pergunta + o catálogo; os dados NÃO vão ao LLM).
  let escolha: { tool?: string; params?: Record<string, unknown> } | null = null
  try {
    const resp = await callAI({
      finalidade: 'consultor',
      maxTokens: 200,
      system: SYSTEM,
      prompt: `FERRAMENTAS:\n${JSON.stringify(CATALOGO)}\n\nPERGUNTA: "${pergunta}"\n\nResponda só o JSON.`,
    })
    escolha = extrairJSON(resp.text)
    // registra o custo (estimativa conservadora — roteamento é minúsculo). AWAIT: em função serverless um
    // fire-and-forget pode morrer antes de gravar, e sem registro o teto global nunca dispara.
    await admin.rpc('fn_ia_empresa_registrar_gasto', { p_company_id: companyId, p_feature: FEATURE, p_custo_usd: CUSTO_ESTIMADO, p_chamadas: 1 }).then(() => {}, () => {})
  } catch (e) {
    if (e instanceof IABloqueadaError) {
      return NextResponse.json({ ok: true, bloqueado: true, motivo: 'ia_bloqueada',
        mensagem: 'O assistente está temporariamente desligado. Use os atalhos abaixo (Raio-X) — eles não têm custo.' })
    }
    return NextResponse.json({ ok: true, naoEntendi: true, mensagem: 'Não consegui consultar agora. Tente de novo ou use um atalho abaixo.' })
  }

  const tool = typeof escolha?.tool === 'string' ? escolha.tool : ''
  if (!tool || tool === 'nenhuma' || !TOOLS.has(tool)) {
    return NextResponse.json({ ok: true, naoEntendi: true,
      mensagem: 'Não entendi a pergunta. Posso trazer contas a pagar e a receber, saldo, inadimplentes, comparar seu saldo com o banco, listar lançamentos sem conciliar ou sem CNPJ, localizar um lançamento ou buscar um cliente. Tente reformular ou use um atalho abaixo.' })
  }
  const params = (escolha?.params && typeof escolha.params === 'object') ? escolha.params as Record<string, unknown> : {}

  // Executa a RPC escolhida com o company_id FORÇADO (nunca o que o LLM mandar), no token do usuário.
  const sb = getUsuario(u.token)
  try {
    if (tool === 'contas_receber' || tool === 'contas_pagar') {
      const tipo = tool === 'contas_receber' ? 'receber' : 'pagar'
      const { de, ate, status } = resolvePeriodo(typeof params.periodo === 'string' ? params.periodo : undefined)
      const pedido = typeof params.status === 'string' && STATUS_FILTROS[params.status.toLowerCase()] ? params.status.toLowerCase() : status
      const { data, error } = await sb.rpc('fn_ge_listagem_v2', { p_company_id: companyId, p_tipo: tipo, p_data_inicio: de, p_data_fim: ate, p_status_filtro: 'todos', p_status_filtros: STATUS_FILTROS[pedido] ?? ['todos'] })
      if (error) throw error
      if ((data as { sem_plano?: boolean })?.sem_plano) return NextResponse.json({ ok: true, naoEntendi: true, mensagem: 'Esta empresa não tem o módulo financeiro da Gestão Empresarial ativo.' })
      const r = data as { kpis?: Record<string, { qtd?: number; valor?: number } | number>; resultados?: unknown[]; total_rows?: number }
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
    if (tool === 'buscar_cliente') {
      const termo = typeof params.termo === 'string' ? params.termo.trim() : ''
      if (!termo) return NextResponse.json({ ok: true, naoEntendi: true, mensagem: 'Diga o nome ou o CNPJ do cliente que você quer consultar.' })
      const { data, error } = await sb.rpc('fn_cliente_buscar', { p_company_id: companyId, p_termo: termo, p_limit: 10 })
      if (error) throw error
      const r = data as { ok?: boolean; clientes?: unknown[]; resultados?: unknown[] } | null
      const lista = (r?.clientes ?? r?.resultados ?? []) as unknown[]
      if (!r?.ok || lista.length === 0) {
        return NextResponse.json({ ok: true, tipo: 'cliente', titulo: 'cliente', resumo: `Não encontrei nenhum cliente com "${termo}" cadastrado nesta empresa.`, linhas: [] })
      }
      return NextResponse.json({ ok: true, tipo: 'cliente', titulo: 'cliente', resumo: `Encontrei ${lista.length} cliente(s) para "${termo}".`, linhas: lista })
    }
    if (tool === 'divergencia_saldo') {
      const { data, error } = await sb.rpc('fn_consultor_divergencia_contas', { p_company_id: companyId })
      if (error) throw error
      const r = data as { ok?: boolean; tem_divergencia?: boolean; contas?: { conta_nome: string; saldo_sistema: number; saldo_banco: number; diferenca: number }[]; contas_sem_extrato?: { conta_nome: string }[] } | null
      if (!r?.ok) return NextResponse.json({ ok: false, error: 'Você não tem acesso aos dados desta empresa.' }, { status: 403 })
      const contas = r.contas ?? []
      const semExtrato = r.contas_sem_extrato ?? []
      const notaSem = semExtrato.length ? ` Sem extrato para comparar: ${semExtrato.map((c) => c.conta_nome).join(', ')}.` : ''
      const resumo = r.tem_divergencia
        ? 'Não batem: ' + contas.map((c) => `conta ${c.conta_nome} tem ${brl(Math.abs(c.diferenca))} de diferença (sistema ${brl(c.saldo_sistema)} × banco ${brl(c.saldo_banco)})`).join('; ') + '.' + notaSem
        : 'Sim, todas as contas com extrato estão batendo com o banco.' + notaSem
      return NextResponse.json({ ok: true, tipo: 'divergencia', titulo: 'saldo do sistema × banco', resumo, contas, contas_sem_extrato: semExtrato })
    }
    if (tool === 'lancamentos_sem_conciliar' || tool === 'lancamentos_sem_cnpj' || tool === 'buscar_lancamento') {
      const filtro = tool === 'lancamentos_sem_conciliar' ? 'nao_conciliados' : tool === 'lancamentos_sem_cnpj' ? 'sem_cnpj' : 'por_termo'
      const termo = typeof params.termo === 'string' ? params.termo.trim().slice(0, 100) : ''
      const conta = typeof params.conta === 'string' ? params.conta.trim().slice(0, 80) : ''
      if (filtro === 'por_termo' && termo.length < 2) {
        return NextResponse.json({ ok: true, naoEntendi: true, mensagem: 'Diga o valor, o número do documento, a descrição ou o nome do fornecedor/cliente do lançamento.' })
      }
      const { data, error } = await sb.rpc('fn_consultor_lancamentos_detalhe', { p_company_id: companyId, p_filtro: filtro, p_termo: termo || null, p_conta: conta || null, p_limite: 50 })
      if (error) throw error
      const r = data as { ok?: boolean; total?: number; mostrando?: number; linhas?: unknown[] } | null
      if (!r?.ok) return NextResponse.json({ ok: false, error: 'Você não tem acesso aos dados desta empresa.' }, { status: 403 })
      const total = r.total ?? 0
      const mostrando = r.mostrando ?? 0
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
    return NextResponse.json({ ok: true, naoEntendi: true, mensagem: 'Não entendi a pergunta. Use um atalho abaixo.' })
  } catch {
    return NextResponse.json({ ok: false, error: 'Não consegui buscar esses dados agora. Tente de novo em instantes.' }, { status: 500 })
  }
}
