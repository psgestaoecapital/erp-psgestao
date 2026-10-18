// Canal PS · servidor MCP do ERP (CEO 07/10 16:20) — a Claude de cada sócio conversa com o Code do PRÓPRIO sócio.
// Protocolo MCP (JSON-RPC 2.0) sobre Streamable HTTP, sem estado: cada POST traz uma mensagem (ou um lote) e recebe a
// resposta em JSON. Sem chave de serviço, sem SQL livre: cada ferramenta só chama uma RPC com guarda, COMO O USUÁRIO
// LOGADO (o `rpc` recebido já carrega o token dele). Toda chamada de ferramenta passa pelo registro + limite de uso
// (fn_canal_ps_chamada_iniciar / _concluir). Lógica pura (sem Next, sem rede) — a rota /api/mcp só injeta o `rpc`.

export const PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const SERVIDOR = { name: 'canal-ps', title: 'Canal PS — PS Gestão ERP', version: '1.0.0' }

export type RpcResultado = { data: unknown; error: { message: string } | null }
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResultado>
export type Mensagem = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
export type Resposta =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

type Esquema = { type: 'object'; properties: Record<string, Record<string, unknown>>; required?: string[]; additionalProperties: false }
type Ferramenta = { name: string; title: string; description: string; inputSchema: Esquema; rpc: string; args: (a: Record<string, unknown>) => Record<string, unknown> }

const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^#?\d+$/.test(v.trim()) ? Number(v.trim().replace('#', '')) : null)
const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v.trim()) ? v.trim() : null)
const data = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null)

// SOMENTE estas ferramentas (CEO). Nome → RPC com guarda; os argumentos passam por saneamento de tipo.
export const FERRAMENTAS: Ferramenta[] = [
  {
    name: 'meus_chamados', title: 'Meus chamados',
    description: 'Lista os chamados das empresas da SUA carteira (Administração › Carteira). Filtros opcionais: status ("abertos" ou um status exato), empresa (id), período (desde/até, AAAA-MM-DD).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', description: '"abertos" ou um status exato (nova, em_analise, aceita, em_desenvolvimento, aguardando_confirmacao, concluida…)' },
      empresa_id: { type: 'string', description: 'id da empresa (só da sua carteira)' },
      desde: { type: 'string', description: 'AAAA-MM-DD' }, ate: { type: 'string', description: 'AAAA-MM-DD' },
      limite: { type: 'integer', minimum: 1, maximum: 100 } } },
    rpc: 'fn_canal_meus_chamados',
    args: (a) => ({ p_status: txt(a.status), p_empresa_id: uuid(a.empresa_id), p_desde: data(a.desde), p_ate: data(a.ate), p_limite: int(a.limite) ?? 30 }),
  },
  {
    name: 'ler_chamado', title: 'Ler chamado',
    description: 'Lê um chamado da SUA carteira pelo número: descrição, status, responsável e a conversa com o cliente.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['numero'], properties: { numero: { type: 'integer', description: 'número do chamado' } } },
    rpc: 'fn_canal_ler_chamado',
    args: (a) => ({ p_numero: int(a.numero) }),
  },
  {
    name: 'enviar_tarefa_ao_meu_code', title: 'Enviar tarefa ao meu Code',
    description: 'Manda uma tarefa ao SEU Code (o destino é sempre o Code do seu usuário). Chamado e empresa são opcionais e só da sua carteira. '
      + 'nucleo = true quando mexe em permissão/RLS, fiscal, financeiro de cliente, LGPD, NR-36 ou Wealth: aí espera o OK do CEO antes de ir ao Code. Limite: 30 por hora.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['assunto', 'texto'], properties: {
      assunto: { type: 'string', maxLength: 200 }, texto: { type: 'string', maxLength: 20000 },
      chamado_numero: { type: 'integer' }, empresa_id: { type: 'string' }, nucleo: { type: 'boolean', default: false } } },
    rpc: 'fn_agente_pedido_enviar',
    args: (a) => ({ p_assunto: txt(a.assunto) ?? '', p_corpo: txt(a.texto) ?? '', p_chamado_numero: int(a.chamado_numero),
      p_empresa_id: uuid(a.empresa_id), p_nucleo: a.nucleo === true }),
  },
  {
    name: 'respostas_do_meu_code', title: 'Respostas do meu Code',
    description: 'Os pedidos que você mandou ao seu Code, com status, número da PR e a resposta dele (ENTREGUE / EM TESTE / PRÓXIMO).',
    inputSchema: { type: 'object', additionalProperties: false, properties: { limite: { type: 'integer', minimum: 1, maximum: 100 } } },
    rpc: 'fn_agente_pedidos_meus',
    args: (a) => ({ p_limite: int(a.limite) ?? 30 }),
  },
  {
    name: 'minhas_prs', title: 'Minhas PRs',
    description: 'PRs do seu Code (abertas, prontas, publicadas, fechadas) nos últimos dias.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { dias: { type: 'integer', minimum: 1, maximum: 60, default: 7 } } },
    rpc: 'fn_canal_minhas_prs',
    args: (a) => ({ p_dias: int(a.dias) ?? 7 }),
  },
  {
    name: 'pedir_ok_ceo', title: 'Pedir OK do CEO',
    description: 'Marca um pedido de NÚCLEO seu (que está esperando o OK do CEO) para o CEO ver na aba Codes. Não dá o OK: só o CEO aprova.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['pedido_id'], properties: { pedido_id: { type: 'string', description: 'id do pedido (de respostas_do_meu_code)' } } },
    rpc: 'fn_agente_pedido_pedir_ok_ceo',
    args: (a) => ({ p_mensagem_id: uuid(a.pedido_id) }),
  },
]

