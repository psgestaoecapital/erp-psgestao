import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall, type GuardaResultado } from '@/lib/ai/aiGuardedCall'

// IA-1.1 · Resumo Inteligente do Paciente. Fluxo (RD-42/RD-51/LGPD):
// 1) CACHE: se há resumo fresco (<24h) e sem force → devolve cacheado (custo zero, não chama o modelo).
// 2) CONTEXTO: fn_odonto_paciente_contexto_ia agrega os dados (read-only, RLS por auth.uid()).
// 3) GENERATE: Claude Haiku (econômico) devolve JSON {resumo,risco,motivo,sugestao}. 4) salva o cache.
// LGPD: os dados clínicos vão só no processamento; NÃO persistimos o prompt — só o resumo derivado.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODELO = 'claude-haiku-4-5'   // RD-42: modelo econômico p/ resumo curto
const FRESCO_MS = 24 * 60 * 60 * 1000
const ANTI_SPAM_MS = 20 * 1000

type Resumo = { resumo: string; risco: string; motivo: string; sugestao: string; modelo?: string; gerado_em?: string }

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string; paciente_id?: string; force?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const companyId = body?.company_id
  const pacienteId = body?.paciente_id
  const force = !!body?.force
  if (!companyId || !pacienteId) return NextResponse.json({ error: 'company_id e paciente_id obrigatórios' }, { status: 400 })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  // 1) cache
  const { data: cacheRow } = await sb.from('erp_odonto_paciente_resumo_ia')
    .select('resumo, risco, motivo, sugestao, modelo, gerado_em').eq('paciente_id', pacienteId).maybeSingle()
  const cache = cacheRow as Resumo | null
  const idadeMs = cache?.gerado_em ? Date.now() - new Date(cache.gerado_em).getTime() : Infinity
  if (cache && (!force ? idadeMs < FRESCO_MS : idadeMs < ANTI_SPAM_MS)) {
    return NextResponse.json({ ok: true, cache: true, ...cache })
  }

  // 2) contexto (read-only, RLS)
  const { data: ctxData, error: ctxErr } = await sb.rpc('fn_odonto_paciente_contexto_ia', { p_company_id: companyId, p_paciente_id: pacienteId })
  const ctx = ctxData as Record<string, unknown> | null
  if (ctxErr || !ctx || ctx.ok === false) {
    if (cache) return NextResponse.json({ ok: true, cache: true, aviso: 'contexto indisponível — mostrando último resumo', ...cache })
    return NextResponse.json({ error: (ctx?.erro as string) || 'sem contexto' }, { status: 403 })
  }

  // sem dados clínicos mínimos → estado honesto (não gasta o modelo)
  const semDados = !ctx.plano && !(ctx.agenda as { ultima_consulta?: string })?.ultima_consulta &&
    !ctx.ultima_evolucao && (!(ctx.alertas as unknown[])?.length) && !ctx.alergias
  if (semDados) return NextResponse.json({ ok: true, vazio: true, resumo: '', risco: null })

  if (!apiKey) {
    if (cache) return NextResponse.json({ ok: true, cache: true, aviso: 'IA indisponível — último resumo', ...cache })
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })
  }

  // 3) gerar
  const prompt = `Você é o assistente clínico de uma clínica odontológica. A partir do CONTEXTO (JSON) de um paciente, escreva um resumo objetivo para o dentista bater o olho e entender o paciente em segundos.

CONTEXTO:
${JSON.stringify(ctx)}

Responda SOMENTE com um JSON válido (sem markdown, sem texto fora do JSON) com as chaves:
- "resumo": 2 a 3 frases em português, com idade/sexo, alertas de saúde relevantes, plano e progresso, situação financeira (saldo em aberto), última consulta e faltas. Não invente dados que não estão no contexto.
- "risco": um de "baixo", "medio", "alto" — risco de EVASÃO/abandono do tratamento (considere faltas, tempo desde a última consulta, saldo em aberto, progresso parado).
- "motivo": frase curta justificando o risco.
- "sugestao": uma ação concreta e curta (ex.: "WhatsApp de reativação + oferecer reagendamento").`

  // chamada SOB GUARDA DE BUDGET (RD-42): pergunta se pode gastar → chama Haiku → registra o gasto real.
  const CUSTO_ESTIMADO = 0.008   // Haiku: ~1,5k tok in + ~0,3k tok out
  let guarded: GuardaResultado<Resumo>
  try {
    guarded = await aiGuardedCall<Resumo>(sb, {
      origem: 'odonto_resumo', custoEstimado: CUSTO_ESTIMADO,
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const modelText: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000  // Haiku 4.5 $/Mtok
        const jsonStr = modelText.replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(jsonStr) as Partial<Resumo>
        const out: Resumo = { resumo: String(parsed.resumo ?? '').trim(), risco: String(parsed.risco ?? 'baixo').toLowerCase(), motivo: String(parsed.motivo ?? '').trim(), sugestao: String(parsed.sugestao ?? '').trim() }
        if (!['baixo', 'medio', 'alto'].includes(out.risco)) out.risco = 'baixo'
        return { result: out, custoReal }
      },
    })
  } catch {
    if (cache) return NextResponse.json({ ok: true, cache: true, aviso: 'IA indisponível — último resumo', ...cache })
    return NextResponse.json({ error: 'falha ao gerar o resumo' }, { status: 502 })
  }

  // budget estourado → degradação honesta (RD-51): NÃO chamou a IA, nenhum gasto novo. Mostra o cache.
  if (guarded.pausado) {
    if (cache) return NextResponse.json({ ok: true, cache: true, budget_pausado: true, aviso: 'Resumo pausado hoje (limite de custo). Mostrando a última versão.', ...cache })
    return NextResponse.json({ ok: true, budget_pausado: true, resumo: '', risco: null, aviso: 'Resumo indisponível hoje por limite de custo.' })
  }
  const out = guarded.result as Resumo

  // 4) salvar cache (só o resumo derivado — LGPD)
  await sb.rpc('fn_odonto_resumo_ia_salvar', { p_company_id: companyId, p_paciente_id: pacienteId, p_dados: { ...out, modelo: MODELO } })
  return NextResponse.json({ ok: true, cache: false, gerado_em: new Date().toISOString(), modelo: MODELO, ...out })
}
