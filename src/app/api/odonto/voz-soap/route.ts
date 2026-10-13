import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// IA-1.3 · Voz → Prontuário SOAP. O dentista DITA (transcrição é client-side, Web Speech API, grátis) e
// esta rota só ESTRUTURA o texto bruto em SOAP (Subjetivo/Objetivo/Avaliação/Plano) + dentes citados.
// Sob toggle+metering por clínica (feature 'voz_soap') e budget global via aiGuardedCall v2 (#918).
// Anti-alucinação (RD-51): estrutura só o que foi dito; ambíguo → fica no Subjetivo marcado "[revisar]".
// LGPD: NÃO persistimos o prompt — a evolução (derivada) é salva pela ficha via fn_odonto_prontuario_salvar.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODELO = 'claude-haiku-4-5'
type Soap = { s: string; o: string; a: string; p: string }

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string; texto_bruto?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const companyId = body?.company_id
  const bruto = (body?.texto_bruto ?? '').trim()
  if (!companyId) return NextResponse.json({ error: 'company_id obrigatório' }, { status: 400 })
  // texto curto → não chama o modelo (custo zero): o dentista edita/digita o bruto (RD-51)
  if (bruto.length < 12) return NextResponse.json({ ok: false, curto: true, aviso: 'Fale um pouco mais para estruturar — ou digite direto nos campos.' })
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  const system = `Você organiza a fala de um dentista (transcrição bruta de um atendimento odontológico) em uma evolução clínica no formato SOAP. Responda em português.
REGRAS (obrigatórias):
- Use SOMENTE o que foi dito na transcrição. NÃO invente sintomas, dentes, procedimentos, medicações ou datas.
- Distribua o conteúdo em: S (Subjetivo: queixa/relato do paciente), O (Objetivo: exame/achados/procedimentos realizados), A (Avaliação: diagnóstico/hipótese), P (Plano: conduta/próximos passos).
- Se algo for ambíguo ou não couber claramente, deixe no Subjetivo e marque com "[revisar]". Se um campo não tiver conteúdo, devolva string vazia.
- Identifique dentes citados na notação FDI quando o dentista mencionar (ex.: "26", "dente 11"). Só os que foram ditos.
- Mantenha os termos clínicos do próprio dentista; não parafraseie a ponto de mudar o sentido.
Responda SOMENTE com um JSON válido (sem markdown) com as chaves: "s", "o", "a", "p" (strings) e "dentes" (array de strings FDI, pode ser vazio).`

  let guarded
  try {
    guarded = await aiGuardedCall<{ soap: Soap; dentes: string[] }>(sb, {
      origem: 'odonto_voz_soap', custoEstimado: 0.004, companyId, feature: 'voz_soap',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 700, system, messages: [{ role: 'user', content: bruto }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const texto: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000
        const jsonStr = texto.replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(jsonStr) as Partial<Soap> & { dentes?: unknown }
        const soap: Soap = {
          s: String(parsed.s ?? '').trim(), o: String(parsed.o ?? '').trim(),
          a: String(parsed.a ?? '').trim(), p: String(parsed.p ?? '').trim(),
        }
        const dentes = Array.isArray(parsed.dentes) ? parsed.dentes.map((d) => String(d).trim()).filter(Boolean).slice(0, 32) : []
        return { result: { soap, dentes }, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ error: 'falha ao estruturar' }, { status: 502 })
  }

  // feature desligada na clínica → honesto: não estruturou, o dentista digita normal (nunca trava)
  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true, aviso: 'Voz → prontuário está desativado para esta clínica (Configurações de IA). Você pode digitar a evolução normalmente.' })
  // budget global estourado → sem chamada nova; devolve o bruto pra editar/digitar
  if (guarded.pausado) return NextResponse.json({ ok: false, budget_pausado: true, aviso: 'Estruturação por IA pausada hoje por limite de custo. O texto ficou aqui para você editar e salvar.' })

  const out = guarded.result!
  return NextResponse.json({ ok: true, soap: out.soap, dentes: out.dentes })
}
