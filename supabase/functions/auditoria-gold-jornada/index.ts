// Edge Function: auditoria-gold-jornada (Gold G1 v2 · disparador fino)
// Apenas chama a route Vercel que faz o trabalho pesado (Playwright + Claude).
// Body: { rota: string, screen_id: string }
// Header: x-watcher-secret

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SEGREDOS = [Deno.env.get("WATCHER_SECRET"), Deno.env.get("WATCHER_SECRET_NOVO")].filter((v): v is string => !!v);
const WATCHER_SECRET = SEGREDOS[0] ?? "";
const SAAS_BASE_URL = Deno.env.get("SAAS_BASE_URL") || "https://erp-psgestao.vercel.app";

Deno.serve(async (req: Request) => {
  if (!SEGREDOS.includes(req.headers.get("x-watcher-secret") ?? "")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: { rota?: string; screen_id?: string } = {};
  try { body = await req.json(); } catch { /* */ }

  if (!body.rota || !body.screen_id) {
    return new Response(JSON.stringify({ error: "rota e screen_id obrigatorios" }), { status: 400 });
  }

  try {
    const res = await fetch(`${SAAS_BASE_URL}/api/gold/auditar-rota`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-watcher-secret": WATCHER_SECRET,
      },
      body: JSON.stringify({ rota: body.rota, screen_id: body.screen_id }),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "falha ao chamar route Vercel", detalhe: msg }),
      { status: 500 },
    );
  }
});
