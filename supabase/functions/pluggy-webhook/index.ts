import { serve } from "https://deno.land/std@0.210.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PluggyWebhookEvent {
  event: string;
  itemId: string;
  clientId?: string;
  triggeredBy?: string;
  data?: Record<string, unknown>;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const event: PluggyWebhookEvent = await req.json();

    // TODO V2 PRODUCTION: HMAC SHA-256 com PLUGGY_WEBHOOK_SECRET
    // V1 SANDBOX: aceita request sem validacao (decisao CEO 07/05/2026 - regra #19)

    const { data: item, error: itemError } = await supabase
      .from("wealth_pluggy_items")
      .select("id, client_id, company_id, status")
      .eq("pluggy_item_id", event.itemId)
      .single();

    if (itemError || !item) {
      await supabase.from("wealth_pluggy_raw").insert({
        sync_log_id: null,
        item_id: null,
        client_id: null,
        tipo_payload: "webhook_event",
        payload: { ...event, processed: false, reason: "item_not_found" },
      });
      return new Response(JSON.stringify({ ok: true, message: "Item not found, logged" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    let novoStatus = item.status;
    let acao: "sync" | "marcar_erro" | "revogar" | "nada" = "nada";

    switch (event.event) {
      case "item/created":
      case "item/updated":
      case "item/login_succeeded":
        novoStatus = "UPDATING";
        acao = "sync";
        break;
      case "item/error":
      case "item/login_error":
        novoStatus = "LOGIN_ERROR";
        acao = "marcar_erro";
        break;
      case "item/deleted":
        novoStatus = "DELETED";
        acao = "revogar";
        break;
      case "item/waiting_user_input":
        novoStatus = "WAITING_USER_INPUT";
        break;
    }

    const updates: Record<string, unknown> = { status: novoStatus };
    if (acao === "marcar_erro") {
      updates.ultimo_erro_msg = JSON.stringify(event.data || event);
      updates.ultimo_erro_em = new Date().toISOString();
    }

    await supabase.from("wealth_pluggy_items").update(updates).eq("id", item.id);

    await supabase.from("wealth_pluggy_raw").insert({
      sync_log_id: null,
      item_id: item.id,
      client_id: item.client_id,
      tipo_payload: "webhook_event",
      payload: event,
    });

    if (acao === "sync") {
      const { error: rpcError } = await supabase.rpc("sp_pluggy_dispatch_sync", {
        p_item_id: item.id,
        p_origem: "webhook",
      });
      if (rpcError) console.error("dispatch_sync failed:", rpcError);
    }

    return new Response(
      JSON.stringify({ ok: true, item_id: item.id, novo_status: novoStatus, acao }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    console.error("pluggy-webhook error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
