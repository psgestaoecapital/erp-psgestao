import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// IA-2.2 Fase 2 · Prévia ILUSTRATIVA gerada (Gemini image). Simulação motivacional, NÃO resultado real.
// Feature 'ia_smile_preview' (visão, OFF por padrão, custo ALTO). Requer consentimento do paciente (LGPD).
// A rota SÓ gera e devolve a imagem (base64) — o cliente aplica a MARCA D'ÁGUA e só salva se o dentista
// escolher "Manter". Degrada honesto: sem chave / feature off / budget / falha de geração → não mostra.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const BUCKET = 'odonto-imagens'
const MODELO = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview'

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const gkey = process.env.GOOGLE_AI_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string; imagem_id?: string; consentimento?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const companyId = body?.company_id
  const imagemId = body?.imagem_id
  if (!companyId || !imagemId) return NextResponse.json({ error: 'company_id e imagem_id obrigatórios' }, { status: 400 })
  if (body?.consentimento !== true) return NextResponse.json({ error: 'consentimento do paciente é obrigatório' }, { status: 400 })
  if (!gkey) return NextResponse.json({ ok: false, indisponivel: true, aviso: 'Geração de imagem indisponível (chave do provedor não configurada). Fale com o suporte.' })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  const { data: img } = await sb.from('erp_odonto_imagem')
    .select('arquivo_path, mime, tipo, ilustrativo').eq('id', imagemId).eq('company_id', companyId).maybeSingle()
  const imagem = img as { arquivo_path: string; mime: string | null; tipo: string | null; ilustrativo: boolean } | null
  if (!imagem) return NextResponse.json({ error: 'imagem não encontrada' }, { status: 404 })
  if (imagem.ilustrativo) return NextResponse.json({ ok: false, aviso: 'Esta imagem já é uma prévia gerada — use a foto original.' })

  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(imagem.arquivo_path, 120)
  const signedUrl = signed?.signedUrl
  if (!signedUrl) return NextResponse.json({ error: 'não foi possível abrir a foto' }, { status: 502 })
  let b64 = '', mediaType = imagem.mime || 'image/jpeg'
  try {
    const r = await fetch(signedUrl)
    if (!r.ok) throw new Error('download')
    mediaType = r.headers.get('content-type') || mediaType
    b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
  } catch { return NextResponse.json({ error: 'falha ao carregar a foto' }, { status: 502 }) }
  if (!mediaType.startsWith('image/')) return NextResponse.json({ ok: false, nao_imagem: true, aviso: 'Abra uma foto do sorriso.' })

  const prompt = `Edite APENAS a região dos dentes/sorriso desta foto para uma SIMULAÇÃO ILUSTRATIVA: dentes mais claros (clareamento suave e natural) e mais alinhados. PRESERVE totalmente a IDENTIDADE e o ROSTO da pessoa — mesmos traços, pele, olhos, formato do rosto, iluminação e enquadramento; não altere nada além dos dentes. Resultado realista e discreto (não exagerar), como uma prévia motivacional. Não adicione texto na imagem.`

  let guarded
  try {
    guarded = await aiGuardedCall<{ b64: string; mime: string }>(sb, {
      origem: 'odonto_smile_preview', custoEstimado: 0.05, companyId, feature: 'ia_smile_preview',
      run: async () => {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${gkey}`
        const res = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: b64 } }, { text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE'] },
          }),
        })
        if (!res.ok) throw new Error(`Gemini ${res.status}`)
        const data = await res.json()
        const parts = data?.candidates?.[0]?.content?.parts ?? []
        const imgPart = parts.find((p: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }) => p.inlineData?.data || p.inline_data?.data)
        const outB64: string = imgPart?.inlineData?.data || imgPart?.inline_data?.data || ''
        const outMime: string = imgPart?.inlineData?.mimeType || imgPart?.inline_data?.mime_type || 'image/png'
        if (!outB64) throw new Error('sem imagem')
        return { result: { b64: outB64, mime: outMime }, custoReal: 0.04 }  // geração de imagem: custo fixo aprox.
      },
    })
  } catch {
    return NextResponse.json({ ok: false, falhou: true, aviso: 'Não foi possível gerar a prévia agora. Tente outra foto (frontal, sorriso visível) ou mais tarde.' })
  }

  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true, aviso: 'A prévia ilustrativa está desativada para esta clínica (ative em Configurações de IA — custo maior).' })
  if (guarded.pausado || !guarded.result) return NextResponse.json({ ok: false, budget_pausado: true, aviso: 'Geração pausada hoje por limite de custo.' })

  return NextResponse.json({ ok: true, imagem_base64: guarded.result.b64, mime: guarded.result.mime })
}
