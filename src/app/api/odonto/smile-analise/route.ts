import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// IA-2.2 · Smile Design (Fase 1: análise estética + plano sugerido). ILUSTRATIVO, não promessa (Pilar 1):
// a IA analisa a foto do sorriso e SUGERE oportunidades/procedimentos; o dentista valida e decide preços.
// Visão opt-in (feature 'ia_smile', OFF por padrão · #924) + metering (origem 'odonto_smile'). Cache por
// foto (reusa a coluna ia_achados / fn_odonto_raiox_cache_salvar — genérica). LGPD: foto só no processamento.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MODELO = 'claude-haiku-4-5'
const BUCKET = 'odonto-imagens'

type PlanoItem = { procedimento: string; dentes: string[]; obs: string; confianca: string }
type Analise = { cor: string; alinhamento: string; formato: string; gengiva: string }
type Resultado = { inconclusivo: boolean; analise: Analise; oportunidades: string[]; plano_sugerido: PlanoItem[] }

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

  const { data: img } = await sb.from('erp_odonto_imagem')
    .select('arquivo_path, mime, tipo, ia_achados, ia_gerado_em').eq('id', imagemId).eq('company_id', companyId).maybeSingle()
  const imagem = img as { arquivo_path: string; mime: string | null; tipo: string | null; ia_achados: Resultado | null; ia_gerado_em: string | null } | null
  if (!imagem) return NextResponse.json({ error: 'imagem não encontrada' }, { status: 404 })
  if (!force && imagem.ia_achados) return NextResponse.json({ ok: true, cache: true, ...imagem.ia_achados, gerado_em: imagem.ia_gerado_em })
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

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
  if (!mediaType.startsWith('image/')) return NextResponse.json({ ok: false, nao_imagem: true, aviso: 'Este arquivo não é uma imagem. Abra uma foto do sorriso.' })

  const prompt = `Você ajuda um dentista a fazer uma ANÁLISE ESTÉTICA do sorriso a partir de uma foto, e a montar um PLANO SUGERIDO. NÃO é promessa de resultado nem laudo — são sugestões que o dentista valida.
REGRAS (obrigatórias):
- Baseie-se SÓ no que a foto mostra. Se não houver um sorriso/rosto claro, retorne inconclusivo=true e listas vazias. NUNCA invente.
- "analise": objeto com "cor" (impressão da cor/escala, ex.: "amarelada, ~A3"), "alinhamento" (ex.: "leve apinhamento ântero-inferior"), "formato" (proporção/forma dos dentes), "gengiva" (ex.: "sorriso gengival leve"). Frases curtas, sem afirmar diagnóstico.
- "oportunidades": lista curta de melhorias estéticas possíveis (linguagem de sugestão).
- "plano_sugerido": lista de {"procedimento" (ex.: "Clareamento", "Faceta em resina", "Alinhamento ortodôntico", "Gengivoplastia"), "dentes" (array FDI quando aplicável, senão []), "obs" (curta), "confianca" (baixa|media|alta)}. NÃO sugira preços.
Responda SOMENTE com JSON válido (sem markdown): {"inconclusivo": boolean, "analise": {"cor": string, "alinhamento": string, "formato": string, "gengiva": string}, "oportunidades": [string], "plano_sugerido": [{"procedimento": string, "dentes": [string], "obs": string, "confianca": string}]}.`

  let guarded
  try {
    guarded = await aiGuardedCall<Resultado>(sb, {
      origem: 'odonto_smile', custoEstimado: 0.03, companyId, feature: 'ia_smile',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 1000, messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: prompt },
          ] }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const texto: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000
        const p = JSON.parse(texto.replace(/```json|```/g, '').trim()) as Record<string, unknown>
        const CONF = ['baixa', 'media', 'alta']
        const a = (p.analise ?? {}) as Record<string, unknown>
        const plano: PlanoItem[] = Array.isArray(p.plano_sugerido) ? (p.plano_sugerido as Record<string, unknown>[]).slice(0, 12).map((x) => ({
          procedimento: String(x.procedimento ?? '').trim().slice(0, 120),
          dentes: Array.isArray(x.dentes) ? x.dentes.map((d) => String(d).replace(/\D/g, '').slice(0, 2)).filter(Boolean).slice(0, 16) : [],
          obs: String(x.obs ?? '').trim().slice(0, 300),
          confianca: CONF.includes(String(x.confianca)) ? String(x.confianca) : 'baixa',
        })).filter((x) => x.procedimento) : []
        const out: Resultado = {
          inconclusivo: !!p.inconclusivo,
          analise: { cor: String(a.cor ?? '').trim(), alinhamento: String(a.alinhamento ?? '').trim(), formato: String(a.formato ?? '').trim(), gengiva: String(a.gengiva ?? '').trim() },
          oportunidades: Array.isArray(p.oportunidades) ? (p.oportunidades as unknown[]).map((o) => String(o).trim()).filter(Boolean).slice(0, 12) : [],
          plano_sugerido: plano,
        }
        return { result: out, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ error: 'falha ao analisar a foto' }, { status: 502 })
  }

  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true, aviso: 'Análise de sorriso por IA está desativada para esta clínica (ative em Configurações de IA).' })
  if (guarded.pausado || !guarded.result) return NextResponse.json({ ok: false, budget_pausado: true, aviso: 'Análise por IA pausada hoje por limite de custo.' })

  const out = guarded.result
  await sb.rpc('fn_odonto_raiox_cache_salvar', { p_company_id: companyId, p_imagem_id: imagemId, p_achados: out })
  return NextResponse.json({ ok: true, cache: false, ...out, gerado_em: new Date().toISOString() })
}
