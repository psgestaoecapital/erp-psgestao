import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// IA-1.5 · Assist do orçamento (feature 'orcamento_ia', togglável+metrificada #918). NÃO substitui o clínico:
// estima a CHANCE de aceitação e sugere o melhor FORMATO de pagamento, a partir dos números do próprio
// orçamento (valor, parcelas, entrada, forma, saldo em aberto do paciente). É uma estimativa — assim é dita.
// Desligada/budget → o orçamento funciona normal (sem a sugestão). Anti-alucinação: só usa o contexto (RD-51).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MODELO = 'claude-haiku-4-5'

type Ctx = { valor?: number; parcelas?: number; entrada?: number; forma?: string; itens?: number; saldo_aberto?: number }

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string; contexto?: Ctx }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const companyId = body?.company_id
  const ctx = body?.contexto ?? {}
  if (!companyId) return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 })
  if (!ctx.valor || ctx.valor <= 0) return NextResponse.json({ ok: false, sem_dados: true, aviso: 'Monte o orçamento primeiro para estimar a aceitação.' })
  if (!apiKey) return NextResponse.json({ ok: false, ia_indisponivel: true })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  const system = `Você é um consultor comercial de uma clínica odontológica. A partir dos NÚMEROS de um orçamento, estime a probabilidade de o paciente ACEITAR e sugira o melhor formato de pagamento. É uma ESTIMATIVA — não afirme como certeza e não invente dados fora do contexto.
REGRAS:
- "chance": um de "alta", "media", "baixa".
- "motivo": 1 frase curta justificando (valor, parcelamento, entrada, saldo em aberto do paciente).
- "formato_sugerido": sugestão concreta de parcelamento/entrada que aumente a chance (ex.: "oferecer em 6x sem entrada").
- "dica": 1 ação prática curta para fechar (ex.: "reforce o resultado estético e ofereça começar semana que vem").
Responda SOMENTE com JSON válido (sem markdown) com as chaves "chance", "motivo", "formato_sugerido", "dica".`

  let guarded
  try {
    guarded = await aiGuardedCall<{ chance: string; motivo: string; formato_sugerido: string; dica: string }>(sb, {
      origem: 'odonto_orcamento', custoEstimado: 0.004, companyId, feature: 'orcamento_ia',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 400, system, messages: [{ role: 'user', content: JSON.stringify(ctx) }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const texto: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000
        const parsed = JSON.parse(texto.replace(/```json|```/g, '').trim()) as Record<string, string>
        let chance = String(parsed.chance ?? 'media').toLowerCase()
        if (!['alta', 'media', 'baixa'].includes(chance)) chance = 'media'
        return { result: { chance, motivo: String(parsed.motivo ?? '').trim(), formato_sugerido: String(parsed.formato_sugerido ?? '').trim(), dica: String(parsed.dica ?? '').trim() }, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ ok: false, ia_indisponivel: true })
  }

  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true, aviso: 'Assistente de orçamento desativado para esta clínica (Configurações de IA).' })
  if (guarded.pausado || !guarded.result) return NextResponse.json({ ok: false, budget_pausado: true, aviso: 'Estimativa pausada hoje por limite de custo.' })
  return NextResponse.json({ ok: true, ...guarded.result })
}
