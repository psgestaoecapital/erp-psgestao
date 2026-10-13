import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// @Claude no chat interno (V2 do Comunicador). O usuário escreve "@Claude ..." → esta rota monta o
// prompt = pergunta + contexto REAL da empresa (fn_odonto_clinica_contexto_ia) + últimas msgs do canal,
// chama Claude sob aiGuardedCall (feature 'chat_ia', origem 'chat_ia') e POSTA a resposta como mensagem
// is_ia=true → o Realtime entrega ao vivo pra todos no canal. Grounded (RD-51); tenant por company_id.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MODELO = 'claude-haiku-4-5'
type MsgRow = { user_id: string | null; is_ia: boolean; autor: string; texto: string }

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string; canal_id?: string; pergunta?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const companyId = body?.company_id
  const canalId = body?.canal_id
  const pergunta = (body?.pergunta ?? '').replace(/@claude/ig, '').trim()
  if (!companyId || !canalId) return NextResponse.json({ error: 'company_id e canal_id obrigatórios' }, { status: 400 })
  if (pergunta.length < 2) return NextResponse.json({ ok: false, vazio: true })
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  // contexto real da empresa (odonto hoje; generaliza por vertical no futuro)
  const { data: ctxData } = await sb.rpc('fn_odonto_clinica_contexto_ia', { p_company_id: companyId })
  const ctx = ctxData as Record<string, unknown> | null

  // histórico recente do canal (contexto da conversa)
  const { data: hist } = await sb.rpc('fn_chat_mensagens', { p_canal_id: canalId, p_limit: 8, p_before: null })
  const historico = ((hist as MsgRow[] | null) ?? [])
    .filter((m) => (m.texto ?? '').trim())
    .map((m) => ({ role: m.is_ia ? ('assistant' as const) : ('user' as const), content: m.is_ia ? m.texto : `${m.autor}: ${m.texto}` }))

  const system = `Você é o Claude, assistente da equipe DENTRO do chat interno da empresa. Responda em português, curto e direto — é um chat.
REGRAS (obrigatórias):
- Use SOMENTE os números do CONTEXTO abaixo (dados reais desta empresa). Se a pergunta pede algo que NÃO está no contexto, diga claramente "não tenho esse dado aqui" — NUNCA invente números, nomes ou datas.
- Se um indicador está zerado, diga que ainda não há movimento (não é erro).
- Não exponha dados de outra empresa. Seja objetivo (o chat é da equipe toda).

CONTEXTO (dados reais da empresa, JSON):
${JSON.stringify(ctx ?? {})}`

  const messages = [...historico.slice(-6), { role: 'user' as const, content: pergunta }]

  let guarded
  try {
    guarded = await aiGuardedCall<string>(sb, {
      origem: 'chat_ia', custoEstimado: 0.01, companyId, feature: 'chat_ia',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 600, system, messages }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const texto: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000
        return { result: texto, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ ok: false, erro: 'falha' })   // silencioso: não quebra o chat
  }

  // desligada → @Claude fica em silêncio (a clínica optou por desligar). Budget → nota curta.
  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true })
  if (guarded.pausado) {
    await sb.rpc('fn_chat_enviar_ia', { p_canal_id: canalId, p_texto: '🤖 Estou indisponível agora (limite de custo de IA de hoje). Tente novamente amanhã.' })
    return NextResponse.json({ ok: true, budget_pausado: true })
  }
  const resposta = (guarded.result ?? '').trim() || 'Não consegui responder agora.'
  await sb.rpc('fn_chat_enviar_ia', { p_canal_id: canalId, p_texto: resposta })
  return NextResponse.json({ ok: true })
}
