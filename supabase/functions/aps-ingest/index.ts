// Takeoff DWG · APS (Autodesk Platform Services) — ingest + translate + radiografia + medidor.
// Recebe { planta_id, user_id, forcar? }.
//  1) Le erp_obra_planta.arquivo_dwg_path (bucket 'projetos-plantas' persistente).
//  2) TRAVA ANTI-RECOBRANCA: se aps_status='radiografado' e forcar!=true,
//     devolve o diagnostico salvo e NAO chama APS, NAO grava uso.
//  3) OAuth2 client_credentials (segredos APS_* no Vault).
//  4) OSS bucket 'psgestao-takeoff' (idempotente).
//  5) Upload signed-S3 (parts=1).
//  6) Translate SVF2 (2d+3d) com x-ads-force:true.
//  7) Poll manifest ate 'success' (backoff 5s, teto ~140s p/ nao estourar edge).
//  8) Radiografia: metadata -> guids (2D) -> metadata/:guid -> properties.
//  9) UPDATE erp_obra_planta (status, urn, diagnostico, analisado_em/por).
// 10) INSERT erp_uso_medicao 1x (recurso='takeoff_dwg') — cobranca variavel.
//
// Se o poll atingir o teto sem 'success', mantem aps_status='traduzindo' e
// devolve {ok:true, status:'traduzindo', urn}. A UI chama /api/aps/status
// depois pra fechar (mesmo endpoint sabe retomar do estado 'traduzindo').

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' }

const APS_BASE = 'https://developer.api.autodesk.com'
const APS_BUCKET = 'psgestao-takeoff'
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 140_000
const RECURSO = 'takeoff_dwg'

// base64url sem padding — formato do URN do APS.
function urnFromObjectId(objectId: string): string {
  const b64 = btoa(objectId)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

type ApsToken = { access_token: string; expires_in: number }

async function getApsToken(clientId: string, clientSecret: string): Promise<string> {
  const basic = btoa(`${clientId}:${clientSecret}`)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'data:read data:write data:create bucket:create bucket:read',
  })
  const r = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  })
  if (!r.ok) throw new Error(`aps_oauth_${r.status}: ${(await r.text()).slice(0, 400)}`)
  const t = (await r.json()) as ApsToken
  return t.access_token
}

async function ensureBucket(token: string): Promise<void> {
  const r = await fetch(`${APS_BASE}/oss/v2/buckets`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ bucketKey: APS_BUCKET, policyKey: 'temporary' }),
  })
  if (r.ok || r.status === 409) return
  throw new Error(`aps_bucket_${r.status}: ${(await r.text()).slice(0, 400)}`)
}

async function uploadSignedS3(token: string, objectKey: string, bytes: Uint8Array): Promise<string> {
  const g = await fetch(
    `${APS_BASE}/oss/v2/buckets/${APS_BUCKET}/objects/${encodeURIComponent(objectKey)}/signeds3upload?parts=1`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
  )
  if (!g.ok) throw new Error(`aps_signed_get_${g.status}: ${(await g.text()).slice(0, 400)}`)
  const gj = (await g.json()) as { uploadKey: string; urls: string[] }

  const put = await fetch(gj.urls[0], { method: 'PUT', body: bytes })
  if (!put.ok) throw new Error(`aps_signed_put_${put.status}: ${(await put.text()).slice(0, 400)}`)

  const c = await fetch(
    `${APS_BASE}/oss/v2/buckets/${APS_BUCKET}/objects/${encodeURIComponent(objectKey)}/signeds3upload`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ uploadKey: gj.uploadKey }),
    },
  )
  if (!c.ok) throw new Error(`aps_signed_complete_${c.status}: ${(await c.text()).slice(0, 400)}`)
  const cj = (await c.json()) as { objectId: string }
  return cj.objectId
}

async function translateSvf2(token: string, urn: string): Promise<void> {
  const r = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-ads-force': 'true',
      accept: 'application/json',
    },
    body: JSON.stringify({
      input: { urn },
      output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] },
    }),
  })
  if (!r.ok) throw new Error(`aps_translate_${r.status}: ${(await r.text()).slice(0, 400)}`)
}

