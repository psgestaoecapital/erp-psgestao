// Consultor IA — loop de agente analista (CEO 25/11). O modelo recebe a pergunta + a camada semântica e CONSULTA o
// banco daquela empresa (ferramenta consultar_dados → parser T1 + fn_consultor_sql) quantas vezes precisar, cruza e
// explica. Os dados vão ao modelo MINIMIZADOS (só o que a consulta trouxe). Nada de ferramenta de escrita.
//
// Este módulo é agnóstico de HTTP: a ROTA injeta executarTool (que roda as RPCs com o company_id FORÇADO) e onPasso
// (streaming dos passos em linguagem do usuário). Mede o custo REAL pelos tokens devolvidos pela API.
// Usa a Messages API por fetch (mesmo padrão do src/lib/aiProvider.ts — sem SDK novo).

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
type MsgParam = { role: 'user' | 'assistant'; content: string | unknown[] }

export type Mensagem = { role: 'user' | 'assistant'; content: string }
export type ToolResult = { nome: string; input: Record<string, unknown>; saida: unknown }

export type ResultadoAgente = {
  resposta: string
  toolResults: ToolResult[]
  custoUsd: number
  rounds: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  limiteTempo: boolean
  limiteRodadas: boolean
}

// ── ferramentas expostas ao modelo ───────────────────────────────────────────
export const FERRAMENTAS = [
  {
    name: 'consultar_dados',
    description:
      'Roda um SELECT de leitura sobre a camada semântica da empresa (schema consultor) e devolve as linhas. Use para ' +
      'investigar: cruzar títulos, baixas, extrato, conciliação e histórico. Relações: titulos, baixas, boletos, extrato, ' +
      'conciliacao_vinculos, contas_bancarias, parceiros, categorias, centros_custo, contratos, historico_titulo, ' +
      'dicionario_view. Só SELECT; a empresa já está fixada pelo servidor. Consulte o dicionario_view se tiver dúvida de coluna.',
    input_schema: {
      type: 'object' as const,
      properties: {
        objetivo: { type: 'string', description: 'O que você quer descobrir com esta consulta, em uma frase (vira o passo mostrado ao usuário).' },
        sql: { type: 'string', description: 'O SELECT (PostgreSQL) sobre as relações do schema consultor.' },
      },
      required: ['objetivo', 'sql'],
    },
  },
  { name: 'raio_x', description: 'Raio-X de inconsistências dos dados da empresa (saldo que não bate, boleto sem baixa, cadastro errado).', input_schema: { type: 'object' as const, properties: {}, required: [] } },
  { name: 'divergencia_saldo', description: 'Compara o saldo do SISTEMA com o do BANCO/extrato por conta e mostra a diferença e os lançamentos sem conciliar que a explicam.', input_schema: { type: 'object' as const, properties: {}, required: [] } },
  {
    name: 'lancamentos_detalhe',
    description: 'Lista lançamentos detalhados. filtro: nao_conciliados | sem_cnpj | por_termo. Para por_termo, informe termo (valor, documento, descrição ou nome).',
    input_schema: { type: 'object' as const, properties: { filtro: { type: 'string', enum: ['nao_conciliados', 'sem_cnpj', 'por_termo'] }, termo: { type: 'string' }, conta: { type: 'string' } }, required: ['filtro'] },
  },
  { name: 'saldo_contas', description: 'Saldo atual das contas bancárias da empresa.', input_schema: { type: 'object' as const, properties: {}, required: [] } },
  {
    name: 'listagem',
    description: 'Totais e títulos a receber/pagar por período e status. tipo: receber|pagar. periodo: hoje|amanha|semana|mes|vencidos|todos. status (opcional): aberto|vencido|pago|todos.',
    input_schema: { type: 'object' as const, properties: { tipo: { type: 'string', enum: ['receber', 'pagar'] }, periodo: { type: 'string' }, status: { type: 'string' } }, required: ['tipo'] },
  },
]

