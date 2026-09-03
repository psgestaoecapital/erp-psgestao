// Edge Function: screen-watcher v2
// PR M.A.7.5 - Visual Baseline + Auto-update
// v2: relaxa secret quando nao configurado (modo dev), captura rotas publicas
//
// VERSIONADO no Git em 2026-05-14 via varredura Onda 2 (CEO Gilberto).
//
// 03/09/2026 (RD-52 · uma língua só): esta sonda faz fetch de HTML e NÃO tira foto. Antes gravava
// capture_status em INGLÊS ('success'/'error'/...) na MESMA coluna do capturador playwright, que grava
// em PORTUGUÊS ('sucesso' = FOTOGRAFOU). Dois vocabulários numa coluna só faziam contadores somarem foto
// boa como falha. Agora fala PORTUGUÊS e HONESTO: alcançou o HTML → 'html_ok' (NÃO 'sucesso' — não há
// foto); erros → 'erro'/'timeout'/'nao_encontrada'/'auth_falhou'. (Registrado como pendência: duas
// origens com propósitos diferentes — foto vs. HTML — talvez não devam dividir a mesma tabela.)

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
    // 'html_ok' = alcançou e leu o HTML (sem foto). NUNCA 'sucesso' — 'sucesso' é foto tirada (playwright).
    let status = "html_ok";
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
        status = "nao_encontrada";
      } else if (response.status >= 500) {
        status = "erro";
        errorsContent = `HTTP ${response.status}`;
      } else if (response.status >= 400) {
        status = "auth_falhou";
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
        if (status === "html_ok") {
          status = "auth_falhou";
          errorsContent = "Redirect para login - SCREENSHOT_USER_TOKEN nao configurado ou invalido";
        }
      }

      // Detectar Next.js error
      if (html.includes("Application error") || html.includes("Internal Server Error")) {
        status = "erro";
        errorsContent += "; Next.js error boundary";
      }

    } catch (err) {
      loadMs = Date.now() - startTime;
      status = err instanceof DOMException && err.name === "TimeoutError" ? "timeout" : "erro";
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
      html_ok: resultados.filter(r => r.status === "html_ok").length,
      auth_falhou: resultados.filter(r => r.status === "auth_falhou").length,
      erros: resultados.filter(r => r.status === "erro").length,
      nao_encontrada: resultados.filter(r => r.status === "nao_encontrada").length,
      timeout: resultados.filter(r => r.status === "timeout").length,
      resultados,
    }, null, 2),
    { headers: { "Content-Type": "application/json" } }
  );
});
