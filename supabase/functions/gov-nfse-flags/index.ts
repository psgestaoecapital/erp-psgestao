// FEAT-NFSE-AUTOMACAO-v1 · gov-nfse-flags
// Devolve flags de disponibilidade da emissao NFS-e pra UI decidir
// quando habilitar o toggle "Producao".
//
// NAO expoe o token · so { producao_disponivel: boolean }.
//
// Auth: verify_jwt=true (chamado da tela autenticada).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function respond(s: number, b: unknown) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return respond(405, { erro: "Method not allowed" })
  }

  const tokenProd = Deno.env.get("FOCUS_NFE_TOKEN_PRODUCAO")
  const tokenHomolog = Deno.env.get("FOCUS_NFE_TOKEN_HOMOLOGACAO")

  return respond(200, {
    producao_disponivel: typeof tokenProd === "string" && tokenProd.length > 0,
    homologacao_disponivel: typeof tokenHomolog === "string" && tokenHomolog.length > 0,
  })
})
