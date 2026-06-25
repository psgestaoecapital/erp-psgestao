// Takeoff por IA da planta · Claude visao.
// Recebe { planta_id, company_id, arquivo_path, media_type?, escala_hint? }.
// Baixa a imagem do bucket projetos-plantas (service role) e manda pra IA.
// Grava ambientes via fn_takeoff_ambientes_salvar; status='analisada' no fim.
//
// MUDOU (jun/2026): aceita arquivo_path em vez de image_base64 — payload
// pequeno (so a string do path) evita 'Failed to send a request' quando a
// imagem da 1a pagina do PDF era grande (PNG 2x ~= MBs em base64 no body).
import { createClient } from 'jsr:@supabase/supabase-js@2'

function bytesToBase64(bytes: Uint8Array): string {
  // chunked pra nao estourar argumentos do String.fromCharCode com array grande
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return btoa(bin)
}

function inferirMediaType(path: string, hint?: string): string {
  if (hint && /^image\//.test(hint)) return hint
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

Deno.serve(async (req) => {
  try {
    const body = await req.json()
    const { planta_id, company_id, arquivo_path, media_type, escala_hint } = body as {
      planta_id?: string
      company_id?: string
      arquivo_path?: string
      media_type?: string
      escala_hint?: string | null
    }

    if (!planta_id || !company_id || !arquivo_path) {
      return new Response(JSON.stringify({
        ok: false, erro: 'planta_id, company_id, arquivo_path obrigatorios',
      }), { status: 400, headers: { 'content-type': 'application/json' } })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    await supabase.from('erp_obra_planta').update({
      status: 'processando', ia_erro: null,
    }).eq('id', planta_id)

    // 1) baixa a imagem do bucket
    const dl = await supabase.storage.from('projetos-plantas').download(arquivo_path)
    if (dl.error || !dl.data) {
      const erro = `Falha ao baixar planta: ${dl.error?.message ?? 'sem dados'} (path=${arquivo_path})`
      await supabase.from('erp_obra_planta').update({ status: 'erro', ia_erro: erro }).eq('id', planta_id)
      return new Response(JSON.stringify({ ok: false, erro }), {
        status: 404, headers: { 'content-type': 'application/json' },
      })
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const image_base64 = bytesToBase64(bytes)
    const media = inferirMediaType(arquivo_path, media_type)

    // 2) IA
    const prompt = `Voce e um engenheiro orcamentista. Analise esta planta baixa de construcao civil.
Identifique CADA ambiente (comodo). Para cada um, extraia: nome, largura_m, comprimento_m, area_m2, perimetro_ml e pe_direito_m (se houver).
Use as COTAS e a ESCALA da planta${escala_hint ? ` (escala informada: ${escala_hint})` : ''}. Se nao houver cotas claras, estime e marque confianca:"baixa".
Responda APENAS JSON valido, sem texto fora do JSON:
{"escala":"...","ambientes":[{"nome":"","largura_m":0,"comprimento_m":0,"area_m2":0,"perimetro_ml":0,"pe_direito_m":0,"confianca":"alta|media|baixa"}]}`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: Deno.env.get('ANTHROPIC_VISION_MODEL') ?? 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: image_base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) {
      const erro = `Anthropic ${resp.status}: ${JSON.stringify(data).slice(0, 800)}`
      await supabase.from('erp_obra_planta').update({ status: 'erro', ia_erro: erro }).eq('id', planta_id)
      return new Response(JSON.stringify({ ok: false, erro }), {
        status: 502, headers: { 'content-type': 'application/json' },
      })
    }
    const txt = (data.content ?? [])
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('\n')
    let json: { escala?: string; ambientes?: unknown[] }
    try {
      json = JSON.parse(txt.replace(/```json|```/g, '').trim())
    } catch (e) {
      const erro = `JSON invalido da IA: ${(e as Error).message} · txt=${txt.slice(0, 300)}`
      await supabase.from('erp_obra_planta').update({ status: 'erro', ia_erro: erro }).eq('id', planta_id)
      return new Response(JSON.stringify({ ok: false, erro }), {
        status: 500, headers: { 'content-type': 'application/json' },
      })
    }

    // 3) grava ambientes (RPC ja recalcula area_total_m2 e similares)
    await supabase.rpc('fn_takeoff_ambientes_salvar', {
      p_company_id: company_id, p_planta_id: planta_id, p_ambientes: json.ambientes ?? [],
    })
    await supabase.from('erp_obra_planta').update({
      ia_resumo: json, status: 'analisada', ia_erro: null,
    }).eq('id', planta_id)

    return new Response(JSON.stringify({ ok: true, ambientes: json.ambientes ?? [] }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String(e) }), {
      status: 500, headers: { 'content-type': 'application/json' },
    })
  }
})
