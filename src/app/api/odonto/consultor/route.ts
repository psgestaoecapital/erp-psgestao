import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// IA-1.2 · Consultor IA da Clínica. O dono pergunta em linguagem natural → a IA responde com os NÚMEROS
// REAIS (fn_odonto_clinica_contexto_ia). Sob guarda de budget (RD-42, origem 'odonto_consultor') e anti-
// alucinação (RD-51: só o que está no contexto; se falta, diz que falta). LGPD: só dados da própria clínica.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODELO = 'claude-haiku-4-5'
type Turno = { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string; pergunta?: string; historico?: Turno[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const companyId = body?.company_id
  const pergunta = (body?.pergunta ?? '').trim()
  if (!companyId || pergunta.length < 2) return NextResponse.json({ error: 'company_id e pergunta obrigatórios' }, { status: 400 })
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  const { data: ctxData, error: ctxErr } = await sb.rpc('fn_odonto_clinica_contexto_ia', { p_company_id: companyId })
  const ctx = ctxData as Record<string, unknown> | null
  if (ctxErr || !ctx || ctx.ok === false) return NextResponse.json({ error: (ctx?.erro as string) || 'sem contexto da clínica' }, { status: 403 })

  const system = `Você é o consultor de gestão de uma clínica odontológica, conversando com o dono/gestor. Responda em português, direto e prático.
REGRAS (obrigatórias):
- Use SOMENTE os números do CONTEXTO abaixo. Se a pergunta pede algo que NÃO está no contexto, diga claramente "não tenho esse dado aqui" — NUNCA invente números, nomes ou datas.
- Cite os números reais quando responder. Quando fizer sentido, termine com uma sugestão de ação curta.
- Se um indicador está zerado, diga que ainda não há movimento (não é erro).

CONTEXTO (dados reais da clínica, JSON):
${JSON.stringify(ctx)}`

  const historico = Array.isArray(body?.historico) ? body!.historico!.slice(-6).filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string') : []
  const messages = [...historico.map((t) => ({ role: t.role, content: t.content })), { role: 'user' as const, content: pergunta }]

  let guarded
  try {
    guarded = await aiGuardedCall<string>(sb, {
      origem: 'odonto_consultor', custoEstimado: 0.02,
      companyId, feature: 'consultor_clinica',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 700, system, messages }),
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
    return NextResponse.json({ error: 'falha ao consultar' }, { status: 502 })
  }

  // clínica DESLIGOU o Consultor (toggle) → degradação honesta (RD-51): NÃO chamou a IA, nenhum gasto.
  if (guarded.desativado) {
    return NextResponse.json({ ok: true, ia_desativada: true, resposta: 'O Consultor IA está desativado para esta clínica. Ligue em Configurações de IA para voltar a usar.' })
  }
  if (guarded.pausado) {
    return NextResponse.json({ ok: true, budget_pausado: true, resposta: 'Consultor pausado hoje por limite de custo. Tente novamente amanhã.' })
  }
  return NextResponse.json({ ok: true, resposta: guarded.result })
}