type Manifest = { status: string; progress?: string; derivatives?: unknown[] }

async function getManifest(token: string, urn: string): Promise<Manifest> {
  const r = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${urn}/manifest`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`aps_manifest_${r.status}: ${(await r.text()).slice(0, 300)}`)
  return (await r.json()) as Manifest
}

async function pollUntilSuccess(token: string, urn: string, deadline: number): Promise<Manifest | null> {
  while (Date.now() < deadline) {
    const m = await getManifest(token, urn)
    if (m.status === 'success') return m
    if (m.status === 'failed') throw new Error(`aps_translate_failed: ${JSON.stringify(m).slice(0, 400)}`)
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return null
}

type Metadata = { data: { metadata: Array<{ guid: string; role: string; name: string; type: string }> } }
type ObjectTree = { data: { objects: Array<{ objectid: number; name: string; objects?: unknown[] }> } }
type Properties = {
  data: {
    collection: Array<{
      objectid: number
      name: string
      properties: Record<string, Record<string, unknown>>
    }>
  }
}

async function radiografar(token: string, urn: string): Promise<Record<string, unknown>> {
  // GET /metadata pode devolver HTTP 202 sem .data enquanto o SVF2 e' pos-processado.
  // Todos acessos a .data DEVEM usar optional chaining — se vier vazio, entregamos
  // uma radiografia parcial sinalizando "aguardando_arvore".
  const metaRes = await fetch(
    `${APS_BASE}/modelderivative/v2/designdata/${urn}/metadata`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
  )
  const metaStatus = metaRes.status
  const meta = (await metaRes.json()) as Metadata | { result?: string }

  const metaList = (meta as Metadata)?.data?.metadata ?? []
  const guids2d = metaList.filter((g) => g.role === '2d' || g.type === 'geometry')
  const escolhido = guids2d[0] ?? metaList[0]
  const diagnostico: Record<string, unknown> = {
    total_views: metaList.length,
    views: metaList.map((v) => ({ name: v.name, role: v.role, type: v.type })),
  }
  if (metaStatus === 202 || metaList.length === 0) {
    diagnostico.aviso = 'metadata_ainda_processando'
    diagnostico.metadata_http_status = metaStatus
    return diagnostico
  }
  if (!escolhido) return diagnostico

  // ObjectTree — pode retornar 202 + {"result":"success"} SEM .data enquanto extrai.
  const treeRes = await fetch(
    `${APS_BASE}/modelderivative/v2/designdata/${urn}/metadata/${escolhido.guid}`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
  )
  const treeStatus = treeRes.status
  const tree = (await treeRes.json()) as ObjectTree | { result?: string }
  const treeObjects = (tree as ObjectTree)?.data?.objects ?? null

  diagnostico.view_escolhida = { guid: escolhido.guid, name: escolhido.name, role: escolhido.role }

  if (!treeObjects) {
    diagnostico.aviso = 'objecttree_ainda_processando'
    diagnostico.objecttree_http_status = treeStatus
    diagnostico.n_objetos = 0
    return diagnostico
  }

  const flat: Array<{ objectid: number; name: string }> = []
  function walk(nodes: Array<{ objectid: number; name: string; objects?: unknown[] }>) {
    for (const n of nodes) {
      flat.push({ objectid: n.objectid, name: n.name })
      if (Array.isArray(n.objects)) walk(n.objects as typeof nodes)
    }
  }
  walk(treeObjects)
  diagnostico.n_objetos = flat.length

  // Properties (layers + tipos + Area) — mesma proteção
  const propsRes = await fetch(
    `${APS_BASE}/modelderivative/v2/designdata/${urn}/metadata/${escolhido.guid}/properties`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
  )
  const props = (await propsRes.json()) as Properties | { result?: string }
  const propsCollection = (props as Properties)?.data?.collection ?? []

  const layerCount = new Map<string, number>()
  const tipoCount = new Map<string, number>()
  let temArea = 0
  const candidatosAmbiente: Array<{ objectid: number; name: string }> = []
  for (const it of propsCollection) {
    const p = it.properties ?? {}
    const layer = String(
      (p.Layer as Record<string, unknown> | undefined)?.Layer
        ?? (p.General as Record<string, unknown> | undefined)?.Layer
        ?? 'sem-layer',
    )
    layerCount.set(layer, (layerCount.get(layer) ?? 0) + 1)
    const objType = String(
      (p.General as Record<string, unknown> | undefined)?.['ObjectType']
        ?? (p.General as Record<string, unknown> | undefined)?.Category
        ?? 'desconhecido',
    )
    tipoCount.set(objType, (tipoCount.get(objType) ?? 0) + 1)
    const area = (p.Dimensions as Record<string, unknown> | undefined)?.Area
      ?? (p.General as Record<string, unknown> | undefined)?.Area
    if (area !== undefined && area !== null && area !== '') temArea++
    // heuristica: nome contem palavra tipica de ambiente
    if (/quarto|sala|cozinha|banheiro|escritorio|corredor|hall|varanda|copa|dorm|wc|lavabo|suite/i.test(it.name)) {
      candidatosAmbiente.push({ objectid: it.objectid, name: it.name })
    }
  }
  diagnostico.layers = Array.from(layerCount.entries())
    .map(([nome, count]) => ({ nome, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
  diagnostico.tipos_objeto = Array.from(tipoCount.entries())
    .map(([tipo, count]) => ({ tipo, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
  diagnostico.tem_area_prop = temArea > 0
  diagnostico.qtd_com_area = temArea
  diagnostico.candidatos_ambiente = candidatosAmbiente.slice(0, 100)
  return diagnostico
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json()
    const { planta_id, user_id, forcar } = body as {
      planta_id?: string; user_id?: string; forcar?: boolean
    }
    if (!planta_id) {
      return new Response(JSON.stringify({ ok: false, erro: 'planta_id obrigatorio' }),
        { status: 400, headers: JSON_HEADERS })
    }

    // 1) Le planta
    const { data: planta, error: pErr } = await supabase
      .from('erp_obra_planta')
      .select('id, company_id, arquivo_dwg_path, arquivo_path, aps_status, aps_urn, aps_diagnostico, analisado_em, analisado_por')
      .eq('id', planta_id)
      .maybeSingle()
    if (pErr || !planta) {
      return new Response(JSON.stringify({ ok: false, erro: 'planta_nao_encontrada' }),
        { status: 404, headers: JSON_HEADERS })
    }

    // 2) TRAVA ANTI-RECOBRANCA
    if (!forcar && planta.aps_status === 'radiografado') {
      return new Response(JSON.stringify({
        ok: true, status: 'radiografado', ja_analisado: true,
        aps_diagnostico: planta.aps_diagnostico,
        analisado_em: planta.analisado_em, analisado_por: planta.analisado_por,
      }), { headers: JSON_HEADERS })
    }

    const dwgPath = planta.arquivo_dwg_path ?? planta.arquivo_path
    if (!dwgPath) {
      return new Response(JSON.stringify({ ok: false, erro: 'sem_arquivo_dwg' }),
        { status: 412, headers: JSON_HEADERS })
    }

    // 3) Secrets APS via Cofre (fn_credencial_ler, service role) com fallback pra env do edge.
    let clientId = ''
    let clientSecret = ''
    const rId = await supabase.rpc('fn_credencial_ler', {
      p_provider: 'aps', p_chave: 'client_id', p_escopo: 'global', p_company_id: null,
    })
    const rSecret = await supabase.rpc('fn_credencial_ler', {
      p_provider: 'aps', p_chave: 'client_secret', p_escopo: 'global', p_company_id: null,
    })
    if (!rId.error && typeof rId.data === 'string') clientId = rId.data
    if (!rSecret.error && typeof rSecret.data === 'string') clientSecret = rSecret.data
    if (!clientId) clientId = Deno.env.get('APS_CLIENT_ID') ?? ''
    if (!clientSecret) clientSecret = Deno.env.get('APS_CLIENT_SECRET') ?? ''
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({
        ok: false, erro: 'secrets_aps_nao_configuradas',
        detalhe: 'Cadastre APS Client ID e Client Secret em /dashboard/cofre (admin).',
      }), { status: 412, headers: JSON_HEADERS })
    }

    // Retomada: se ja tem urn+status=traduzindo, so faz poll/radiografia
    let urn = planta.aps_urn as string | null
    const token = await getApsToken(clientId, clientSecret)

    if (!urn || planta.aps_status === 'erro' || forcar) {
      // 4) Baixa DWG do bucket persistente
      const dl = await supabase.storage.from('projetos-plantas').download(dwgPath)
      if (dl.error || !dl.data) {
        const erro = `download_falhou: ${dl.error?.message ?? 'sem dados'} (${dwgPath})`
        await supabase.from('erp_obra_planta').update({ aps_status: 'erro', aps_diagnostico: { erro } })
          .eq('id', planta_id)
        return new Response(JSON.stringify({ ok: false, erro }), { status: 404, headers: JSON_HEADERS })
      }
      const bytes = new Uint8Array(await dl.data.arrayBuffer())

      // 5) Upload APS
      await ensureBucket(token)
      const objectKey = `${planta.company_id}/${planta.id}.dwg`
      const objectId = await uploadSignedS3(token, objectKey, bytes)
      urn = urnFromObjectId(objectId)

      // 6) Translate
      await translateSvf2(token, urn)

      await supabase.from('erp_obra_planta').update({
        aps_urn: urn, aps_status: 'traduzindo', aps_diagnostico: null,
      }).eq('id', planta_id)
    }

    // 7) Poll
    const deadline = Date.now() + POLL_TIMEOUT_MS
    const manifest = await pollUntilSuccess(token, urn, deadline)
    if (!manifest) {
      // Tempo estourou — mantem estado, UI pode chamar de novo depois.
      return new Response(JSON.stringify({
        ok: true, status: 'traduzindo', urn,
        aviso: 'Traducao APS excedeu o poll do edge; chame de novo pra concluir.',
      }), { headers: JSON_HEADERS })
    }

    // 8) Radiografia
    const diagnostico = await radiografar(token, urn)
    const analisadoEm = new Date().toISOString()
    // Se radiografia veio parcial (metadata/objecttree ainda processando no APS),
    // mantem status='traduzindo' — nao cobra ainda, e a proxima chamada retenta.
    const parcial = !!(diagnostico.aviso)

    // 9) UPDATE
    await supabase.from('erp_obra_planta').update({
      aps_status: parcial ? 'traduzindo' : 'radiografado',
      aps_traduzido_em: parcial ? null : analisadoEm,
      aps_diagnostico: diagnostico,
      analisado_em: parcial ? null : analisadoEm,
      analisado_por: parcial ? null : (user_id ?? null),
    }).eq('id', planta_id)

    if (parcial) {
      return new Response(JSON.stringify({
        ok: true, status: 'traduzindo', urn,
        aviso: String(diagnostico.aviso),
        aps_diagnostico: diagnostico,
      }), { headers: JSON_HEADERS })
    }

    // 10) INSERT medidor (1x — trava anti-dup por (company_id, recurso, referencia_id))
    // So cobra em radiografia completa.
    const jaMedido = await supabase.from('erp_uso_medicao')
      .select('id').eq('company_id', planta.company_id)
      .eq('recurso', RECURSO).eq('referencia_id', planta_id).limit(1)
    if (!jaMedido.error && (jaMedido.data ?? []).length === 0) {
      await supabase.from('erp_uso_medicao').insert({
        company_id: planta.company_id,
        recurso: RECURSO,
        referencia_id: planta_id,
        quantidade: 1,
        custo_provedor: 0.20, // credito APS estimado por tradução Model Derivative
        moeda: 'USD',
        metadados: { urn, dwg_path: dwgPath, forcar: !!forcar },
        ocorrido_em: analisadoEm,
      })
    }

    return new Response(JSON.stringify({
      ok: true, status: 'radiografado', urn,
      aps_diagnostico: diagnostico, analisado_em: analisadoEm,
    }), { headers: JSON_HEADERS })
  } catch (e) {
    const erro = (e as Error).message || String(e)
    return new Response(JSON.stringify({ ok: false, erro }),
      { status: 500, headers: JSON_HEADERS })
  }
})
