// DF-e · Edge nfe-manifestar (#11a) — manifestação individual do destinatário.
//
// Manifestação é EVENTO oficial enviado ao SEFAZ via Focus (não é só status no banco).
// Esta edge dispara o evento nota-a-nota e só grava o status se o Focus aceitar (RD-58).
//
// Os 4 tipos oficiais (nome do EVENTO na Focus → estado gravado no banco):
//   ciencia        (210210) → 'ciencia'        · "sei que existe", não valida ainda
//   confirmacao    (210200) → 'confirmada'     · confirma que a operação ocorreu
//   desconhecimento(210220) → 'desconhecida'   · não reconhece  ← "Recusar NF indevida"
//   nao_realizada  (210240) → 'nao_realizada'  · reconhece mas não se concretizou
//
// Os NOMES do evento (confirmacao/desconhecimento) ≠ os ESTADOS do CHECK (confirmada/desconhecida):
// mapeamos antes de gravar — gravar o nome cru violaria erp_nfe_recebidas_status_manifestacao_check.
//
// Auth: espelha nfe-distribuicao/nfe-recebida-processar — JWT do usuário valida acesso à empresa
// via RLS (SELECT na própria nota); a escrita é service role, só após o evento aceito.
// Pilar 1: evento fiscal real no SEFAZ. Pilar 2: token via Vault, NUNCA em log.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Ambiente = "homologacao" | "producao"
type TipoEvento = "ciencia" | "confirmacao" | "desconhecimento" | "nao_realizada"

// tipo do evento Focus → estado gravado (CHECK erp_nfe_recebidas_status_manifestacao_check)
const EVENTO_PARA_STATUS: Record<TipoEvento, string> = {
  ciencia: "ciencia",
  confirmacao: "confirmada",
  desconhecimento: "desconhecida",
  nao_realizada: "nao_realizada",
}

function focusBase(amb: Ambiente): string {
  return amb === "producao"
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br"
}

function basicAuth(token: string): string { return "Basic " + btoa(token + ":") }
function digitsOnly(s: string | null | undefined): string { return (s ?? "").replace(/\D/g, "") }

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}
function erro(etapa: string, http_status?: number, bodyPreview?: string) {
  return {
    ok: false,
    etapa,
    ...(http_status !== undefined && { http_status }),
    ...(bodyPreview && { body_preview: bodyPreview.slice(0, 400) }),
  }
}

