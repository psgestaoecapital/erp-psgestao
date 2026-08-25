// NFE-EMISSAO · Worker nfe-consultar-processando
//
// Disparado pelo cron (fn_nfe_auto_consultar_pendentes a cada 15min) ou manualmente.
// A Focus NFe é assíncrona: ao emitir, a nota volta 'processando_autorizacao' e é
// preciso reconsultar a ref até virar 'autorizado'/'erro_autorizacao'/'denegado'.
// Sem isso, a nota trava em 'processando' para sempre (foi o que aconteceu com a KGF).
//
// Para cada nota em status='processando' (ou 'autorizada' sem xml — rede de segurança):
//   1) GET {base}/v2/nfe/{ref} com o token da empresa dona (ambiente da própria nota)
//   2) Mapeia o status da Focus → status do app e atualiza erp_nfe_emitidas
//      (status, motivo_rejeicao=mensagem_sefaz, chave, numero, protocolo, xml_url, danfe_url,
//       provider_raw) — MESMO vocabulário da rota /api/fiscal/nfe/consultar/[id].
// Throttle de 1.5s entre chamadas. Service role only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const FOCUS_BASE: Record<string, string> = {
  producao: "https://api.focusnfe.com.br",
  homologacao: "https://homologacao.focusnfe.com.br",
}
const BATCH_LIMIT = 30
const THROTTLE_MS = 1500

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

function basicAuth(token: string): string { return "Basic " + btoa(token + ":") }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

interface FocusNFe {
  status?: string
  mensagem_sefaz?: string
  numero?: string
  chave_nfe?: string
  protocolo?: string
  caminho_xml_nota_fiscal?: string
  caminho_danfe?: string
  url_danfe?: string
  [k: string]: unknown
}

// Mesmo mapeamento do FocusNFeProvider.mapFocusNFeResponse (rota interativa) — mantém o
// vocabulário do banco consistente entre consulta interativa e este worker.
function mapStatus(focusStatus: string | undefined): string {
  switch (focusStatus) {
    case "autorizado": return "autorizada"
    case "cancelado": return "cancelada"
    case "denegado": return "denegada"
    case "erro_autorizacao": return "rejeitada"
    default: return "processando"
  }
}

interface NotaPendente {
  id: string
  company_id: string
  provider_reference: string
  ambiente: string | null
  status: string
  chave: string | null
  numero: string | null
  xml_url: string | null
  danfe_url: string | null
  motivo_rejeicao: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return respond(405, { ok: false, erro: "metodo_nao_permitido" })

  // {company_id?} opcional pra repique manual/targeted
  let payloadCompanyId: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    payloadCompanyId = typeof body?.company_id === "string" ? body.company_id : undefined
  } catch { /* sem body */ }

  // Notas presas em 'processando' (e autorizadas sem XML, como rede de segurança), mais antigas primeiro.
  let q = sbAdmin
    .from("erp_nfe_emitidas")
    .select("id, company_id, provider_reference, ambiente, status, chave, numero, xml_url, danfe_url, motivo_rejeicao")
    .eq("provider", "focusnfe")
    .not("provider_reference", "is", null)
    .gte("criado_em", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .or("status.eq.processando,and(status.eq.autorizada,xml_url.is.null)")
    .order("criado_em", { ascending: true })
    .limit(BATCH_LIMIT)
  if (payloadCompanyId) q = q.eq("company_id", payloadCompanyId)

  const { data: pendentes, error: qErr } = await q
  if (qErr) return respond(500, { ok: false, etapa: "select_pendentes", body_preview: qErr.message })

  const fila = (pendentes ?? []) as NotaPendente[]
  if (fila.length === 0) return respond(200, { ok: true, processadas: 0, resolvidas: 0, ainda_processando: 0 })

  // Cache de token por (company, ambiente)
  const tokenCache = new Map<string, string>()
  async function tokenDe(company_id: string, ambiente: string): Promise<string> {
    const key = `${company_id}:${ambiente}`
    const cached = tokenCache.get(key)
    if (cached !== undefined) return cached
    const { data } = await sbAdmin.rpc("fn_fiscal_obter_token", {
      p_company_id: company_id, p_ambiente: ambiente,
    })
    const tok = typeof data === "string" ? data.trim() : ""
    tokenCache.set(key, tok)
    return tok
  }

  let processadas = 0
  let resolvidas = 0
  let aindaProcessando = 0
  const erros: Array<{ id: string; etapa: string; detalhe: string }> = []

  for (const nota of fila) {
    processadas++
    const ambiente = (nota.ambiente ?? "producao").toLowerCase() === "homologacao" ? "homologacao" : "producao"
    const base = FOCUS_BASE[ambiente]
    try {
      const token = await tokenDe(nota.company_id, ambiente)
      if (!token || token.length < 8) {
        erros.push({ id: nota.id, etapa: "token", detalhe: "token ausente" })
        continue
      }
      const r = await fetch(`${base}/v2/nfe/${encodeURIComponent(nota.provider_reference)}`, {
        headers: { Authorization: basicAuth(token), "User-Agent": "PSGestao-ERP/3.0", Accept: "application/json" },
      })
      const txt = await r.text()
      let data: FocusNFe = {}
      try { data = txt ? (JSON.parse(txt) as FocusNFe) : {} } catch { data = { raw: txt } as FocusNFe }

      if (!r.ok) {
        // grava o erro de consulta em provider_raw pra diagnóstico, sem mudar o status
        await sbAdmin.from("erp_nfe_emitidas")
          .update({ provider_raw: { consulta_erro: { status: r.status, body_preview: txt.slice(0, 300) } } })
          .eq("id", nota.id)
        erros.push({ id: nota.id, etapa: "focus_http", detalhe: `HTTP ${r.status}` })
        aindaProcessando++
        await sleep(THROTTLE_MS)
        continue
      }

      const novoStatus = mapStatus(data.status)
      const xmlUrl = data.caminho_xml_nota_fiscal ? `${base}${data.caminho_xml_nota_fiscal}` : null
      const danfeUrl = data.caminho_danfe ? `${base}${data.caminho_danfe}` : (data.url_danfe ?? null)

      await sbAdmin.from("erp_nfe_emitidas").update({
        status: novoStatus,
        chave: data.chave_nfe ?? nota.chave,
        numero: data.numero ?? nota.numero,
        protocolo: data.protocolo ?? null,
        xml_url: xmlUrl ?? nota.xml_url,
        danfe_url: danfeUrl ?? nota.danfe_url,
        motivo_rejeicao: data.mensagem_sefaz ?? nota.motivo_rejeicao,
        provider_raw: data as unknown as Record<string, unknown>,
        atualizado_em: new Date().toISOString(),
      }).eq("id", nota.id)

      if (novoStatus === "processando") aindaProcessando++
      else resolvidas++
    } catch (e) {
      erros.push({ id: nota.id, etapa: "excecao", detalhe: (e as Error)?.message ?? "erro" })
    }
    await sleep(THROTTLE_MS)
  }

  return respond(200, {
    ok: true,
    processadas,
    resolvidas,
    ainda_processando: aindaProcessando,
    erros: erros.length ? erros : undefined,
    ts: new Date().toISOString(),
  })
})
