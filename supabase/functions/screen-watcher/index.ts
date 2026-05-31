// Edge Function: screen-watcher v2
// PR M.A.7.5 - Visual Baseline + Auto-update
// v2: relaxa secret quando nao configurado (modo dev), captura rotas publicas
//
// VERSIONADO no Git em 2026-05-14 via varredura Onda 2 (CEO Gilberto).
// Antes vivia so no Supabase. Conteudo extraido via mcp get_edge_function
// versao 4 (slug screen-watcher, id 48924472-6b06-44b5-a698-0212becdb85f,
// ezbr_sha256 483f31260f3ca419224383f79de018248f6180796738ad5440b8d2c33eb1901a).
// NAO redeployado nesta operacao — apenas adicionado ao audit trail Git.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SAAS_BASE_URL = Deno.env.get("SAAS_BASE_URL") || "https://erp-psgestao.vercel.app";
const SCREENSHOT_USER_TOKEN = Deno.env.get("SCREENSHOT_USER_TOKEN") || "";
const WATCHER_SECRET = Deno.env.get("WATCHER_SECRET") || "";

Deno.serve(async (req: Request) => {
  // Auth: se WATCHER_SECRET configurado, exige header. Se nao, libera (modo dev)
  if (WATCHER_SECRET) {
    const authHeader = req.headers.get("x-watcher-secret");
    if (authHeader !== WATCHER_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  // Se WATCHER_SECRET vazio, segue sem auth (modo dev)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let bodyData: any = {};
  try { bodyData = await req.json(); } catch { bodyData = {}; }

  const prioridadeFiltro = bodyData.prioridade || ["critica", "alta"];
  const rotaEspecifica = bodyData.rota || null;
  const limitMax = bodyData.limit || 30; // limita para nao timeout

  let query = supabase
    .from("system_screens")
    .select("id, rota, area, titulo, prioridade_monitoramento");

  if (rotaEspecifica) {
    query = query.eq("rota", rotaEspecifica);
  } else {
    query = query.in("prioridade_monitoramento", prioridadeFiltro).limit(limitMax);
  }

  const { data: screens, error: screensError } = await query;

  if (screensError) {
    return new Response(JSON.stringify({ error: screensError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const inicio = new Date();
  const resultados = [];

  for (const screen of screens || []) {
    const rotaResolved = screen.rota.replace(/\[[^\]]+\]/g, "sample");
    const url = `${SAAS_BASE_URL}${rotaResolved}`;

    const startTime = Date.now();
    let status = "success";
    let httpStatus = 0;
    let htmlSize = 0;
    let htmlHash = "";
    let titulo = "";
    let errorsContent = "";
    let loadMs = 0;

    try {
      const headers: Record<string, string> = {
        "User-Agent": "PS-Gestao-Screen-Watcher/2.0",
        "Accept": "text/html,application/xhtml+xml",
      };

      if (SCREENSHOT_USER_TOKEN) {
        headers["Cookie"] = `sb-access-token=${SCREENSHOT_USER_TOKEN}`;
        headers["Authorization"] = `Bearer ${SCREENSHOT_USER_TOKEN}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });

      loadMs = Date.now() - startTime;
      httpStatus = response.status;

      if (response.status === 404) {
        status = "404";
      } else if (response.status >= 500) {
        status = "error";
        errorsContent = `HTTP ${response.status}`;
      } else if (response.status >= 400) {
        status = "auth_failed";
        errorsContent = `HTTP ${response.status} - faltam secrets de auth`;
      }

      // Capturar HTML mesmo em caso de erro 4xx (redirect login pode dar 200)
      const html = await response.text();
      htmlSize = html.length;

      const sample = html.slice(0, 200) + html.slice(-200);
      htmlHash = btoa(sample).slice(0, 32);

      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      titulo = titleMatch?.[1]?.trim() || "";

      // Detectar redirect para login (sintomas de auth falhou)
      if (html.includes("login") && (titulo.toLowerCase().includes("login") || html.includes('action="/login"'))) {
        if (status === "success") {
          status = "auth_failed";
          errorsContent = "Redirect para login - SCREENSHOT_USER_TOKEN nao configurado ou invalido";
        }
      }

      // Detectar Next.js error
      if (html.includes("Application error") || html.includes("Internal Server Error")) {
        status = "error";
        errorsContent += "; Next.js error boundary";
      }

    } catch (err) {
      loadMs = Date.now() - startTime;
      status = err instanceof DOMException && err.name === "TimeoutError" ? "timeout" : "error";
      errorsContent = String(err).slice(0, 500);
    }

    const { error: insertError } = await supabase.from("system_screens_history").insert({
      screen_id: screen.id,
      rota: screen.rota,
      screenshot_url: null,
      html_snapshot_url: null,
      errors_count: errorsContent ? 1 : 0,
      errors_snapshot: errorsContent || null,
      page_load_ms: loadMs,
      capture_method: "deno_fetch_v2",
      capture_status: status,
      diff_vs_previous: htmlHash,
    });

    if (!insertError) {
      await supabase.from("system_screens")
        .update({
          ultima_validacao_visual_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", screen.id);
    }

    resultados.push({
      screen_id: screen.id,
      rota: screen.rota,
      status,
      http_status: httpStatus,
      load_ms: loadMs,
      html_size: htmlSize,
      titulo: titulo.slice(0, 100),
      errors: errorsContent || null,
    });
  }

  const fim = new Date();
  const totalMs = fim.getTime() - inicio.getTime();

  return new Response(
    JSON.stringify({
      executed_at: inicio.toISOString(),
      duration_ms: totalMs,
      total_screens: resultados.length,
      success: resultados.filter(r => r.status === "success").length,
      auth_failed: resultados.filter(r => r.status === "auth_failed").length,
      errors: resultados.filter(r => r.status === "error").length,
      not_found: resultados.filter(r => r.status === "404").length,
      resultados,
    }, null, 2),
    { headers: { "Content-Type": "application/json" } }
  );
});
