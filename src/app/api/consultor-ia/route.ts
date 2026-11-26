import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exigirUsuario, exigirEmpresas } from '@/lib/auth/guardaApi'
import { modeloPara, assertIAPermitida, IABloqueadaError, registrarFalhaIA } from '@/lib/aiModel'
import { rodarAgente, avaliarTeto, analisarComTrava, type Mensagem, type ToolResult } from '@/lib/consultor/agente'
import { fazerExecutarTool } from '@/lib/consultor/tools'

// Consultor IA — AGENTE ANALISTA (CEO 25/11, RD-101). O modelo consulta o banco DAQUELA empresa (ferramenta
// consultar_dados → parser T1 + fn_consultor_sql, empresa fixada) quantas vezes precisar, cruza e explica.
// Dados minimizados vão ao modelo. Teto por empresa (US$1/dia) e global (US$2/dia · fn_ia_*_pode_gastar).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

const FEATURE = 'consultor_ia'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const brl = (v: number) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Credenciais Supabase não configuradas')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
function getUsuario(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function sse(obj: unknown) { return `data: ${JSON.stringify(obj)}\n\n` }

export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Envie uma pergunta em texto.' }, { status: 400 }) }
  if (body.imagem || body.image || body.anexo || body.anexos || body.arquivo || body.file) {
    return NextResponse.json({ ok: false, error: 'Este assistente responde só a perguntas em texto sobre seus dados.' }, { status: 415 })
  }
  const pergunta = typeof body.pergunta === 'string' ? body.pergunta.trim() : ''
  const companyId = typeof body.company_id === 'string' ? body.company_id : ''
  const perguntaId = typeof body.pergunta_id === 'string' ? body.pergunta_id : null
  const historico: Mensagem[] = Array.isArray(body.historico)
    ? (body.historico as unknown[]).filter((m): m is Mensagem => !!m && typeof (m as Mensagem).content === 'string'
        && ((m as Mensagem).role === 'user' || (m as Mensagem).role === 'assistant')).slice(-10)
    : []
  if (!pergunta) return NextResponse.json({ ok: false, error: 'Escreva uma pergunta.' }, { status: 400 })
  if (pergunta.length > 500) return NextResponse.json({ ok: false, error: 'Pergunta muito longa — resuma em poucas palavras.' }, { status: 400 })
  if (!UUID_RE.test(companyId)) return NextResponse.json({ ok: false, error: 'Selecione uma empresa (um CNPJ) no topo da tela.' }, { status: 400 })
  const negado = await exigirEmpresas(u, [companyId])
  if (negado) return negado

  const admin = getAdmin()
  // custo estimado conservador p/ os gates (o custo REAL é medido depois e registrado)
  const CUSTO_ESTIMADO = 0.03
  // Teto por empresa (US$1/dia) E global (US$2/dia). Bloqueado → cai nos atalhos grátis.
  try {
    const [{ data: ge }, { data: gg }] = await Promise.all([
      // conserto 26/11: o teto POR EMPRESA confere o acesso (get_user_company_ids/is_admin) e precisa da sessão do
      // USUÁRIO — chamado com a service_role, auth.uid() é nulo e a função devolvia "sem acesso" (pode=false), o que
      // aparecia como "Esta empresa atingiu o limite diário" para TODO mundo. O teto global segue pela service_role.
      getUsuario(u.token).rpc('fn_ia_empresa_pode_gastar', { p_company_id: companyId, p_feature: FEATURE, p_custo_estimado: CUSTO_ESTIMADO }),
      admin.rpc('fn_ia_global_pode_gastar', { p_feature: FEATURE, p_custo_estimado: CUSTO_ESTIMADO }),
    ])
    // CEO 26/11: empresa de demonstração não gasta crédito de IA — mensagem própria (não é "limite atingido").
    if ((ge as { motivo?: string } | null)?.motivo === 'empresa_demo') {
      return NextResponse.json({ ok: true, bloqueado: true, mensagem: 'Na empresa de demonstração o assistente com IA fica desligado (sem custo). Use os atalhos abaixo (Raio-X) — eles funcionam normalmente.' })
    }
    const okE = (ge as { pode?: boolean } | null)?.pode, okG = (gg as { pode?: boolean } | null)?.pode
    const teto = avaliarTeto(okE, okG)
    if (teto) return NextResponse.json({ ok: true, bloqueado: true, mensagem: teto.mensagem })
  } catch {
    return NextResponse.json({ ok: true, bloqueado: true, mensagem: 'Não consegui checar o limite de custo agora. Use os atalhos abaixo — não têm custo.' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  try { await assertIAPermitida({ feature: FEATURE }) }
  catch (e) {
    if (e instanceof IABloqueadaError) return NextResponse.json({ ok: true, bloqueado: true, mensagem: 'O assistente está temporariamente desligado. Use os atalhos abaixo — não têm custo.' })
  }
  if (!apiKey) return NextResponse.json({ ok: true, bloqueado: true, mensagem: 'O assistente não está configurado no momento. Use os atalhos abaixo.' })

  const modelo = modeloPara('consultor')
  // empresa (nome/cnpj) e dicionário (metadados) p/ o system prompt
  const [{ data: emp }, { data: dic }] = await Promise.all([
    admin.from('companies').select('razao_social, nome_fantasia, cnpj').eq('id', companyId).single(),
    admin.rpc('fn_consultor_dicionario'),
  ])
  const empresaNome = (emp as { nome_fantasia?: string; razao_social?: string } | null)?.nome_fantasia
    || (emp as { razao_social?: string } | null)?.razao_social || 'sua empresa'
  const empresaCnpj = (emp as { cnpj?: string } | null)?.cnpj || ''
  const dicionario = Array.isArray(dic)
    ? (dic as { relacao: string; coluna: string; descricao: string }[]).map((d) => `- ${d.relacao}.${d.coluna}: ${d.descricao}`).join('\n')
    : ''

  const sb = getUsuario(u.token)
  // adaptador explícito: isola o executor do tipo exato do client do Supabase (só precisamos de rpc → { data, error }).
  const executarTool = fazerExecutarTool({ rpc: (fn, params) => sb.rpc(fn, params ?? {}) }, companyId, perguntaId)

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const push = (o: unknown) => controller.enqueue(enc.encode(sse(o)))
      try {
        // trava de número embutida: roda o agente e, se citar valor fora das consultas, refaz UMA vez e avisa.
        const r = await analisarComTrava({
          pergunta, historico,
          onPasso: (texto) => push({ tipo: 'passo', texto }),
          rodar: (p) => rodarAgente({
            apiKey, modelo, empresaNome, empresaCnpj, dicionario, executarTool,
            pergunta: p.pergunta, historico: p.historico, maxRounds: p.maxRounds,
            onPasso: (texto) => push({ tipo: 'passo', texto }),
          }),
        })
        const resposta = r.resposta
        const toolResults: ToolResult[] = r.toolResults
        const custo = r.custoUsd
        const inventados = r.inventados
        const motivoFim = r.motivoFim

        // registra o custo REAL
        admin.rpc('fn_ia_empresa_registrar_gasto', { p_company_id: companyId, p_feature: FEATURE, p_custo_usd: Number(custo.toFixed(6)), p_chamadas: 1 }).then(() => {}, () => {})
        // log LGPD da pergunta (só a pergunta + se respondeu; nunca o resultado) — preserva a auditoria do roteador anterior.
        // CEO 26/11, item 4: grava o MOTIVO DO FIM (texto|max_tokens|tempo|rodadas|fallback) em tool_escolhida; `entendeu`
        // passa a medir se o modelo redigiu de fato — como a resposta nunca mais é vazia (item 1), o sinal é o motivo != fallback.
        admin.from('consultor_ia_pergunta_log').insert({ company_id: companyId, user_id: u.userId || null, pergunta: pergunta.slice(0, 500), tool_escolhida: 'agente/' + motivoFim, entendeu: motivoFim !== 'fallback' }).then(() => {}, () => {})

        // erro do sistema detectado pelo agente → fila do Eng. Chefe (erp_contexto_projeto)
        if (/erro do (próprio )?sistema|problema do sistema|equipe PS foi avisad/i.test(resposta)) {
          admin.rpc('fn_consultor_ia_registrar_bug', { p_company_id: companyId,
            p_titulo: 'Consultor IA: ' + pergunta.slice(0, 120),
            p_descricao: `Pergunta: ${pergunta}\n\nResposta do agente:\n${resposta.slice(0, 4000)}`,
            p_refs: { pergunta_id: perguntaId } }).then(() => {}, () => {})
        }

        push({
          tipo: 'resposta', resposta, custo_usd: Number(custo.toFixed(4)), rounds: r.rounds,
          numeros_a_conferir: inventados.map((n) => brl(Number(n))),
          limite: r.limiteTempo ? 'tempo' : r.limiteRodadas ? 'rodadas' : null,
          // "Ver os dados": o que embasou a resposta (tabelas recolhidas na tela)
          dados: toolResults.map((t) => ({ ferramenta: t.nome, objetivo: typeof t.input.objetivo === 'string' ? t.input.objetivo : undefined, resultado: t.saida })),
        })
      } catch (e) {
        await registrarFalhaIA({ endpoint: 'consultor-ia', finalidade: 'consultor', modelo, status: null, erro: e instanceof Error ? e.message : String(e), companyId }).catch(() => {})
        push({ tipo: 'erro', mensagem: 'Não consegui concluir a análise agora. Tente de novo ou use um atalho abaixo.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' } })
}
