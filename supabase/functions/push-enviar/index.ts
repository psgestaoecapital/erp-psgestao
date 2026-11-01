// #120 Web Push custo zero — envio genérico (qualquer tipo de aviso). Chamada SÓ pelo banco (pg_net, service_role).
// Segredos da função (o CEO cadastra): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Não guarda conteúdo; apaga assinatura expirada (404/410).
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, { auth: { persistSession: false } })

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

// Defesa em profundidade (SSRF): só https e hosts dos serviços de push; o mesmo vale como CHECK na tabela.
const HOST_PUSH = /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/i
const endpointPermitido = (e: string) => {
  try { const u = new URL(e); return u.protocol === "https:" && !u.username && !u.password && HOST_PUSH.test(u.hostname) } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { erro: "método" })
  // Só aceita o banco: Authorization = service_role.
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`) return json(401, { erro: "não autorizado" })

  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY")
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:suporte@psgestao.com.br"
  if (!pub || !priv) return json(200, { ok: false, pulado: "VAPID ausente" })
  webpush.setVapidDetails(subject, pub, priv)

  const b = await req.json().catch(() => null)
  if (!b?.user_id) return json(400, { erro: "user_id" })

  const { data: subs } = await sb.from("erp_push_assinatura")
    .select("id,endpoint,p256dh,auth").eq("user_id", b.user_id).eq("ativo", true)
  const payload = JSON.stringify({
    titulo: String(b.titulo ?? "PS Gestão").slice(0, 80),
    mensagem: String(b.mensagem ?? "").slice(0, 160),
    link: typeof b.link === "string" && b.link.startsWith("/") && !b.link.startsWith("//") ? b.link : "/dashboard",
    tag: b.tag ? String(b.tag) : undefined,
  })

  let enviados = 0, removidos = 0
  for (const s of subs ?? []) {
    if (!endpointPermitido(s.endpoint)) { await sb.from("erp_push_assinatura").update({ ativo: false }).eq("id", s.id); continue }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
      enviados++
      await sb.from("erp_push_assinatura").update({ ultimo_envio_em: new Date().toISOString() }).eq("id", s.id)
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) { await sb.from("erp_push_assinatura").delete().eq("id", s.id); removidos++ }
    }
  }
  return json(200, { ok: true, enviados, removidos })
})