const INSTRUCOES = 'Canal PS do ERP PS Gestão. Você age como o sócio logado: só vê os chamados da carteira dele e só manda tarefa '
  + 'ao Code DELE. Pedido que mexe no núcleo (permissão, RLS, fiscal, financeiro de cliente, LGPD, NR-36, Wealth) vai com nucleo = true '
  + 'e espera o OK do CEO. Resposta ao cliente: o Code devolve um rascunho; o envio segue o fluxo dos chamados.'

const erro = (id: Mensagem['id'], code: number, message: string): Resposta => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const ok = (id: Mensagem['id'], result: unknown): Resposta => ({ jsonrpc: '2.0', id: id ?? null, result })
const conteudo = (dados: unknown, isError: boolean) => ({
  content: [{ type: 'text', text: typeof dados === 'string' ? dados : JSON.stringify(dados, null, 2) }],
  ...(dados && typeof dados === 'object' && !Array.isArray(dados) ? { structuredContent: dados } : {}),
  isError,
})

async function chamarFerramenta(id: Mensagem['id'], params: Record<string, unknown>, rpc: Rpc): Promise<Resposta> {
  const nome = typeof params.name === 'string' ? params.name : ''
  const f = FERRAMENTAS.find((x) => x.name === nome)
  // registro + limite ANTES de executar (vale também para ferramenta inexistente: fica no registro)
  const ini = await rpc('fn_canal_ps_chamada_iniciar', { p_ferramenta: nome || '?' })
  const reg = ini.data as { ok?: boolean; id?: number; mensagem?: string; erro?: string } | null
  if (ini.error || !reg?.ok) {
    if (!f) return erro(id, -32602, `Ferramenta desconhecida: ${nome || '(sem nome)'}`)
    return ok(id, conteudo(reg?.mensagem || ini.error?.message || 'Canal PS indisponível agora.', true))
  }
  const concluir = (sucesso: boolean, resultado: string) => rpc('fn_canal_ps_chamada_concluir', { p_id: reg.id, p_ok: sucesso, p_resultado: resultado })
  if (!f) {
    await concluir(false, 'ferramenta_desconhecida')
    return erro(id, -32602, `Ferramenta desconhecida: ${nome || '(sem nome)'}. Use tools/list.`)
  }
  const entrada = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
  const faltando = (f.inputSchema.required ?? []).filter((k) => entrada[k] === undefined || entrada[k] === null || entrada[k] === '')
  if (faltando.length) {
    await concluir(false, 'argumento_faltando')
    return ok(id, conteudo(`Falta: ${faltando.join(', ')}.`, true))
  }
  const r = await rpc(f.rpc, f.args(entrada))
  if (r.error) {
    await concluir(false, 'erro_rpc')
    return ok(id, conteudo(`Não consegui executar ${f.name}: ${r.error.message}`, true))
  }
  const d = r.data as { ok?: boolean; erro?: string } | null
  const sucesso = d?.ok !== false
  await concluir(sucesso, sucesso ? 'ok' : (d?.erro ?? 'recusado'))
  return ok(id, conteudo(d, !sucesso))
}