// passo em linguagem do usuário a partir da ferramenta
export function passoAmigavel(nome: string, input: Record<string, unknown>): string {
  switch (nome) {
    case 'consultar_dados': return (typeof input.objetivo === 'string' && input.objetivo.trim()) ? input.objetivo.trim() : 'Consultando os dados…'
    case 'raio_x': return 'Fazendo um raio-X dos dados…'
    case 'divergencia_saldo': return 'Comparando o saldo do sistema com o do banco…'
    case 'lancamentos_detalhe': return 'Olhando os lançamentos…'
    case 'saldo_contas': return 'Conferindo o saldo das contas…'
    case 'listagem': return `Levantando as contas a ${input.tipo === 'pagar' ? 'pagar' : 'receber'}…`
    default: return 'Analisando…'
  }
}

// preços por 1M tokens (USD). Fallback conservador p/ modelo desconhecido.
const PRECO: Record<string, { in: number; out: number; cacheW: number; cacheR: number }> = {
  'claude-sonnet': { in: 3, out: 15, cacheW: 3.75, cacheR: 0.3 },
  'claude-opus': { in: 15, out: 75, cacheW: 18.75, cacheR: 1.5 },
  'claude-haiku': { in: 0.8, out: 4, cacheW: 1, cacheR: 0.08 },
}
function precoDe(modelo: string) {
  const m = modelo.toLowerCase()
  if (m.includes('opus')) return PRECO['claude-opus']
  if (m.includes('haiku')) return PRECO['claude-haiku']
  return PRECO['claude-sonnet'] // default/sonnet
}
export function custoUsd(modelo: string, t: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const p = precoDe(modelo)
  return (t.input * p.in + t.output * p.out + t.cacheWrite * p.cacheW + t.cacheRead * p.cacheR) / 1_000_000
}

const SYSTEM_BASE = (nome: string, cnpj: string) => [
  `Você é o analista financeiro da empresa ${nome}${cnpj ? ` (CNPJ ${cnpj})` : ''}.`,
  'Responda como um consultor experiente explicando ao dono do negócio, em português simples:',
  '1) a resposta direta; 2) o PORQUÊ, com as evidências (datas, valores, documentos) que você consultou;',
  '3) O QUE FAZER, com o link da tela quando houver.',
  'Investigue ANTES de responder: quando a pergunta for "por quê", cruze títulos, baixas, extrato, conciliação e histórico.',
  'Use a ferramenta consultar_dados para olhar os dados — quantas vezes precisar. NUNCA invente número: todo valor em R$ que',
  'você citar tem de vir de uma consulta que você fez. Se os dados não bastarem, diga o que faltou.',
  'Se encontrar um erro do SISTEMA (e não do usuário), diga com clareza que é erro do sistema e que a equipe PS foi avisada.',
  'Não fale de SQL, tabelas ou nomes técnicos com o usuário; use CRIOU/ALTEROU/EXCLUIU. Seja objetivo.',
].join(' ')

export type ExecutarTool = (nome: string, input: Record<string, unknown>) => Promise<unknown>

