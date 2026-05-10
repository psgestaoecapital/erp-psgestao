// Truth Auditor Cron - Edge Function
// Trigger via Vercel Cron ou GitHub Actions
// PR 4.6 - PS Gestao - 10/05/2026

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const startedAt = new Date().toISOString();

  try {
    // Auth: verifica secret no header (seguranca)
    const authHeader = req.headers.get("x-truth-auditor-secret");
    const expectedSecret = Deno.env.get("TRUTH_AUDITOR_SECRET");

    if (!expectedSecret || authHeader !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Conectar ao Supabase com service_role
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Executar Truth Auditor orquestrador
    const { data, error } = await supabase.rpc("fn_truth_audit_executar_todas");

    if (error) {
      console.error("Truth Auditor error:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message,
          started_at: startedAt
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Resumo executivo
    const totalAlertas = data?.reduce((sum: number, r: any) => sum + (r.alertas || 0), 0) || 0;
    const totalCriticas = data?.reduce((sum: number, r: any) => sum + (r.criticas || 0), 0) || 0;
    const empresasComProblema = data?.reduce((max: number, r: any) => Math.max(max, r.empresas || 0), 0) || 0;

    const resumo = {
      success: true,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      total_alertas_gerados: totalAlertas,
      total_divergencias_criticas: totalCriticas,
      empresas_com_problema: empresasComProblema,
      regras_executadas: data?.length || 0,
      detalhe: data,
      status: totalCriticas === 0 ? "DRE_INTEGRO" : "DIVERGENCIAS_DETECTADAS"
    };

    return new Response(
      JSON.stringify(resumo, null, 2),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Connection": "keep-alive"
        }
      }
    );

  } catch (e) {
    console.error("Edge Function error:", e);
    return new Response(
      JSON.stringify({
        success: false,
        error: String(e),
        started_at: startedAt
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
