import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exigirUsuario, exigirEmpresas } from '@/lib/auth/guardaApi'
import { chamarClaude, modeloPara, IABloqueadaError } from '@/lib/aiModel'
import { TOOLS_SCHEMA, NOMES_FERRAMENTAS, executarFerramenta, type SupaRpc } from '@/lib/consultor/tools'
import { conferirNumeros } from '@/lib/consultor/numberLock'
import { custoUsd, somarUso, totalTokens, type UsoLLM } from '@/lib/consultor/custo'

// Consultor IA — AGENTE que investiga e explica (PR B, SPEC Eng. Chefe · RD-101 · CEO 17/11).
// Diferente do roteador antigo: aqui o LLM recebe FERRAMENTAS (Messages API tools), encadeia várias por
// pergunta (até 12 rodadas), LÊ os dados que elas trazem e redige a explicação. O servidor força o
// company_id em toda ferramenta, mede o custo REAL pelos tokens e confere cada número citado (trava de número).
// Sem ferramenta de escrita: o agente explica e manda o LINK da tela. Teto GLOBAL (US$2/dia) + por empresa (US$1/dia).

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const FEATURE = 'consultor_ia'
const MAX_RODADAS = 12
const TEMPO_LIMITE_MS = 85_000 // folga sob o maxDuration de 90s
const CUSTO_PRE = 0.01 // estimativa p/ o gate global ANTES de rodar (o gasto real é registrado ao fim)

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SYSTEM = [
  'Você é o analista financeiro da empresa {NOME} (CNPJ {CNPJ}). Responda como um consultor experiente explicando ao dono.',
  'Estruture TODA resposta em três partes, nesta ordem e com estes títulos em markdown:',
  '**Resposta** — a resposta direta, em uma ou duas frases.',
  '**Por quê** — o porquê, com as evidências (datas, valores, documentos) que você consultou.',
  '**O que fazer** — o passo prático; quando os dados trouxerem um link de tela, inclua o link.',
  'Investigue ANTES de responder: use as ferramentas e cruze títulos, baixas, extrato, conciliação e histórico quando a pergunta for "por quê". Chame quantas ferramentas precisar.',
  'NUNCA invente número: todo valor em R$ que você citar tem de ter vindo de uma ferramenta nesta conversa. Se os dados não bastarem, diga o que faltou.',
  'Se encontrar um erro do SISTEMA (e não do usuário), diga com clareza que é um erro do sistema e que a equipe PS foi avisada.',
  'Não fale de SQL, tabelas, views ou nomes técnicos. Para ações use as palavras CRIOU/ALTEROU/EXCLUIU, não termos de banco.',
  'Você responde por UMA empresa só — a do topo. Nunca compare com outra empresa.',
].join('\n')

type Mensagem = { role: 'user' | 'assistant'; content: unknown }

// Histórico que o cliente manda (últimas trocas) → mensagens simples de texto.
function historicoParaMensagens(historico: unknown): Mensagem[] {
  if (!Array.isArray(historico)) return []
  return historico
    .slice(-10)
    .filter((m) => m && typeof m === 'object' && (m as { texto?: unknown }).texto)
    .map((m) => {
      const mm = m as { role?: string; texto?: string }
      return { role: mm.role === 'assistant' ? 'assistant' : 'user', content: String(mm.texto).slice(0, 4000) } as Mensagem
    })
}

// Extrai o texto final (blocos text) de um content[] da Messages API.
function textoDaResposta(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.filter((b) => (b as { type?: string })?.type === 'text').map((b) => (b as { text?: string }).text ?? '').join('\n').trim()
}