const FETCH_TIMEOUT_MS = 20_000
async function fetchComTimeout(url: string, init: RequestInit, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function resolverToken(company_id: string, ambiente: Ambiente): Promise<string> {
  const { data } = await sbAdmin.rpc("fn_fiscal_obter_token", {
    p_company_id: company_id,
    p_ambiente: ambiente,
  })
  let token = typeof data === "string" ? data.trim() : ""
  if (!token) {
    const envName = ambiente === "producao"
      ? "FOCUS_NFE_TOKEN_PRODUCAO"
      : "FOCUS_NFE_TOKEN_HOMOLOGACAO"
    token = Deno.env.get(envName) ?? ""
  }
  return token
}

// POST /v2/nfes_recebidas/{chave}/manifesto {"tipo":...}
// Tolera "duplicidade / já manifestada" como ok (evento já registrado no SEFAZ).
async function focusManifestar(
  ambiente: Ambiente,
  chave: string,
  tipo: TipoEvento,
  token: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${focusBase(ambiente)}/v2/nfes_recebidas/${chave}/manifesto`
  let r: Response
  try {
    r = await fetchComTimeout(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: basicAuth(token),
        "User-Agent": "PSGestao-ERP/3.0",
      },
      body: JSON.stringify({ tipo }),
    })
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { ok: false, status: 0, body: `timeout/rede · ${msg}` }
  }
  const body = await r.text()
  if (r.ok) return { ok: true, status: r.status, body }
  const lower = body.toLowerCase()
  const jaManif =
    lower.includes("duplicidade") ||
    lower.includes("duplicada") ||
    lower.includes("ja registrad") ||
    lower.includes("já registrad") ||
    lower.includes("ja manifest") ||
    lower.includes("já manifest")
  return { ok: jaManif, status: r.status, body }
}

interface Payload {
  company_id?: string
  nfe_recebida_id?: string
  tipo?: TipoEvento
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return respond(405, erro("metodo_nao_permitido"))

  let payload: Payload
  try { payload = (await req.json()) as Payload }
  catch { return respond(400, erro("payload_invalido")) }

  const company_id = payload.company_id
  const nfe_id = payload.nfe_recebida_id
  const tipo = payload.tipo
  if (!company_id || !nfe_id) return respond(400, erro("payload_invalido"))
  if (!tipo || !(tipo in EVENTO_PARA_STATUS)) {
    return respond(400, erro("tipo_invalido"))
  }

  // --- Guarda: JWT do usuário valida acesso à empresa via RLS (SELECT na própria nota) ---
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return respond(401, erro("nao_autenticado"))
  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData } = await sbUser.auth.getUser()
  if (!userData?.user) return respond(401, erro("nao_autenticado"))

  const { data: nfeGuard, error: guardErr } = await sbUser
    .from("erp_nfe_recebidas")
    .select("id, company_id, chave_acesso, status_manifestacao")
    .eq("id", nfe_id)
    .maybeSingle()
  if (guardErr) return respond(500, erro("rls_check", undefined, guardErr.message))
  if (!nfeGuard || nfeGuard.company_id !== company_id) {
    return respond(403, erro("sem_acesso"))
  }

  const chave = digitsOnly(nfeGuard.chave_acesso)
  if (!chave || chave.length !== 44) return respond(400, erro("chave_acesso_invalida"))

  // --- Ambiente ativo da empresa (default homologação, igual às outras edges fiscais) ---
  const { data: cfgs } = await sbAdmin
    .from("erp_fiscal_provider_config")
    .select("ambiente, atualizado_em, criado_em, id")
    .eq("company_id", company_id)
    .eq("ativo", true)
    .order("atualizado_em", { ascending: false, nullsFirst: false })
    .order("criado_em", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
  const ambiente: Ambiente = cfgs?.[0]?.ambiente === "producao" ? "producao" : "homologacao"

  // --- Token Vault ---
  const token = await resolverToken(company_id, ambiente)
  if (!token) return respond(412, erro("token_focus_ausente"))

  // --- Dispara o evento no SEFAZ via Focus. RD-58: só grava se aceitar. ---
  const manif = await focusManifestar(ambiente, chave, tipo, token)
  if (!manif.ok) {
    return respond(502, erro("focus_manifestacao", manif.status, manif.body))
  }

  const novoStatus = EVENTO_PARA_STATUS[tipo]
  // Recusa (desconhecimento / não realizada) tira a nota do fluxo de lançamento:
  // marca status='ignorada' (a nota não é da empresa / não se concretizou).
  const recusa = tipo === "desconhecimento" || tipo === "nao_realizada"
  const patch: Record<string, unknown> = {
    status_manifestacao: novoStatus,
    manifestado_em: new Date().toISOString(),
    manifestado_por: userData.user.id,
    updated_at: new Date().toISOString(),
  }
  if (recusa) patch.status = "ignorada"

  const up = await sbAdmin.from("erp_nfe_recebidas").update(patch).eq("id", nfe_id)
  if (up.error) {
    // O evento JÁ foi aceito pelo SEFAZ; só a gravação local falhou. Expõe pra tela (não mente).
    return respond(500, erro("update_status", undefined, up.error.message))
  }

  return respond(200, {
    ok: true,
    tipo,
    status_manifestacao: novoStatus,
    ...(recusa && { status: "ignorada" }),
  })
})
