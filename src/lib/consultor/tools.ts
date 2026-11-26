/**
 * tools.ts — Consultor IA (PR B, item 2): catálogo de ferramentas do AGENTE + dispatcher.
 *
 * O agente (Messages API, parâmetro `tools`) escolhe e encadeia estas ferramentas de LEITURA. O servidor
 * executa a RPC guardada com o company_id FORÇADO (nunca o que o LLM mandar) e devolve o JSON cru como
 * tool_result — é esse dado que o agente lê para investigar e explicar. NENHUMA ferramenta escreve: o agente
 * explica e manda o LINK da tela onde o usuário corrige. 1ª trava do consultar_dados = validarSqlConsultor
 * (parser real); a 2ª é a própria fn_consultor_sql (papel consultor_leitor, só as views do schema consultor).
 */
import { validarSqlConsultor } from './sqlGuard'

/** Cliente Supabase mínimo que este módulo precisa (evita acoplar ao tipo completo). */
export type SupaRpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }

export type FerramentaResultado = { resultado: unknown; passo: string }

/** Ferramentas no formato da Messages API. company_id NUNCA é parâmetro — o servidor o força. */
export const TOOLS_SCHEMA = [
  {
    name: 'consultar_dados',
    description:
      'Roda UMA consulta SQL de LEITURA (um único SELECT) sobre a camada semântica da empresa — schema consultor: ' +
      'titulos, baixas, boletos, extrato, conciliacao_vinculos, contas_bancarias, parceiros, categorias, centros_custo, ' +
      'contratos, historico_titulo, dicionario_view. Use para cruzar dados e investigar "por quê" (ex.: título × baixas × ' +
      'extrato × conciliação × histórico). O company_id já está fixado pelo servidor: NÃO filtre por empresa. Só SELECT; ' +
      'proibido alterar dados. Consulte a dicionario_view para saber os nomes das colunas.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Um único SELECT sobre as views do schema consultor (sem ";" final, sem comentários).' },
        objetivo: { type: 'string', description: 'Em uma frase, o que você quer descobrir (vai para o log, não aos dados).' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'situacao_parceiro',
    description:
      'Situação de UM cliente ou fornecedor citado pelo nome ou CNPJ: títulos (a receber/a pagar), pagamentos, juros, ' +
      'saldo e POR QUE o saldo está assim (pago com juros, pago a mais, pago sem conciliar, vencido). Use para "por que o ' +
      'saldo do X", "o X pagou?", "quanto o X deve?", "situação do X".',
    input_schema: {
      type: 'object',
      properties: { termo: { type: 'string', description: 'Nome ou CNPJ do cliente/fornecedor.' }, tipo: { type: 'string', enum: ['cliente', 'fornecedor', 'auto'] } },
      required: ['termo'],
    },
  },
  { name: 'raio_x', description: 'Raio-X dos dados da empresa: inconsistências, saldo que não bate, boleto sem baixa, cadastro errado.', input_schema: { type: 'object', properties: {} } },
  { name: 'divergencia_saldo', description: 'Compara o saldo do SISTEMA com o do BANCO/extrato por conta, mostra a diferença exata e já traz os lançamentos sem conciliar que a causam.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'lancamentos_detalhe',
    description: 'Lista lançamentos com valor, data, contraparte, CNPJ e link para corrigir. filtro: nao_conciliados (os que fazem o saldo não bater), sem_cnpj, ou por_termo (busca por valor/documento/descrição/nome).',
    input_schema: { type: 'object', properties: { filtro: { type: 'string', enum: ['nao_conciliados', 'sem_cnpj', 'por_termo'] }, termo: { type: 'string' }, conta: { type: 'string', description: '(opcional) nome da conta bancária' } }, required: ['filtro'] },
  },
  { name: 'saldo_contas', description: 'Saldo atual (somado) das contas bancárias da empresa.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'listagem',
    description: 'Títulos a RECEBER ou a PAGAR por período e status (contas a receber/pagar, inadimplência, fluxo do mês). periodo: hoje|amanha|semana|mes|vencidos|todos. status: aberto|vencido|pago|todos.',
    input_schema: { type: 'object', properties: { tipo: { type: 'string', enum: ['receber', 'pagar'] }, periodo: { type: 'string', enum: ['hoje', 'amanha', 'semana', 'mes', 'vencidos', 'todos'] }, status: { type: 'string', enum: ['aberto', 'vencido', 'pago', 'todos'] } }, required: ['tipo'] },
  },
] as const

export const NOMES_FERRAMENTAS = new Set<string>(TOOLS_SCHEMA.map((t) => t.name))