export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Envie uma pergunta em texto.' }, { status: 400 }) }
  if (body.imagem || body.image || body.anexo || body.anexos || body.arquivo || body.file) {
    return NextResponse.json({ ok: false, error: 'Este assistente responde só a perguntas em texto sobre seus dados — não processa imagens ou anexos.' }, { status: 415 })
  }

  const pergunta = typeof body.pergunta === 'string' ? body.pergunta.trim() : ''
  const companyId = typeof body.company_id === 'string' ? body.company_id : ''
  const sessaoId = typeof body.sessao_id === 'string' ? body.sessao_id.slice(0, 80) : ''
  if (!pergunta) return NextResponse.json({ ok: false, error: 'Escreva uma pergunta.' }, { status: 400 })
  if (pergunta.length > 500) return NextResponse.json({ ok: false, error: 'Pergunta muito longa — resuma em poucas palavras.' }, { status: 400 })
  if (!UUID_RE.test(companyId)) return NextResponse.json({ ok: false, error: 'Selecione uma empresa (um CNPJ) no topo da tela para perguntar.' }, { status: 400 })

  const negado = await exigirEmpresas(u, [companyId])
  if (negado) return negado

  const admin = getAdmin()

  // Gate — teto GLOBAL (US$2/dia) + por empresa (US$1/dia). Bloqueado → mensagem honesta + atalhos grátis.
  try {
    const { data: gate } = await admin.rpc('fn_ia_global_pode_gastar', { p_feature: FEATURE, p_custo_estimado: CUSTO_PRE })
    const g = gate as { pode?: boolean } | null
    if (!g?.pode) return NextResponse.json({ ok: true, bloqueado: true, motivo: 'teto', mensagem: 'O assistente atingiu o limite de custo do sistema por hoje. Use os atalhos abaixo (Raio-X) — eles não têm custo.' })
  } catch {
    return NextResponse.json({ ok: true, bloqueado: true, motivo: 'gate_indisponivel', mensagem: 'Não consegui checar o limite de custo agora. Use os atalhos abaixo (Raio-X) — eles não têm custo.' })
  }

  // Nome/CNPJ para o system (não vai dado sensível; só identifica a empresa ao consultor).
  const { data: emp } = await admin.from('companies').select('razao_social, nome_fantasia, cnpj').eq('id', companyId).maybeSingle()
  const nome = (emp?.nome_fantasia || emp?.razao_social || 'sua empresa') as string
  const cnpj = (emp?.cnpj || '') as string
  const system = [{ type: 'text', text: SYSTEM.replace('{NOME}', nome).replace('{CNPJ}', cnpj), cache_control: { type: 'ephemeral' } }]
  const tools = TOOLS_SCHEMA.map((t, i) => (i === TOOLS_SCHEMA.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : { ...t }))

  const sb = getUsuario(u.token) as unknown as SupaRpc
  const modelo = modeloPara('consultor')

  // Log LGPD (só a pergunta, nunca o resultado).
  admin.from('consultor_ia_pergunta_log').insert({ company_id: companyId, user_id: u.userId || null, pergunta: pergunta.slice(0, 500), tool_escolhida: 'agente', entendeu: true }).then(() => {}, () => {})

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const env = (o: unknown) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(o) + '\n\n'))
      const t0 = Date.now()
      let uso: UsoLLM = {}
      const corpusResultados: unknown[] = [] // tudo que as ferramentas trouxeram — base da trava de número
      const mensagens: Mensagem[] = [...historicoParaMensagens(body.historico), { role: 'user', content: pergunta }]
      let reforcoNumero = false

      try {
        env({ tipo: 'inicio' })
        let textoFinal = ''
        for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
          if (Date.now() - t0 > TEMPO_LIMITE_MS) { textoFinal = textoFinal || 'Demorei demais para investigar essa pergunta. Tente algo mais específico.'; break }

          const resp = await chamarClaude({
            finalidade: 'consultor', endpoint: '/api/consultor-ia', companyId, timeoutMs: 40_000,
            payload: { max_tokens: 1200, system, tools, messages: mensagens },
          })
          uso = somarUso(uso, resp?.usage as UsoLLM)
          const content = resp?.content
          const stop = resp?.stop_reason

          if (stop === 'tool_use' && Array.isArray(content)) {
            // registra a fala do assistente (com os tool_use) e executa cada ferramenta
            mensagens.push({ role: 'assistant', content })
            const usos = content.filter((b) => (b as { type?: string })?.type === 'tool_use') as { id: string; name: string; input: Record<string, unknown> }[]
            const resultados: unknown[] = []
            for (const tu of usos) {
              if (!NOMES_FERRAMENTAS.has(tu.name)) { resultados.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({ erro: 'ferramenta desconhecida' }) }); continue }
              const { resultado, passo } = await executarFerramenta(sb, companyId, tu.name, tu.input || {})
              if (passo) env({ tipo: 'passo', texto: passo })
              corpusResultados.push(resultado)
              resultados.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(resultado).slice(0, 60_000) })
            }
            mensagens.push({ role: 'user', content: resultados })
            continue
          }

          // end_turn (ou outro): resposta final
          textoFinal = textoDaResposta(content)
          // Trava de número: todo R$ citado tem de aparecer nos resultados; senão refaz UMA vez.
          const conf = conferirNumeros(textoFinal, corpusResultados)
          if (!conf.ok && !reforcoNumero) {
            reforcoNumero = true
            mensagens.push({ role: 'assistant', content })
            mensagens.push({ role: 'user', content: `Atenção: estes valores NÃO apareceram nos dados que você consultou: ${conf.naoCasados.join(', ')}. Refaça a resposta usando SOMENTE valores que vieram das ferramentas. Se não tiver o dado, diga que não encontrou — não invente.` })
            continue
          }
          if (!conf.ok) {
            // persistiu: marca os valores suspeitos para a tela avisar "confira este valor"
            env({ tipo: 'aviso_numero', valores: conf.naoCasados })
          }
          break
        }

        if (!textoFinal) textoFinal = 'Não consegui montar a resposta agora. Tente reformular a pergunta ou use um atalho abaixo.'

        // Custo REAL pelos tokens → registra o gasto da empresa (await: serverless pode morrer antes de gravar).
        const custo = custoUsd(modelo, uso)
        try { await admin.rpc('fn_ia_empresa_registrar_gasto', { p_company_id: companyId, p_feature: FEATURE, p_custo_usd: custo, p_chamadas: 1 }) } catch { /* não bloqueia a resposta */ }

        env({ tipo: 'resposta', texto: textoFinal, ver_dados: corpusResultados.slice(0, 20), sessao_id: sessaoId })
        env({ tipo: 'fim', custo_usd: Number(custo.toFixed(6)), tokens: totalTokens(uso) })
      } catch (e) {
        if (e instanceof IABloqueadaError) env({ tipo: 'bloqueado', mensagem: 'O assistente está temporariamente desligado. Use os atalhos abaixo (Raio-X) — eles não têm custo.' })
        else env({ tipo: 'erro', mensagem: 'Não consegui investigar agora. Tente de novo em instantes ou use um atalho abaixo.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } })
}
