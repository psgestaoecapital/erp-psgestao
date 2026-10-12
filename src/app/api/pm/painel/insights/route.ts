import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// Painel de Jobs · "Insights com IA" (PM-K). Recebe só o RESUMO agregado do painel (números e nomes de cliente/peça;
// pessoas viram "Pessoa N" na tela, nada de dado pessoal sai). A IA só comenta — não grava nada. Custo só quando
// a pessoa clica (RD-42), dentro do teto de IA da empresa (aiGuardedCall).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MODELO = 'claude-haiku-4-5'

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })

  let body: { companyId?: string; resumo?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, erro: 'bad json' }, { status: 400 }) }
  const companyId = body?.companyId
  const resumo = JSON.stringify(body?.resumo ?? null)
  if (!companyId || resumo === 'null' || resumo.length > 8000) return NextResponse.json({ ok: false, erro: 'companyId e resumo obrigatórios' }, { status: 400 })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  // a RLS decide: quem não enxerga a empresa não passa
  const { data: acesso, error } = await sb.from('agency_jobs').select('id').eq('company_id', companyId).limit(1)
  if (error || !acesso) return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
  if (!apiKey) return NextResponse.json({ ok: false, erro: 'IA não configurada' }, { status: 500 })

  const prompt = `Você é analista de operação de uma agência de comunicação. Abaixo, o resumo do Painel de Jobs (já filtrado pela pessoa).
Escreva de 3 a 5 observações curtas em português, cada uma com o número que a sustenta e uma ação sugerida. Foque em atraso, alterações (retrabalho), motivos de alteração, estouro de horas e concentração de trabalho. Não invente números que não estão no resumo. Se o resumo tiver poucos dados, diga isso.
Resumo: ${resumo}
Responda SOMENTE com JSON (sem markdown): {"insights":[{"titulo":string,"detalhe":string}]}`

  let guarded
  try {
    guarded = await aiGuardedCall<{ insights: { titulo: string; detalhe: string }[] }>(sb, {
      origem: 'pm_painel_insights', custoEstimado: 0.01, companyId, feature: 'ia_painel_insights',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000
        const bruto = JSON.parse(String(data?.content?.[0]?.text ?? '{}').replace(/```json|```/g, '').trim()) as { insights?: { titulo?: unknown; detalhe?: unknown }[] }
        const insights = (Array.isArray(bruto.insights) ? bruto.insights : []).slice(0, 5)
          .map((i) => ({ titulo: String(i.titulo ?? '').slice(0, 120), detalhe: String(i.detalhe ?? '').slice(0, 400) })).filter((i) => i.titulo)
        return { result: { insights }, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ ok: false, erro: 'Não consegui gerar os insights agora. Tente de novo em instantes.' }, { status: 502 })
  }
  if (guarded.desativado) return NextResponse.json({ ok: false, aviso: 'Os insights com IA estão desativados para esta empresa.' })
  if (guarded.pausado || !guarded.result) return NextResponse.json({ ok: false, aviso: 'Insights pausados hoje pelo limite de custo de IA.' })
  return NextResponse.json({ ok: true, insights: guarded.result.insights })
}
