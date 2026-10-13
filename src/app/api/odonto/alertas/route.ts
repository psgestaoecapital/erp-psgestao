import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// IA-1.4 · Alertas Pró-ativos (odonto). Núcleo RULE-BASED (grátis, sempre): regenera via
// fn_odonto_alertas_gerar e lê v_alertas_ativos. Camada de IA OPCIONAL (feature 'alertas_proativos',
// togglável+metrificada #918): só PRIORIZA a ordem e escreve um RESUMO agrupado — nunca inventa alerta
// (RD-51). Desligada/budget → devolve os alertas crus (ia_aplicada=false). Nunca fica sem alerta pela IA.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODELO = 'claude-haiku-4-5'
type Alerta = { id: string; tipo: string | null; severidade: string | null; titulo: string; mensagem: string | null; link_acao: string | null; criado_em?: string | null }

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const companyId = body?.company_id
  if (!companyId) return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  // 1) rule-based: regenera (idempotente, custo zero) e lê os ativos da clínica
  await sb.rpc('fn_odonto_alertas_gerar', { p_company_id: companyId })
  const { data: rows } = await sb.from('v_alertas_ativos')
    .select('id, tipo, severidade, titulo, mensagem, link_acao, criado_em').eq('company_id', companyId)
  const alertas = ((rows as Alerta[] | null) ?? []).filter((a) => (a.tipo ?? '').startsWith('odonto_'))

  if (alertas.length === 0) return NextResponse.json({ ok: true, alertas: [], ia_aplicada: false })

  // 2) camada IA OPCIONAL — prioriza + resumo agrupado. Se a feature estiver off/budget → crus.
  if (!apiKey) return NextResponse.json({ ok: true, alertas, ia_aplicada: false })

  const system = `Você é o assistente de gestão de uma clínica odontológica. Recebe uma lista de ALERTAS reais (JSON) já detectados por regras. Sua tarefa é SÓ priorizar e resumir — NUNCA inventar alertas, números ou nomes.
REGRAS (obrigatórias):
- Use SOMENTE os alertas fornecidos. Não crie itens novos nem invente dados.
- "ordem": os ids dos alertas do mais urgente ao menos urgente (considere severidade e impacto no faturamento/retenção). Inclua TODOS os ids recebidos, sem repetir.
- "resumo": 1 a 2 frases em português apontando a prioridade do dia e, quando fizer sentido, uma ação agrupada (ex.: "priorize a reativação dos pacientes sumidos"). Só com base nos alertas.
Responda SOMENTE com JSON válido (sem markdown) com as chaves "ordem" (array de ids) e "resumo" (string).`
  const entrada = JSON.stringify(alertas.map((a) => ({ id: a.id, severidade: a.severidade, titulo: a.titulo, mensagem: a.mensagem })))

  let guarded
  try {
    guarded = await aiGuardedCall<{ ordem: string[]; resumo: string }>(sb, {
      origem: 'odonto_alertas', custoEstimado: 0.003, companyId, feature: 'alertas_proativos',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 500, system, messages: [{ role: 'user', content: entrada }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const texto: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000
        const parsed = JSON.parse(texto.replace(/```json|```/g, '').trim()) as { ordem?: unknown; resumo?: unknown }
        const ordem = Array.isArray(parsed.ordem) ? parsed.ordem.map((x) => String(x)) : []
        return { result: { ordem, resumo: String(parsed.resumo ?? '').trim() }, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ ok: true, alertas, ia_aplicada: false })   // IA falhou → crus (nunca trava)
  }

  if (guarded.desativado || guarded.pausado || !guarded.result) {
    return NextResponse.json({ ok: true, alertas, ia_aplicada: false })
  }

  // aplica a ordem da IA sobre os alertas REAIS (só reordena ids conhecidos; nada inventado)
  const byId = new Map(alertas.map((a) => [a.id, a]))
  const ordenados: Alerta[] = []
  for (const id of guarded.result.ordem) { const a = byId.get(id); if (a) { ordenados.push(a); byId.delete(id) } }
  for (const a of byId.values()) ordenados.push(a)   // qualquer id não citado entra ao fim (não some)
  return NextResponse.json({ ok: true, alertas: ordenados, ia_aplicada: true, resumo: guarded.result.resumo })
}
