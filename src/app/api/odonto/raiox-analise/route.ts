import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// IA-2.1 · Diagnóstico ASSISTIDO por IA no raio-x (visão). ASSISTIVO, não diagnóstico (Pilar 1/CFO):
// a IA aponta regiões de atenção com CONFIANÇA; o dentista revisa e confirma. Sob toggle+metering
// (feature 'ia_raiox', #918) — visão é mais cara, custoEstimado maior. Cache por imagem (ia_achados).
// LGPD: a imagem vai ao modelo só no processamento; NÃO persistimos prompt nem a imagem em log.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MODELO = 'claude-haiku-4-5'   // visão-capaz (econômico); custo real vem do usage (inclui tokens de imagem)
const BUCKET = 'odonto-imagens'

type Achado = { dente_fdi: string | null; tipo_achado: string; confianca: string; observacao: string }

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string; imagem_id?: string; force?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const companyId = body?.company_id
  const imagemId = body?.imagem_id
  const force = !!body?.force
  if (!companyId || !imagemId) return NextResponse.json({ error: 'company_id e imagem_id obrigatórios' }, { status: 400 })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  // imagem (RLS por empresa) + cache
  const { data: img } = await sb.from('erp_odonto_imagem')
    .select('arquivo_path, mime, tipo, ia_achados, ia_gerado_em').eq('id', imagemId).eq('company_id', companyId).maybeSingle()
  const imagem = img as { arquivo_path: string; mime: string | null; tipo: string | null; ia_achados: Achado[] | null; ia_gerado_em: string | null } | null
  if (!imagem) return NextResponse.json({ error: 'imagem não encontrada' }, { status: 404 })
  if (!force && imagem.ia_achados) return NextResponse.json({ ok: true, cache: true, achados: imagem.ia_achados, gerado_em: imagem.ia_gerado_em })
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

  // baixa a imagem (signed URL curto) e converte p/ base64 — não expõe a imagem ao modelo por URL
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(imagem.arquivo_path, 120)
  const signedUrl = signed?.signedUrl
  if (!signedUrl) return NextResponse.json({ error: 'não foi possível abrir a imagem' }, { status: 502 })
  let b64 = '', mediaType = imagem.mime || 'image/jpeg'
  try {
    const r = await fetch(signedUrl)
    if (!r.ok) throw new Error('download')
    mediaType = r.headers.get('content-type') || mediaType
    b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
  } catch { return NextResponse.json({ error: 'falha ao carregar a imagem' }, { status: 502 }) }
  if (!mediaType.startsWith('image/')) return NextResponse.json({ ok: false, nao_imagem: true, aviso: 'Este arquivo não é uma imagem analisável (ex.: PDF). Abra um raio-x.' })

  const prompt = `Você é um assistente que ajuda um dentista a REVISAR um raio-x odontológico. NÃO é um laudo nem um diagnóstico — você aponta REGIÕES DE ATENÇÃO para o profissional olhar, com um nível de confiança, e ele decide.
REGRAS (obrigatórias):
- Aponte apenas o que a imagem sustenta. NUNCA invente achados. Se a imagem for de baixa qualidade ou inconclusiva, diga isso (inconclusivo=true) e retorne achados vazio.
- Para cada região de atenção, dê: "dente_fdi" (notação FDI, ex.: "26"; use null se não der pra atribuir a um dente), "tipo_achado" (um de: carie, perda_ossea, lesao_periapical, restauracao, outro), "confianca" (baixa|media|alta) e "observacao" (curta, objetiva, sem afirmar diagnóstico).
- Seja conservador: na dúvida, confianca "baixa".
Responda SOMENTE com JSON válido (sem markdown): {"inconclusivo": boolean, "achados": [{"dente_fdi": string|null, "tipo_achado": string, "confianca": string, "observacao": string}]}.`

  let guarded
  try {
    guarded = await aiGuardedCall<{ inconclusivo: boolean; achados: Achado[] }>(sb, {
      origem: 'odonto_raiox', custoEstimado: 0.03, companyId, feature: 'ia_raiox',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 900, messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: prompt },
          ] }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const texto: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000  // usage já inclui tokens de imagem
        const parsed = JSON.parse(texto.replace(/```json|```/g, '').trim()) as { inconclusivo?: boolean; achados?: unknown }
        const TIPOS = ['carie', 'perda_ossea', 'lesao_periapical', 'restauracao', 'outro']
        const CONF = ['baixa', 'media', 'alta']
        const achados: Achado[] = Array.isArray(parsed.achados) ? (parsed.achados as Record<string, unknown>[]).slice(0, 20).map((a) => ({
          dente_fdi: a.dente_fdi ? String(a.dente_fdi).replace(/\D/g, '').slice(0, 2) || null : null,
          tipo_achado: TIPOS.includes(String(a.tipo_achado)) ? String(a.tipo_achado) : 'outro',
          confianca: CONF.includes(String(a.confianca)) ? String(a.confianca) : 'baixa',
          observacao: String(a.observacao ?? '').trim().slice(0, 400),
        })) : []
        return { result: { inconclusivo: !!parsed.inconclusivo, achados }, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ error: 'falha ao analisar a imagem' }, { status: 502 })
  }

  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true, aviso: 'Análise de raio-x por IA está desativada para esta clínica (Configurações de IA).' })
  if (guarded.pausado || !guarded.result) return NextResponse.json({ ok: false, budget_pausado: true, aviso: 'Análise por IA pausada hoje por limite de custo. Avalie o raio-x manualmente.' })

  const out = guarded.result
  // cache (só o resultado derivado — LGPD)
  await sb.rpc('fn_odonto_raiox_cache_salvar', { p_company_id: companyId, p_imagem_id: imagemId, p_achados: out.achados })
  return NextResponse.json({ ok: true, cache: false, inconclusivo: out.inconclusivo, achados: out.achados, gerado_em: new Date().toISOString() })
}
