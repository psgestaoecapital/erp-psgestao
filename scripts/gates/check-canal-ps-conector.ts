// Gate (CEO 07/10 16:20) — Canal PS · PR B: conector MCP do ERP (/api/mcp) para a Claude de cada sócio. Sem rede.
//  (1) segurança da rota: só com o token OAuth do PRÓPRIO usuário (sem login → 401 com os metadados RFC 9728), cliente
//      Supabase com o token dele + chave pública; nada de chave de serviço, nada de SQL/tabela direta — só RPC;
//  (2) SOMENTE as 6 ferramentas do CEO, cada uma numa RPC com guarda;
//  (3) o tratador MCP REAL contra um `rpc` simulado: initialize, tools/list, ferramenta inexistente recusada (e registrada),
//      enviar_tarefa → fn_agente_pedido_enviar sem destino, recusa do banco vira isError, limite de uso, notificação;
//  (4) migration: registro + limite por usuário, chamados só da carteira, sem e-mail de quem abriu, pedir_ok_ceo não dá OK;
//  (5) tela: consentimento OAuth, "Conectar a minha Claude" e "Esperando OK do CEO" na aba Codes.
import { readFileSync, existsSync } from 'node:fs'
import { FERRAMENTAS, metadadosRecurso, tratarCorpo, type Rpc } from '../../src/lib/canalPs/mcp'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ler = (p: string) => readFileSync(p, 'utf8')

