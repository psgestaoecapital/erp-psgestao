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

// motivo pelo qual o laço terminou — vai ao log (consultor_ia_pergunta_log.tool_escolhida) p/ auditoria (CEO 26/11).
//  texto      → o modelo encerrou com uma resposta em texto (fluxo normal)
//  max_tokens → a rodada parou por tamanho (stop_reason max_tokens) mas ainda havia texto para mostrar
//  tempo      → estourou o prazo (prazoMs)
//  rodadas    → estourou o teto de rodadas (maxRounds) sem resposta
//  fallback   → a resposta veio vazia e foi composta pela chamada final SEM ferramentas (ou pelo resumo mínimo)
export type MotivoFim = 'texto' | 'max_tokens' | 'tempo' | 'rodadas' | 'fallback'

export type ResultadoAgente = {
  resposta: string
  toolResults: ToolResult[]
  custoUsd: number
  rounds: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  limiteTempo: boolean
  limiteRodadas: boolean
  motivoFim: MotivoFim
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
  {
    name: 'situacao_parceiro',
    description: 'Situação completa de UM cliente ou fornecedor citado pelo nome ou CNPJ: títulos, pagamentos, juros, saldo e diagnósticos do PORQUÊ do saldo (pago com juros, pago a mais, pago sem conciliar, vencido). Atalho forte para "por que o saldo do X...", "o X pagou?", "quanto o X deve?".',
    input_schema: { type: 'object' as const, properties: { termo: { type: 'string', description: 'nome ou CNPJ do cliente/fornecedor' }, tipo: { type: 'string', enum: ['cliente', 'fornecedor', 'auto'] } }, required: ['termo'] },
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
    case 'situacao_parceiro': return `Levantando a situação de ${typeof input.termo === 'string' ? input.termo : 'um parceiro'}…`
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

// teto de geração por rodada. CEO 26/11: era 1500 — uma resposta "resposta/porquê/o que fazer" com evidências estourava
// e o stop_reason voltava 'max_tokens' no meio de um tool_use, deixando a resposta vazia. 4000 cobre a redação completa.
const MAX_TOKENS = 4000

export type RespostaApi = { content: AnthropicBlock[]; stop_reason: string; usage?: Record<string, number> }

// mensagem de erro LEGÍVEL ao modelo (CEO 26/11, item 3): timeout do Postgres vira texto acionável, nunca o SQLSTATE cru.
export function erroLegivel(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (/statement timeout|canceling statement|too long|57014|tempo|timeout/.test(m)) return 'a consulta demorou demais; tente de outro jeito (menos linhas, um período menor ou outra ferramenta)'
  return msg || 'não foi possível concluir esta consulta; tente de outro jeito'
}

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
  // injetável só no teste: substitui a chamada real à Messages API (o gate de CI não gasta crédito).
  chamarApi?: (body: Record<string, unknown>) => Promise<RespostaApi>
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

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const acumularTokens = (u: Record<string, number> = {}) => {
    tokens.input += u.input_tokens ?? 0
    tokens.output += u.output_tokens ?? 0
    tokens.cacheRead += u.cache_read_input_tokens ?? 0
    tokens.cacheWrite += u.cache_creation_input_tokens ?? 0
  }
  const chamar = opts.chamarApi ?? (async (body: Record<string, unknown>) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`messages api ${res.status}: ${txt.slice(0, 300)}`)
    }
    return (await res.json()) as RespostaApi
  })

  const toolResults: ToolResult[] = []
  let resposta = ''
  let rounds = 0
  let limiteTempo = false
  let limiteRodadas = false
  let fim: MotivoFim = 'texto'   // motivo do encerramento do laço (antes do guard do item 1)
  let encerrou = false

  for (let i = 0; i < maxRounds; i++) {
    rounds = i + 1
    if (Date.now() - t0 > prazoMs) { limiteTempo = true; fim = 'tempo'; encerrou = true; break }

    const resp = await chamar({ model: opts.modelo, max_tokens: MAX_TOKENS, system, tools: FERRAMENTAS, messages })
    acumularTokens(resp.usage)

    const blocos = Array.isArray(resp.content) ? resp.content : []
    const textos = blocos.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text)
    const usos = blocos.filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use')
    const textoRodada = textos.join('\n').trim()

    // Só continua o laço quando o modelo DE FATO pediu ferramenta (stop_reason tool_use). CEO 26/11, item 2: um
    // stop_reason 'max_tokens' — mesmo com tool_use incompleto no meio — encerra a rodada e cai no guard do item 1.
    if (resp.stop_reason === 'tool_use' && usos.length > 0) {
      messages.push({ role: 'assistant', content: blocos })
      const resultsContent: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
      for (const uso of usos) {
        const input = (uso.input ?? {}) as Record<string, unknown>
        opts.onPasso?.(passoAmigavel(uso.name, input))
        let saida: unknown
        // item 3: ferramenta que falha/estoura NÃO derruba o laço — vira {erro} legível e segue (o modelo tenta outro jeito).
        try { saida = await opts.executarTool(uso.name, input) }
        catch (e) { saida = { erro: erroLegivel(e instanceof Error ? e.message : String(e)) } }
        toolResults.push({ nome: uso.name, input, saida })
        resultsContent.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(saida).slice(0, 30_000) })
      }
      messages.push({ role: 'user', content: resultsContent })
      if (i === maxRounds - 1) { limiteRodadas = true; fim = 'rodadas' }
      continue
    }

    // encerramento (end_turn, max_tokens sem tool_use válido, stop_sequence…): fica com o texto que veio nesta rodada.
    resposta = textoRodada
    fim = resp.stop_reason === 'max_tokens' ? 'max_tokens' : 'texto'
    encerrou = true
    break
  }
  if (!encerrou && !limiteTempo) { limiteRodadas = true; fim = 'rodadas' }

  // ── item 1: NUNCA terminar vazio ────────────────────────────────────────────────────────────────────────────
  let motivoFim: MotivoFim = fim
  if (!resposta.trim()) {
    // UMA chamada final SEM ferramentas, com o histórico + tudo o que já foi consultado, pedindo a redação agora.
    opts.onPasso?.('Fechando a resposta com o que já foi consultado…')
    const instrucao = 'Responda agora ao usuário com o que já foi consultado, no formato: resposta direta / por quê / o que fazer. '
      + 'Use SOMENTE valores que apareceram nas consultas acima. Não peça mais nada: redija a melhor resposta possível com o que há.'
    try {
      const resp = await chamar({ model: opts.modelo, max_tokens: MAX_TOKENS, system, messages: anexarInstrucaoFinal(messages, instrucao) })
      acumularTokens(resp.usage)
      const txt = (Array.isArray(resp.content) ? resp.content : [])
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('\n').trim()
      resposta = txt
    } catch { /* se a chamada final falhar, cai no resumo mínimo abaixo */ }
    // se AINDA vier vazio, monta uma resposta mínima a partir dos toolResults (divergência por conta + link).
    if (!resposta.trim()) resposta = respostaMinima(toolResults)
    motivoFim = 'fallback'
  }

  return {
    resposta, toolResults, rounds, tokens, limiteTempo, limiteRodadas, motivoFim,
    custoUsd: custoUsd(opts.modelo, tokens),
  }
}

