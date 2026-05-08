import { serve } from "https://deno.land/std@0.210.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const PLUGGY_API_URL = "https://api.pluggy.ai";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ConnectTokenRequest {
  client_id: string;
  consent_id?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Missing authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return jsonError("Invalid user session", 401);

    const body: ConnectTokenRequest = await req.json();
    if (!body.client_id) return jsonError("client_id is required", 400);

    const { data: client, error: clientError } = await supabase
      .from("wealth_clients")
      .select("id, nome, company_id")
      .eq("id", body.client_id)
      .single();

    if (clientError || !client) return jsonError("Client not found or no access", 403);

    let consentId = body.consent_id;
    if (!consentId) {
      const { data: consent } = await supabase
        .from("wealth_pluggy_consents")
        .select("id")
        .eq("client_id", body.client_id)
        .is("revogado_em", null)
        .order("aceito_em", { ascending: false })
        .limit(1)
        .single();
      if (!consent) return jsonError("Cliente precisa aceitar termo de consentimento Pluggy antes de conectar conta", 400);
      consentId = consent.id;
    }

    const pluggyClientId = Deno.env.get("PLUGGY_CLIENT_ID");
    const pluggyClientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET");
    if (!pluggyClientId || !pluggyClientSecret) return jsonError("Pluggy credentials not configured in edge env", 500);

    const authResp = await fetch(`${PLUGGY_API_URL}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: pluggyClientId, clientSecret: pluggyClientSecret }),
    });
    if (!authResp.ok) {
      const errText = await authResp.text();
      console.error("Pluggy auth failed:", authResp.status, errText);
      return jsonError(`Pluggy auth failed: ${authResp.status}`, 502);
    }
    const { apiKey } = await authResp.json();

    const connectResp = await fetch(`${PLUGGY_API_URL}/connect_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ options: { clientUserId: client.id } }),
    });
    if (!connectResp.ok) {
      const errText = await connectResp.text();
      console.error("Pluggy connect_token failed:", connectResp.status, errText);
      return jsonError(`Pluggy connect_token failed: ${connectResp.status}`, 502);
    }
    const { accessToken } = await connectResp.json();

    return new Response(
      JSON.stringify({ connect_token: accessToken, client_id: client.id, client_nome: client.nome, consent_id: consentId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    console.error("pluggy-connect-token error:", err);
    return jsonError(`Internal error: ${(err as Error).message}`, 500);
  }
});

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