// ── Datas relativas resolvidas no SERVIDOR (fuso America/Sao_Paulo) — mesma régua da rota antiga ──
function hojeSP(): Date {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  return new Date(s + 'T00:00:00')
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function resolvePeriodo(periodo?: string): { de: string; ate: string } {
  const h = hojeSP()
  switch ((periodo || 'todos').toLowerCase()) {
    case 'hoje': return { de: iso(h), ate: iso(h) }
    case 'amanha': return { de: iso(addDias(h, 1)), ate: iso(addDias(h, 1)) }
    case 'semana': return { de: iso(h), ate: iso(addDias(h, 7)) }
    case 'mes': { const ini = new Date(h.getFullYear(), h.getMonth(), 1); const fim = new Date(h.getFullYear(), h.getMonth() + 1, 0); return { de: iso(ini), ate: iso(fim) } }
    case 'vencidos': return { de: iso(addDias(h, -730)), ate: iso(h) }
    default: return { de: iso(addDias(h, -365)), ate: iso(addDias(h, 365)) }
  }
}
const STATUS_FILTROS: Record<string, string[]> = { todos: ['todos'], aberto: ['vencidos', 'hoje', 'avencer'], vencido: ['vencidos'], pago: ['pagos', 'conciliado'] }
const str = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * Executa a ferramenta `name` com o company_id FORÇADO. Devolve o JSON cru da RPC (vai ao agente) + um
 * passo em linguagem do usuário (para o streaming). Erros viram {erro} legível — nunca derruba o loop.
 */
export async function executarFerramenta(sb: SupaRpc, companyId: string, name: string, input: Record<string, unknown>): Promise<FerramentaResultado> {
  try {
    if (name === 'consultar_dados') {
      const sql = typeof input.sql === 'string' ? input.sql : ''
      const guard = await validarSqlConsultor(sql)
      if (!guard.ok) return { resultado: { erro: 'consulta inválida (um único SELECT nas views do schema consultor, sem alterar dados)', motivo: guard.motivo }, passo: 'Verificando a consulta…' }
      const { data, error } = await sb.rpc('fn_consultor_sql', { p_company_id: companyId, p_sql: sql })
      if (error) return { resultado: { erro: 'não consegui rodar a consulta', detalhe: String((error as { message?: string })?.message ?? error).slice(0, 200) }, passo: 'Consultando os dados…' }
      return { resultado: data, passo: str(input.objetivo, 80) || 'Cruzando os dados…' }
    }
    if (name === 'situacao_parceiro') {
      const termo = str(input.termo)
      const tipo = ['cliente', 'fornecedor'].includes(String(input.tipo)) ? String(input.tipo) : 'auto'
      if (termo.length < 2) return { resultado: { erro: 'diga o nome ou o CNPJ do cliente/fornecedor' }, passo: 'Procurando o parceiro…' }
      const { data, error } = await sb.rpc('fn_consultor_situacao_parceiro', { p_company_id: companyId, p_termo: termo, p_tipo: tipo })
      if (error) throw error
      return { resultado: data, passo: `Olhando a situação de ${termo}…` }
    }
    if (name === 'raio_x') {
      const { data, error } = await sb.rpc('fn_consultor_raiox', { p_company_id: companyId })
      if (error) throw error
      return { resultado: data, passo: 'Passando o raio-X nos dados…' }
    }
    if (name === 'divergencia_saldo') {
      const { data, error } = await sb.rpc('fn_consultor_divergencia_contas', { p_company_id: companyId })
      if (error) throw error
      const r = data as { contas?: { conta_nome: string; diferenca: number }[] } | null
      // Já traz os lançamentos sem conciliar que explicam cada conta divergente (não pede 2º passo ao agente).
      const divergentes = (r?.contas ?? []).filter((c) => Math.abs(Number(c.diferenca)) > 0.005)
      const linhas: unknown[] = []
      for (const c of divergentes) {
        const d = await sb.rpc('fn_consultor_lancamentos_detalhe', { p_company_id: companyId, p_filtro: 'nao_conciliados', p_termo: null, p_conta: c.conta_nome, p_limite: 50 })
        const dd = d.data as { ok?: boolean; linhas?: unknown[] } | null
        if (dd?.ok && Array.isArray(dd.linhas)) for (const ln of dd.linhas) linhas.push(ln)
      }
      return { resultado: { ...(r as object), lancamentos_sem_conciliar: linhas }, passo: 'Comparando o saldo com o banco…' }
    }
    if (name === 'lancamentos_detalhe') {
      const filtro = ['nao_conciliados', 'sem_cnpj', 'por_termo'].includes(String(input.filtro)) ? String(input.filtro) : 'nao_conciliados'
      const termo = str(input.termo, 100)
      const conta = str(input.conta, 80)
      if (filtro === 'por_termo' && termo.length < 2) return { resultado: { erro: 'diga o valor, documento, descrição ou nome do lançamento' }, passo: 'Procurando o lançamento…' }
      const { data, error } = await sb.rpc('fn_consultor_lancamentos_detalhe', { p_company_id: companyId, p_filtro: filtro, p_termo: termo || null, p_conta: conta || null, p_limite: 50 })
      if (error) throw error
      return { resultado: data, passo: filtro === 'nao_conciliados' ? 'Listando o que está sem conciliar…' : filtro === 'sem_cnpj' ? 'Procurando lançamentos sem CNPJ…' : `Procurando "${termo}"…` }
    }
    if (name === 'saldo_contas') {
      const { data, error } = await sb.rpc('fn_saldo_bancos_dinamico', { p_company_ids: [companyId] })
      if (error) throw error
      return { resultado: { saldo_total: Number(data ?? 0) }, passo: 'Somando o saldo das contas…' }
    }
    if (name === 'listagem') {
      const tipo = String(input.tipo) === 'pagar' ? 'pagar' : 'receber'
      const { de, ate } = resolvePeriodo(typeof input.periodo === 'string' ? input.periodo : 'todos')
      const st = typeof input.status === 'string' && STATUS_FILTROS[input.status.toLowerCase()] ? input.status.toLowerCase() : 'todos'
      const { data, error } = await sb.rpc('fn_ge_listagem_v2', { p_company_id: companyId, p_tipo: tipo, p_data_inicio: de, p_data_fim: ate, p_status_filtro: 'todos', p_status_filtros: STATUS_FILTROS[st] ?? ['todos'] })
      if (error) throw error
      return { resultado: data, passo: `Lendo as contas a ${tipo}…` }
    }
    return { resultado: { erro: 'ferramenta desconhecida' }, passo: '' }
  } catch (e) {
    return { resultado: { erro: 'não consegui buscar esses dados', detalhe: String((e as { message?: string })?.message ?? e).slice(0, 200) }, passo: 'Consultando…' }
  }
}
