// FEAT-NFSE-AUTOMACAO-v1 + FEAT-NFSE-TOKEN-POR-EMPRESA-v1 · gov-nfse-flags
// Devolve flags de disponibilidade da emissao NFS-e pra UI decidir
// quando habilitar o toggle "Producao".
//
// Body opcional: { company_id?: string }
//   - sem company_id: checa apenas o secret legado (compatibilidade)
//   - com company_id: resolve focus_token_secret_prod/_homolog na
//     erp_fiscal_provider_config; "producao_disponivel" so quando o
//     nome esta setado E Deno.env tem o valor.
//
// NUNCA retorna o valor do token · so booleans + nome do secret.
//
// Auth: verify_jwt=true.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

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

interface Payload {
  company_id?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return respond(405, { erro: "Method not allowed" })
  }

  let companyId: string | null = null
  if (req.method === "POST") {
    try {
      const p: Payload = await req.json()
      companyId = p.company_id ?? null
    } catch {
      // body opcional · ignora parse error
    }
  }

  // Nomes default (legados) pra fallback / compatibilidade
  const secretProdName = "FOCUS_NFE_TOKEN_PRODUCAO"
  const secretHomologName = "FOCUS_NFE_TOKEN_HOMOLOGACAO"

  // Por padrao usa os nomes legados
  let secretProdEffective = secretProdName
  let secretHomologEffective = secretHomologName

  if (companyId) {
    const { data: cfg } = await sb
      .from("erp_fiscal_provider_config")
      .select("focus_token_secret_homolog, focus_token_secret_prod")
      .eq("company_id", companyId)
      .eq("provider", "gov_nfse_nacional")
      .eq("ativo", true)
      .maybeSingle()
    if (cfg) {
      const cprod = (cfg as { focus_token_secret_prod?: string | null }).focus_token_secret_prod
      const chom  = (cfg as { focus_token_secret_homolog?: string | null }).focus_token_secret_homolog
      if (cprod && cprod.trim()) secretProdEffective = cprod.trim()
      if (chom && chom.trim())  secretHomologEffective = chom.trim()
    }
  }

  const tokenProd = Deno.env.get(secretProdEffective)
  const tokenHomolog = Deno.env.get(secretHomologEffective)

  return respond(200, {
    producao_disponivel: typeof tokenProd === "string" && tokenProd.length > 0,
    homologacao_disponivel: typeof tokenHomolog === "string" && tokenHomolog.length > 0,
    secret_prod_nome: secretProdEffective,       // so o NOME, nunca o valor
    secret_homolog_nome: secretHomologEffective,
  })
})
