// P&M · Bot no Slack (CEO 31/10) · FATIA 2 — motor de envio.
// Chamada SÓ pelo banco (pg_net, service_role) via fn_pm_bot_disparar / fn_pm_bot_testar.
// Lê o webhook do COFRE pela RPC fn_pm_bot_webhook_obter (GRANT só service_role), posta no Slack e grava o
// resultado (enviado/falhou + http_status) de volta em erp_pm_bot_envio. NUNCA guarda nem loga o webhook.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, { auth: { persistSession: false } })

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

// Defesa em profundidade (SSRF): só https e host do Incoming Webhook do Slack. O mesmo vale como CHECK no banco.
const slackOk = (u: string) => {
  try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password && x.hostname === "hooks.slack.com" }
  catch { return false }
}

async function marcar(envioId: string, campos: Record<string, unknown>) {
  try { await sb.from("erp_pm_bot_envio").update(campos).eq("id", envioId) } catch { /* não derruba o envio */ }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { erro: "método" })
  // Só aceita o banco: Authorization = service_role.
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`) return json(401, { erro: "não autorizado" })

  const b = await req.json().catch(() => null)
  const companyId = typeof b?.company_id === "string" ? b.company_id : null
  const envioId = typeof b?.envio_id === "string" ? b.envio_id : null
  if (!companyId || !envioId) return json(400, { erro: "company_id e envio_id" })

  // conteúdo do aviso (fonte única: a linha já enfileirada)
  const { data: linha } = await sb.from("erp_pm_bot_envio")
    .select("titulo,texto,evento,company_id,status").eq("id", envioId).single()
  if (!linha || linha.company_id !== companyId) {
    return json(200, { ok: false, pulado: "envio inexistente" })
  }

  // webhook do cofre (porta exclusiva do service_role)
  const { data: webhook, error: whErr } = await sb.rpc("fn_pm_bot_webhook_obter", { p_company_id: companyId })
  if (whErr || !webhook || typeof webhook !== "string" || !slackOk(webhook)) {
    await marcar(envioId, { status: "falhou", erro: "canal não conectado ou webhook inválido" })
    return json(200, { ok: false, erro: "sem webhook válido" })
  }

  const titulo = String(linha.titulo ?? "PS Gestão").slice(0, 120)
  const texto = String(linha.texto ?? "").slice(0, 1500)
  const payload = { text: `*${titulo}*\n${texto}` }

  try {
    const resp = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })
    const corpo = (await resp.text().catch(() => "")).slice(0, 180)
    if (resp.ok) {
      await marcar(envioId, { status: "enviado", http_status: resp.status, erro: null, enviado_em: new Date().toISOString() })
      return json(200, { ok: true, http_status: resp.status })
    }
    await marcar(envioId, { status: "falhou", http_status: resp.status, erro: corpo || `HTTP ${resp.status}` })
    return json(200, { ok: false, http_status: resp.status })
  } catch (e) {
    await marcar(envioId, { status: "falhou", erro: String((e as Error)?.message ?? e).slice(0, 180) })
    return json(200, { ok: false, erro: "falha de rede" })
  }
})