async function main() {
  // ── (1) rota ────────────────────────────────────────────────────────────────────────────────────────────────────
  const rota = ler('src/app/api/mcp/route.ts')
  const lib = ler('src/lib/canalPs/mcp.ts')
  ok(/Bearer\\s\+\(\.\+\)/.test(rota) && /auth\.getUser\(token\)/.test(rota) && /return semLogin\(req/.test(rota), 'rota: exige o token do usuário e confere no Supabase Auth')
  ok(/'WWW-Authenticate': `Bearer realm="canal-ps", resource_metadata="\$\{origemDe\(req\)\}\$\{caminhoMetadados\}"`/.test(rota) && /status: 401/.test(rota), 'sem login → 401 com resource_metadata')
  ok(/global: \{ headers: \{ Authorization: `Bearer \$\{token\}` \} \}/.test(rota) && /NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(rota), 'RPCs COMO o usuário (token dele + chave pública)')
  ok(!/SERVICE_ROLE|service_role/i.test(rota + lib) && !/\.from\(|\.sql\(|\bquery\(/.test(rota + lib), 'sem chave de serviço e sem SQL/tabela direta — só RPC')
  ok(/export const GET = naoSuportado/.test(rota) && /export async function POST/.test(rota), 'Streamable HTTP sem estado: POST; GET/DELETE 405')
  for (const p of ['src/app/.well-known/oauth-protected-resource/route.ts', 'src/app/.well-known/oauth-protected-resource/api/mcp/route.ts'])
    ok(existsSync(p) && /respostaMetadados\(req, process\.env\.NEXT_PUBLIC_SUPABASE_URL/.test(ler(p)), `metadados RFC 9728 em ${p.replace('src/app', '')}`)
  const meta = metadadosRecurso('https://erp.exemplo', 'https://abc.supabase.co/')
  ok(meta.resource === 'https://erp.exemplo/api/mcp' && meta.authorization_servers[0] === 'https://abc.supabase.co/auth/v1', 'servidor de autorização = Supabase Auth do ERP')

  // rota de verdade, sem login (nenhuma rede: recusa antes de falar com o Supabase)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://gate.invalid'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chave-publica-gate'
  const { POST, GET } = await import('../../src/app/api/mcp/route')
  const r401 = await POST(new Request('https://erp.exemplo/api/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }))
  ok(r401.status === 401 && /resource_metadata="https:\/\/erp\.exemplo\/\.well-known\/oauth-protected-resource\/api\/mcp"/.test(r401.headers.get('www-authenticate') ?? ''),
    'chamada sem login → 401 (recusada) com o endereço dos metadados')
  ok(GET().status === 405, 'GET → 405')

  // ── (2) ferramentas ─────────────────────────────────────────────────────────────────────────────────────────────
  const esperado: Record<string, string> = {
    meus_chamados: 'fn_canal_meus_chamados', ler_chamado: 'fn_canal_ler_chamado', enviar_tarefa_ao_meu_code: 'fn_agente_pedido_enviar',
    respostas_do_meu_code: 'fn_agente_pedidos_meus', minhas_prs: 'fn_canal_minhas_prs', pedir_ok_ceo: 'fn_agente_pedido_pedir_ok_ceo',
  }
  ok(FERRAMENTAS.length === 6 && FERRAMENTAS.every((f) => esperado[f.name] === f.rpc), 'SOMENTE as 6 ferramentas do CEO, cada uma na sua RPC com guarda')

  // ── (3) tratador real × rpc simulado ────────────────────────────────────────────────────────────────────────────
  type Chamada = { fn: string; args: Record<string, unknown> }
  const chamadas: Chamada[] = []
  let limite = false
  let resposta: unknown = { ok: true, id: 'm1', agente: 'rodrigo-code' }
  const rpc: Rpc = async (fn, args) => {
    chamadas.push({ fn, args })
    if (fn === 'fn_canal_ps_chamada_iniciar') return { data: limite ? { ok: false, erro: 'limite_uso', mensagem: 'Limite do Canal PS' } : { ok: true, id: 7 }, error: null }
    if (fn === 'fn_canal_ps_chamada_concluir') return { data: { ok: true }, error: null }
    return { data: resposta, error: null }
  }
  type R = { result?: { protocolVersion?: string; tools?: { name: string }[]; isError?: boolean; content?: { text: string }[] }; error?: { code: number; message: string } }
  const enviar = async (m: Record<string, unknown>) => (await tratarCorpo({ jsonrpc: '2.0', id: 1, ...m }, rpc)) as R

  const ini = await enviar({ method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude' } } })
  ok(ini.result?.protocolVersion === '2025-06-18', 'initialize negocia a versão do protocolo')
  ok((await tratarCorpo({ jsonrpc: '2.0', method: 'notifications/initialized' }, rpc)) === null, 'notificação → sem corpo (202)')
  const lista = await enviar({ method: 'tools/list' })
  ok(lista.result?.tools?.map((t) => t.name).sort().join(',') === Object.keys(esperado).sort().join(','), 'tools/list lista só as 6')

  chamadas.length = 0
  const inex = await enviar({ method: 'tools/call', params: { name: 'apagar_tudo', arguments: {} } })
  ok(inex.error?.code === -32602 && /Ferramenta desconhecida: apagar_tudo/.test(inex.error.message), 'ferramenta inexistente → recusada (-32602)')
  ok(chamadas.map((c) => c.fn).join(',') === 'fn_canal_ps_chamada_iniciar,fn_canal_ps_chamada_concluir' && chamadas[1].args.p_resultado === 'ferramenta_desconhecida',
    'ferramenta inexistente fica registrada e nenhuma RPC de dado é chamada')

  chamadas.length = 0
  const env = await enviar({ method: 'tools/call', params: { name: 'enviar_tarefa_ao_meu_code', arguments: { assunto: 'Corrigir', texto: 'faça X', chamado_numero: '#501', nucleo: true, para: 'jordana-code' } } })
  const c = chamadas.find((x) => x.fn === 'fn_agente_pedido_enviar')
  ok(env.result?.isError === false && !!c && c.args.p_assunto === 'Corrigir' && c.args.p_chamado_numero === 501 && c.args.p_nucleo === true
    && !('p_para' in c.args) && !('para' in c.args), 'enviar_tarefa → fn_agente_pedido_enviar, sem destino (o "para" do cliente é ignorado)')
  ok(chamadas[0].fn === 'fn_canal_ps_chamada_iniciar' && chamadas.at(-1)?.fn === 'fn_canal_ps_chamada_concluir' && chamadas.at(-1)?.args.p_ok === true,
    'cada chamada: registro antes, conclusão depois (usuário, ferramenta, quando, resultado)')

  chamadas.length = 0; resposta = { ok: false, erro: 'fora_da_carteira', mensagem: 'não está na sua carteira' }
  const rec = await enviar({ method: 'tools/call', params: { name: 'ler_chamado', arguments: { numero: 502 } } })
  ok(rec.result?.isError === true && /fora_da_carteira/.test(rec.result.content?.[0].text ?? '') && chamadas.at(-1)?.args.p_resultado === 'fora_da_carteira',
    'recusa do banco (fora da carteira) volta como isError e fica registrada')

  chamadas.length = 0
  const falta = await enviar({ method: 'tools/call', params: { name: 'ler_chamado', arguments: {} } })
  ok(falta.result?.isError === true && !chamadas.some((x) => x.fn === 'fn_canal_ler_chamado'), 'argumento obrigatório faltando → recusa sem chamar a RPC')

  chamadas.length = 0; limite = true
  const lim = await enviar({ method: 'tools/call', params: { name: 'meus_chamados', arguments: {} } })
  ok(lim.result?.isError === true && chamadas.length === 1, 'limite de uso estourado → recusa sem executar')
  limite = false
  ok(((await enviar({ method: 'resources/list' })) as R).error?.code === -32601, 'método fora do escopo → -32601')

  // ── (4) migration ───────────────────────────────────────────────────────────────────────────────────────────────
  const sql = ler('supabase/migrations/20261010010060_canal_ps_conector.sql').replace(/--[^\n]*/g, '')
  ok(/ALTER TABLE public\.erp_canal_ps_chamada ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE ALL ON TABLE public\.erp_canal_ps_chamada FROM PUBLIC, anon, authenticated/.test(sql)
    && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*erp_canal_ps_chamada TO (anon|authenticated)/.test(sql), 'registro: RLS, grava só pelas RPCs')
  ok(/v_min >= 20 OR v_hora >= 200/.test(sql) && /pg_advisory_xact_lock/.test(sql), 'limite de uso por usuário (20/min, 200/h), sem corrida')
  ok(/WHERE id = p_id AND user_id = auth\.uid\(\) AND concluido_em IS NULL/.test(sql), 'só conclui a própria chamada')
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  ok(fns.length === 6 && fns.every((f) => new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(sql)), `as ${fns.length} funções revogadas do anon`)
  ok(/JOIN erp_carteira_responsavel k ON k\.company_id = s\.company_id AND k\.responsavel_id = v_uid AND k\.vigencia_fim IS NULL/.test(sql)
    && /fn__carteira_usuario_pode\(v_uid, s\.company_id\)/.test(sql), 'meus_chamados e ler_chamado: só da carteira (mesma fonte dos chamados em equipe)')
  const lerCh = sql.slice(sql.indexOf('FUNCTION public.fn_canal_ler_chamado('), sql.indexOf('FUNCTION public.fn_canal_minhas_prs('))
  ok(!/user_email|autor_email|telefone|cpf/.test(lerCh), 'ler_chamado não devolve e-mail/telefone de quem abriu (LGPD)')
  const pok = sql.slice(sql.indexOf('FUNCTION public.fn_agente_pedido_pedir_ok_ceo('))
  ok(/d\.user_id = v_uid/.test(pok) && /SET ok_ceo_pedido_em/.test(pok) && !/ok_ceo_em\s*=/.test(pok), 'pedir_ok_ceo: só pedido do próprio sócio; marca para o CEO, não dá o OK')

  // ── (5) telas ───────────────────────────────────────────────────────────────────────────────────────────────────
  const cons = ler('src/app/oauth/consent/page.tsx')
  ok(/getAuthorizationDetails\(authId\)/.test(cons) && /approveAuthorization\(id\)/.test(cons) && /denyAuthorization\(id\)/.test(cons), 'consentimento OAuth: o sócio permite ou nega com o próprio login')
  const painel = ler('src/components/dev/PainelCodes.tsx')
  ok(/<ConectarClaude \/>/.test(painel) && /<EsperandoOkCeo \/>/.test(painel), 'aba Codes: "Conectar a minha Claude" e "Esperando OK do CEO"')
  ok(/Adicionar conector personalizado/.test(ler('src/components/dev/CanalPs.tsx')) && /\/api\/mcp/.test(ler('src/components/dev/CanalPs.tsx')), 'passo a passo com a URL do conector')
  ok(/\/api\/mcp/.test(ler('AGENTS.md')) && /OAuth Server/.test(ler('AGENTS.md')), 'AGENTS.md: conector e configuração do OAuth')

  if (falhas) { console.error(`\ncheck-canal-ps-conector: ${falhas} falha(s)`); process.exit(1) }
  console.log('\nCanal PS (conector MCP): ok')
}

main().catch((e) => { console.error(e); process.exit(1) })