// acrescenta a instrução final SEM criar dois turnos 'user' seguidos (a API exige alternância): se o último turno já é
// do usuário (ex.: tool_result), anexa a instrução a ele; senão, abre um novo turno de usuário.
function anexarInstrucaoFinal(messages: MsgParam[], instrucao: string): MsgParam[] {
  const copia: MsgParam[] = messages.map((m) => ({ role: m.role, content: m.content }))
  const ultimo = copia[copia.length - 1]
  if (ultimo && ultimo.role === 'user') {
    if (typeof ultimo.content === 'string') ultimo.content = ultimo.content + '\n\n' + instrucao
    else if (Array.isArray(ultimo.content)) ultimo.content = [...ultimo.content, { type: 'text', text: instrucao }]
    else copia.push({ role: 'user', content: instrucao })
  } else {
    copia.push({ role: 'user', content: instrucao })
  }
  return copia
}

// ── resumo mínimo (último recurso do item 1) ───────────────────────────────────────────────────────────────────
// Com toolResults em mãos mas sem redação do modelo, monta uma resposta honesta: o que foi consultado e para onde ir.
// Destaca a divergência por conta quando a ferramenta divergencia_saldo trouxe dados (caso Pdois: SICREDI/Caixa).
export function respostaMinima(toolResults: ToolResult[]): string {
  if (!toolResults.length) {
    return 'Não consegui concluir a análise agora. Tente reformular a pergunta ou use o Raio-X (atalho grátis) aqui embaixo — ele não tem custo.'
  }
  const linhas: string[] = []
  const brlN = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))) ? brl(Number(v)) : null

  // divergência de saldo: tenta render por conta (nomes de campo tolerantes a variações do backend)
  const div = toolResults.find((t) => t.nome === 'divergencia_saldo')
  const contas = div ? extrairLinhas(div.saida) : []
  if (contas.length) {
    linhas.push('Resposta direta: a conta não bate com o banco por diferenças ainda não conciliadas. Pelo que consultei:')
    for (const c of contas.slice(0, 8)) {
      const nome = (c.conta ?? c.nome ?? c.banco ?? c.descricao ?? 'conta') as string
      const sis = brlN(c.saldo_sistema ?? c.sistema ?? c.saldo)
      const bco = brlN(c.saldo_banco ?? c.banco_saldo ?? c.extrato)
      const dif = brlN(c.diferenca ?? c.divergencia ?? c.diff)
      const partes = [sis && `sistema ${sis}`, bco && `banco ${bco}`, dif && `diferença ${dif}`].filter(Boolean)
      linhas.push(`• ${nome}${partes.length ? ': ' + partes.join(' × ') : ''}`)
    }
    linhas.push('O que fazer: abra a Conciliação bancária e concilie os lançamentos que estão sem par — é o que fecha a diferença.')
    return linhas.join('\n')
  }

  // genérico: lista o que foi consultado
  linhas.push('Reuni os dados abaixo, mas não consegui redigir a conclusão completa. Veja o que foi consultado:')
  for (const t of toolResults.slice(-6)) {
    const obj = typeof t.input.objetivo === 'string' && t.input.objetivo.trim() ? t.input.objetivo.trim() : passoAmigavel(t.nome, t.input)
    const erro = (t.saida && typeof t.saida === 'object' && 'erro' in (t.saida as Record<string, unknown>)) ? String((t.saida as Record<string, unknown>).erro) : null
    linhas.push(`• ${obj}${erro ? ` — ${erro}` : ''}`)
  }
  linhas.push('O que fazer: tente reformular a pergunta ou use um dos atalhos grátis aqui embaixo.')
  return linhas.join('\n')
}

