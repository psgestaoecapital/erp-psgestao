import { serve } from "https://deno.land/std@0.210.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OFXUploadRequest {
  client_id: string;
  filename: string;
  ofx_content: string;
  corretora_hint?: string;
}

interface ParsedTransaction {
  fitid: string;
  data: string;
  tipo: string;
  valor_total: number;
  quantidade?: number;
  preco_unitario?: number;
  memo?: string;
}

interface ParseResult {
  periodo_inicio: string | null;
  periodo_fim: string | null;
  transactions: ParsedTransaction[];
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

    const body: OFXUploadRequest = await req.json();
    if (!body.client_id || !body.ofx_content || !body.filename) return jsonError("client_id, filename and ofx_content required", 400);
    if (body.ofx_content.length > 5 * 1024 * 1024) return jsonError("File too large (max 5MB)", 413);

    const { data: client, error: clientError } = await supabase
      .from("wealth_clients")
      .select("id, company_id")
      .eq("id", body.client_id)
      .single();

    if (clientError || !client) return jsonError("Client not found or no access", 403);

    const corretora = body.corretora_hint || detectCorretora(body.ofx_content);
    const parseResult = parseOFX(body.ofx_content);

    const { data: upload, error: uploadError } = await supabase
      .from("wealth_ofx_uploads")
      .insert({
        client_id: client.id,
        company_id: client.company_id,
        uploaded_by_user_id: userData.user.id,
        filename: body.filename,
        file_size_bytes: body.ofx_content.length,
        corretora_detectada: corretora,
        periodo_inicio: parseResult.periodo_inicio,
        periodo_fim: parseResult.periodo_fim,
        total_transactions: parseResult.transactions.length,
        status: "processando",
        raw_content_sample: body.ofx_content.substring(0, 5000),
      })
      .select("id")
      .single();

    if (uploadError) {
      console.error("Insert upload failed:", uploadError);
      return jsonError(`Failed to create upload record: ${uploadError.message}`, 500);
    }

    await supabase
      .from("wealth_ofx_uploads")
      .update({
        status: "sucesso",
        processed_at: new Date().toISOString(),
        payload_resumo: {
          corretora,
          transactions_parsed: parseResult.transactions.length,
          periodo_inicio: parseResult.periodo_inicio,
          periodo_fim: parseResult.periodo_fim,
          processamento_v1: "apenas_parse_e_registro",
          v2_processara_transactions: true,
        },
      })
      .eq("id", upload.id);

    return new Response(
      JSON.stringify({
        ok: true,
        upload_id: upload.id,
        corretora_detectada: corretora,
        total_transactions: parseResult.transactions.length,
        periodo_inicio: parseResult.periodo_inicio,
        periodo_fim: parseResult.periodo_fim,
        message: "OFX recebido e parseado. Processamento detalhado de transacoes na proxima versao.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    console.error("ofx-upload error:", err);
    return jsonError((err as Error).message, 500);
  }
});

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function detectCorretora(ofxContent: string): string {
  const upper = ofxContent.toUpperCase();
  if (upper.includes("RICO") || upper.includes("XP INVEST")) return "rico_xp";
  if (upper.includes("BTG")) return "btg";
  if (upper.includes("INTER")) return "inter";
  if (upper.includes("NUBANK") || upper.includes("NU INVEST")) return "nubank";
  if (upper.includes("BRADESCO")) return "bradesco";
  if (upper.includes("ITAU")) return "itau";
  if (upper.includes("BANCO DO BRASIL") || upper.includes("BBSA")) return "bb";
  return "desconhecida";
}

function parseOFX(ofx: string): ParseResult {
  const transactions: ParsedTransaction[] = [];
  let periodoInicio: string | null = null;
  let periodoFim: string | null = null;

  const txBlocks = ofx.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g) || [];
  for (const block of txBlocks) {
    const fitid = extractTag(block, "FITID");
    const dtposted = extractTag(block, "DTPOSTED");
    const trnamt = extractTag(block, "TRNAMT");
    const trntype = extractTag(block, "TRNTYPE");
    const memo = extractTag(block, "MEMO");
    if (!fitid || !dtposted || !trnamt) continue;
    const data = parseOFXDate(dtposted);
    const valor = parseFloat(trnamt);
    transactions.push({
      fitid, data,
      tipo: valor < 0 ? "saida" : "entrada",
      valor_total: Math.abs(valor),
      memo: memo || trntype || undefined,
    });
    if (!periodoInicio || data < periodoInicio) periodoInicio = data;
    if (!periodoFim || data > periodoFim) periodoFim = data;
  }

  const invBlocks = ofx.match(/<(BUYSTOCK|SELLSTOCK|BUYMF|SELLMF|BUYDEBT|SELLDEBT|REINVEST|INCOME)>([\s\S]*?)<\/\1>/g) || [];
  for (const block of invBlocks) {
    const fitid = extractTag(block, "FITID");
    const dttrade = extractTag(block, "DTTRADE");
    const units = extractTag(block, "UNITS");
    const unitprice = extractTag(block, "UNITPRICE");
    const total = extractTag(block, "TOTAL");
    const memo = extractTag(block, "MEMO");
    const isBuy = block.startsWith("<BUY") || block.startsWith("<REINVEST");
    if (!fitid || !dttrade) continue;
    const data = parseOFXDate(dttrade);
    transactions.push({
      fitid, data,
      tipo: isBuy ? "compra" : "venda",
      quantidade: units ? Math.abs(parseFloat(units)) : undefined,
      preco_unitario: unitprice ? parseFloat(unitprice) : undefined,
      valor_total: total ? Math.abs(parseFloat(total)) : 0,
      memo: memo || undefined,
    });
    if (!periodoInicio || data < periodoInicio) periodoInicio = data;
    if (!periodoFim || data > periodoFim) periodoFim = data;
  }

  return { periodo_inicio: periodoInicio, periodo_fim: periodoFim, transactions };
}

function extractTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([^<\\n\\r]+)`));
  return m ? m[1].trim() : null;
}

function parseOFXDate(s: string): string {
  return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`;
}