/** Trata UMA mensagem JSON-RPC. Notificação (sem id) → null (a rota responde 202). */
export async function tratarMensagem(msg: Mensagem, rpc: Rpc): Promise<Resposta | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return erro(msg?.id ?? null, -32600, 'Requisição JSON-RPC inválida')
  }
  const notificacao = msg.id === undefined || msg.id === null
  if (notificacao) return null
  const params = (msg.params ?? {}) as Record<string, unknown>
  switch (msg.method) {
    case 'initialize': {
      const pedido = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const versao = (PROTOCOLOS as readonly string[]).includes(pedido) ? pedido : PROTOCOLOS[0]
      return ok(msg.id, { protocolVersion: versao, capabilities: { tools: { listChanged: false } }, serverInfo: SERVIDOR, instructions: INSTRUCOES })
    }
    case 'ping': return ok(msg.id, {})
    case 'tools/list':
      return ok(msg.id, { tools: FERRAMENTAS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })) })
    case 'tools/call': return chamarFerramenta(msg.id, params, rpc)
    default: return erro(msg.id, -32601, `Método não suportado: ${msg.method}`)
  }
}

/** Corpo do POST: uma mensagem ou um lote. Devolve o que responder (null = 202 sem corpo). */
export async function tratarCorpo(corpo: unknown, rpc: Rpc): Promise<Resposta | Resposta[] | null> {
  if (Array.isArray(corpo)) {
    if (corpo.length === 0) return erro(null, -32600, 'Lote vazio')
    const r: Resposta[] = []
    for (const m of corpo) { const x = await tratarMensagem(m as Mensagem, rpc); if (x) r.push(x) }
    return r.length ? r : null
  }
  return tratarMensagem(corpo as Mensagem, rpc)
}

/** Metadados do recurso protegido (RFC 9728): o servidor de autorização é o Supabase Auth do próprio ERP. */
export function metadadosRecurso(origem: string, supabaseUrl: string) {
  return {
    resource: `${origem}/api/mcp`,
    authorization_servers: [`${supabaseUrl.replace(/\/$/, '')}/auth/v1`],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile'],
    resource_name: SERVIDOR.title,
    resource_documentation: `${origem}/dashboard/dev/codes`,
  }
}
export const caminhoMetadados = '/.well-known/oauth-protected-resource/api/mcp'

/** Resposta HTTP dos metadados (as duas rotas .well-known usam esta). */
export function respostaMetadados(req: Request, supabaseUrl: string): Response {
  const h = req.headers
  const host = h.get('x-forwarded-host') || h.get('host')
  const origem = host ? `${h.get('x-forwarded-proto') || 'https'}://${host}` : new URL(req.url).origin
  return Response.json(metadadosRecurso(origem, supabaseUrl), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' },
  })
}