// extrai um array de linhas-objeto de uma saída de ferramenta, tolerando os formatos { dados: [...] } | [...] | {...}.
function extrairLinhas(saida: unknown): Record<string, unknown>[] {
  const raiz = (saida && typeof saida === 'object' && 'dados' in (saida as Record<string, unknown>))
    ? (saida as { dados: unknown }).dados : saida
  if (Array.isArray(raiz)) return raiz.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
  if (raiz && typeof raiz === 'object') {
    // formato { contas: [...] } ou similar
    for (const v of Object.values(raiz as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every((x) => x && typeof x === 'object')) return v as Record<string, unknown>[]
    }
  }
  return []
}

// ── teto de custo (CEO 25/11): dado o resultado das RPCs fn_ia_empresa/global_pode_gastar, decide o bloqueio ──────
// Bloqueia quando a empresa OU o sistema bateram o teto; devolve a mensagem HONESTA + aponta os atalhos grátis.
export function avaliarTeto(okEmpresa: boolean | undefined, okGlobal: boolean | undefined): { mensagem: string } | null {
  if (okEmpresa && okGlobal) return null
  return {
    mensagem: !okEmpresa
      ? 'Esta empresa atingiu o limite diário do assistente. Use os atalhos abaixo (Raio-X) — eles não têm custo.'
      : 'O assistente atingiu o limite diário do sistema. Use os atalhos abaixo — não têm custo.',
  }
}

// formata R$ pt-BR (usado na mensagem de revisão da trava de número)
function brl(v: number): string { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

// ── orquestração com a TRAVA DE NÚMERO (CEO 25/11) ──────────────────────────────────────────────────────────────
// Roda o agente; se citar valor em R$ que NÃO veio de nenhuma consulta, REFAZ uma vez pedindo correção; persistindo,
// devolve os valores em `inventados` (a tela mostra o aviso "confira estes valores"). `rodar` é injetável (a rota passa
// a chamada real à Messages API; o gate de CI passa um mock) — por isso esta função é testável sem rede.
export async function analisarComTrava(opts: {
  rodar: (p: { pergunta: string; historico: Mensagem[]; maxRounds?: number }) => Promise<ResultadoAgente>
  pergunta: string
  historico: Mensagem[]
  onPasso?: (texto: string) => void
}): Promise<{
  resposta: string; toolResults: ToolResult[]; custoUsd: number; inventados: string[]
  rounds: number; limiteTempo: boolean; limiteRodadas: boolean; refez: boolean; motivoFim: MotivoFim
}> {
  const r = await opts.rodar({ pergunta: opts.pergunta, historico: opts.historico })
  let resposta = r.resposta
  let toolResults = r.toolResults
  let custoUsd = r.custoUsd
  let motivoFim = r.motivoFim
  let inventados = numerosInventados(resposta, toolResults)
  let refez = false

  if (inventados.length > 0) {
    refez = true
    opts.onPasso?.('Conferindo os números citados…')
    const r2 = await opts.rodar({
      historico: [...opts.historico, { role: 'user', content: opts.pergunta }, { role: 'assistant', content: resposta }],
      pergunta:
        `Revise sua resposta anterior. Estes valores citados NÃO apareceram em nenhuma consulta: ${inventados.map((n) => brl(Number(n))).join(', ')}. ` +
        `Refaça as consultas necessárias e reescreva a resposta usando SOMENTE valores que vierem dos dados. Se não conseguir confirmar um valor, não o cite.`,
      maxRounds: 6,
    })
    if (r2.resposta) { resposta = r2.resposta; motivoFim = r2.motivoFim }
    toolResults = [...toolResults, ...r2.toolResults]
    custoUsd += r2.custoUsd
    inventados = numerosInventados(resposta, toolResults)
  }

  return {
    resposta, toolResults, custoUsd, inventados, refez, motivoFim,
    rounds: r.rounds, limiteTempo: r.limiteTempo, limiteRodadas: r.limiteRodadas,
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
