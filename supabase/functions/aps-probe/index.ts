// APS Probe (one-shot / descartavel) — resolve o gate da F2b:
// A APS Model Derivative expoe geometria vetorial nas properties de
// objetos de layer A_B_Paredes H3, ou so metadados (name/layer)?
// Salva o resultado em erp_obra_planta.aps_diagnostico.probe.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const APS_BASE = 'https://developer.api.autodesk.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' }

async function getApsToken(id: string, secret: string): Promise<string> {
  const basic = btoa(`${id}:${secret}`)
  const r = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=data:read data:write bucket:read',
  })
  if (!r.ok) throw new Error(`oauth_${r.status}: ${(await r.text()).slice(0, 300)}`)
  return ((await r.json()) as { access_token: string }).access_token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json().catch(() => ({}))
    const plantaId: string | undefined = body?.planta_id
    const alvoLayer: string = body?.layer ?? 'A_B_Paredes H3'
    const maxAmostras: number = Math.min(5, Number(body?.max ?? 5))
    if (!plantaId) {
      return new Response(JSON.stringify({ ok: false, erro: 'planta_id obrigatorio' }),
        { status: 400, headers: JSON_HEADERS })
    }

    // 1) le planta
    const { data: planta } = await supabase.from('erp_obra_planta')
      .select('id, aps_urn, aps_diagnostico')
      .eq('id', plantaId).maybeSingle()
    if (!planta?.aps_urn) {
      return new Response(JSON.stringify({ ok: false, erro: 'planta_sem_urn' }),
        { status: 412, headers: JSON_HEADERS })
    }
    const urn: string = planta.aps_urn
    const viewGuid = (planta.aps_diagnostico as Record<string, unknown> | null)
      ?.view_escolhida as { guid?: string } | undefined
    if (!viewGuid?.guid) {
      return new Response(JSON.stringify({ ok: false, erro: 'sem_view_guid' }),
        { status: 412, headers: JSON_HEADERS })
    }

    // 2) credenciais do Cofre
    const rId = await supabase.rpc('fn_credencial_ler', {
      p_provider: 'aps', p_chave: 'client_id', p_escopo: 'global', p_company_id: null,
    })
    const rSecret = await supabase.rpc('fn_credencial_ler', {
      p_provider: 'aps', p_chave: 'client_secret', p_escopo: 'global', p_company_id: null,
    })
    const clientId = String(rId.data ?? '')
    const clientSecret = String(rSecret.data ?? '')
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ ok: false, erro: 'sem_credencial_aps' }),
        { status: 412, headers: JSON_HEADERS })
    }

    const token = await getApsToken(clientId, clientSecret)

    // 3) properties CRUAS — usa forceget pra pular cache
    const propsUrl = `${APS_BASE}/modelderivative/v2/designdata/${urn}/metadata/${viewGuid.guid}/properties?forceget=true`
    const propsRes = await fetch(propsUrl, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    })
    const propsHttpStatus = propsRes.status
    const propsRaw = await propsRes.text()
    let propsJson: unknown = null
    try { propsJson = JSON.parse(propsRaw) } catch { /* fica raw */ }

    // 4) extrai amostras
    type PropObj = {
      objectid: number; name: string;
      properties?: Record<string, Record<string, unknown>>
    }
    const collection: PropObj[] = (
      (propsJson as { data?: { collection?: PropObj[] } } | null)?.data?.collection ?? []
    )
    const totalColecao = collection.length
    // Procura por layer contendo o alvo em qualquer property group
    function itemMencionaLayer(it: PropObj, alvo: string): boolean {
      const bag = it.properties ?? {}
      const alvoLc = alvo.toLowerCase()
      for (const grupo of Object.values(bag)) {
        if (grupo && typeof grupo === 'object') {
          for (const [k, v] of Object.entries(grupo)) {
            const kv = `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`
            if (kv.toLowerCase().includes(alvoLc)) return true
          }
        }
      }
      return false
    }

    const amostras = collection.filter((it) => itemMencionaLayer(it, alvoLayer)).slice(0, maxAmostras)

    // 5) mapeia chaves top-level
    const topLevelKeys = new Set<string>()
    for (const it of amostras) {
      for (const g of Object.keys(it.properties ?? {})) topLevelKeys.add(g)
    }
    // se nao achou layer especifica, pega 5 primeiros com properties nao-vazias pra ainda mostrar shape
    const fallback = amostras.length === 0
      ? collection.filter((it) => Object.keys(it.properties ?? {}).length > 0).slice(0, maxAmostras)
      : []

    // 6) tenta object tree tambem
    const treeUrl = `${APS_BASE}/modelderivative/v2/designdata/${urn}/metadata/${viewGuid.guid}?forceget=true`
    const treeRes = await fetch(treeUrl, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    })
    const treeHttpStatus = treeRes.status
    const treeTxt = (await treeRes.text()).slice(0, 3000)  // primeiros 3KB — so estrutura

    const probe = {
      probed_at: new Date().toISOString(),
      urn,
      view_guid: viewGuid.guid,
      layer_alvo: alvoLayer,
      properties_http_status: propsHttpStatus,
      properties_total: totalColecao,
      properties_top_level_keys: Array.from(topLevelKeys),
      amostras_paredes: amostras.length > 0 ? amostras : null,
      fallback_amostras_gerais: fallback.length > 0 ? fallback : null,
      objecttree_http_status: treeHttpStatus,
      objecttree_preview_3kb: treeTxt,
    }

    // 7) grava em aps_diagnostico.probe (nao destrutivo)
    const diagAtual = (planta.aps_diagnostico ?? {}) as Record<string, unknown>
    diagAtual.probe = probe
    await supabase.from('erp_obra_planta')
      .update({ aps_diagnostico: diagAtual })
      .eq('id', plantaId)

    return new Response(JSON.stringify({
      ok: true,
      properties_http_status: propsHttpStatus,
      total_objects: totalColecao,
      matched_amostras: amostras.length,
      top_level_keys: Array.from(topLevelKeys),
      objecttree_http_status: treeHttpStatus,
    }), { headers: JSON_HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: (e as Error).message }),
      { status: 500, headers: JSON_HEADERS })
  }
})