export async function rodarAgente(opts: {
  apiKey: string
  modelo: string
  empresaNome: string
  empresaCnpj: string
  dicionario: string
  pergunta: string
  historico: Mensagem[]
  executarTool: ExecutarTool
  onPasso?: (texto: string) => void
  maxRounds?: number
  prazoMs?: number
}): Promise<ResultadoAgente> {
  const maxRounds = opts.maxRounds ?? 12
  const prazoMs = opts.prazoMs ?? 90_000
  const t0 = Date.now()

  const system: SystemBlock[] = [
    { type: 'text', text: SYSTEM_BASE(opts.empresaNome, opts.empresaCnpj) },
    // dicionário de dados cacheado (prompt caching) — muda pouco
    { type: 'text', text: 'DICIONÁRIO DE DADOS:\n' + opts.dicionario, cache_control: { type: 'ephemeral' } },
  ]

  const messages: MsgParam[] = [
    ...opts.historico.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: opts.pergunta },
  ]

  const toolResults: ToolResult[] = []
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let resposta = ''
  let rounds = 0
  let limiteTempo = false
  let limiteRodadas = false

  for (let i = 0; i < maxRounds; i++) {
    rounds = i + 1
    if (Date.now() - t0 > prazoMs) { limiteTempo = true; break }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: opts.modelo, max_tokens: 1500, system, tools: FERRAMENTAS, messages }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`messages api ${res.status}: ${txt.slice(0, 300)}`)
    }
    const resp = (await res.json()) as { content: AnthropicBlock[]; stop_reason: string; usage?: Record<string, number> }
    const u = resp.usage ?? {}
    tokens.input += u.input_tokens ?? 0
    tokens.output += u.output_tokens ?? 0
    tokens.cacheRead += u.cache_read_input_tokens ?? 0
    tokens.cacheWrite += u.cache_creation_input_tokens ?? 0

    const blocos = Array.isArray(resp.content) ? resp.content : []
    const textos = blocos.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text)
    const usos = blocos.filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use')

    if (resp.stop_reason !== 'tool_use' || usos.length === 0) {
      resposta = textos.join('\n').trim()
      break
    }

    // guarda o turno do assistente (texto + tool_use) e responde cada ferramenta
    messages.push({ role: 'assistant', content: blocos })
    const resultsContent: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const uso of usos) {
      const input = (uso.input ?? {}) as Record<string, unknown>
      opts.onPasso?.(passoAmigavel(uso.name, input))
      let saida: unknown
      try { saida = await opts.executarTool(uso.name, input) }
      catch (e) { saida = { erro: e instanceof Error ? e.message : String(e) } }
      toolResults.push({ nome: uso.name, input, saida })
      resultsContent.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(saida).slice(0, 30_000) })
    }
    messages.push({ role: 'user', content: resultsContent })
    if (i === maxRounds - 1) limiteRodadas = true
  }

  return {
    resposta, toolResults, rounds, tokens, limiteTempo, limiteRodadas,
    custoUsd: custoUsd(opts.modelo, tokens),
  }
}

// ── trava de número (CEO 25/11): todo valor em R$ citado tem de aparecer nos resultados das ferramentas ─────────
// extrai números "contábeis" (com separador de milhar/decimal pt-BR) do texto da resposta
export function numerosDaResposta(texto: string): string[] {
  const achados = new Set<string>()
  // captura R$ 1.234,56 / 1234,56 / 1.234 / 1234.56 etc.
  const re = /(?:R\$\s*)?(\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?|\d+,\d{2}|\d+\.\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) {
    const n = normalizarNumero(m[1])
    if (n !== null && Math.abs(n) >= 0.01) achados.add(n.toFixed(2))
  }
  return [...achados]
}
function normalizarNumero(s: string): number | null {
  let t = s.replace(/\s/g, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')          // pt-BR: 1.234,56 → 1234.56
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '')     // 1.234.567 → 1234567
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
// devolve os valores citados que NÃO aparecem em nenhum resultado de ferramenta (números inventados)
export function numerosInventados(resposta: string, toolResults: ToolResult[]): string[] {
  const blob = JSON.stringify(toolResults)
  // conjunto de números presentes nos resultados (normalizados a 2 casas)
  const presentes = new Set(numerosDaResposta(blob))
  // também aceita match por string crua de dígitos (ex.: 143.52 no JSON)
  const digitos = blob.replace(/[^0-9.,]/g, ' ')
  return numerosDaResposta(resposta).filter((n) => {
    if (presentes.has(n)) return false
    const semZero = n.replace(/\.00$/, '')
    return !digitos.includes(n) && !digitos.includes(semZero) && !digitos.includes(n.replace('.', ','))
  })
}
