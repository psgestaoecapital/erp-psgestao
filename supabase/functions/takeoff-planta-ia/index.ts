// Takeoff por IA da planta · Claude visao.
// Recebe { planta_id, company_id, image_base64, media_type, escala_hint }.
// Grava ambientes via fn_takeoff_ambientes_salvar (service role).
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const { planta_id, company_id, image_base64, media_type, escala_hint } = await req.json()
    if (!planta_id || !company_id || !image_base64) {
      return new Response(JSON.stringify({ ok: false, erro: 'planta_id, company_id, image_base64 obrigatorios' }), { status: 400 })
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    await supabase.from('erp_obra_planta').update({ status: 'processando', ia_erro: null }).eq('id', planta_id)

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
            { type: 'image', source: { type: 'base64', media_type: media_type ?? 'image/png', data: image_base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) {
      const erro = `Anthropic ${resp.status}: ${JSON.stringify(data)}`
      await supabase.from('erp_obra_planta').update({ status: 'erro', ia_erro: erro }).eq('id', planta_id)
      return new Response(JSON.stringify({ ok: false, erro }), { status: 500 })
    }
    const txt = (data.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n')
    let json: { escala?: string; ambientes?: unknown[] }
    try { json = JSON.parse(txt.replace(/```json|```/g, '').trim()) } catch (e) {
      const erro = `JSON invalido da IA: ${(e as Error).message} · txt=${txt.slice(0, 300)}`
      await supabase.from('erp_obra_planta').update({ status: 'erro', ia_erro: erro }).eq('id', planta_id)
      return new Response(JSON.stringify({ ok: false, erro }), { status: 500 })
    }

    await supabase.rpc('fn_takeoff_ambientes_salvar', {
      p_company_id: company_id, p_planta_id: planta_id, p_ambientes: json.ambientes ?? [],
    })
    await supabase.from('erp_obra_planta').update({ ia_resumo: json }).eq('id', planta_id)

    return new Response(JSON.stringify({ ok: true, ambientes: json.ambientes ?? [] }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
})
