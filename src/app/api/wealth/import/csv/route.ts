import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://horsymhsinqcimflrtjo.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo";
const supabase = createClient(supabaseUrl, supabaseKey);

/*
  Expected CSV format:
  ticker,nome,classe,instituicao,quantidade,preco_medio,cotacao_atual
  PETR4,Petrobras PN,acao,Agora Corretora,300,14.56,16.75
  HGLG11,CSHG Logística,fii,Banco do Brasil,150,78.05,89.10
  ...

  Valid classes: acao, fii, fiagro, fi_infra, tesouro, cdb, lci, lca, debenture, fundo, etf, bdr, cripto, outro
*/

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return [];

  // Parse header
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/"/g, ""));

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(sep).map(v => v.trim().replace(/"/g, ""));
    if (values.length < headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] || ""; });
    rows.push(row);
  }
  return rows;
}

function parseNumber(v: string): number {
  if (!v) return 0;
  // Handle Brazilian format: 1.234,56 → 1234.56
  const cleaned = v.replace(/\./g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  return parseFloat(cleaned) || 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { client_id, csv_text } = body;

    if (!client_id) return NextResponse.json({ error: "client_id obrigatório" }, { status: 400 });
    if (!csv_text) return NextResponse.json({ error: "csv_text obrigatório" }, { status: 400 });

    // Verify client exists
    const { data: client } = await supabase.from("wealth_clients").select("id,nome").eq("id", client_id).single();
    if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

    const rows = parseCSV(csv_text);
    if (rows.length === 0) return NextResponse.json({ error: "CSV vazio ou formato inválido. Use: ticker,nome,classe,instituicao,quantidade,preco_medio,cotacao_atual" }, { status: 400 });

    const results: { ticker: string; status: string; error?: string }[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      const ticker = (row.ticker || "").toUpperCase().trim();
      if (!ticker) { results.push({ ticker: "(vazio)", status: "ignorado", error: "Ticker vazio" }); errorCount++; continue; }

      const quantidade = parseNumber(row.quantidade || row.qtd || row.qty || "0");
      const precoMedio = parseNumber(row.preco_medio || row.pm || row.preco || "0");
      const cotacaoAtual = parseNumber(row.cotacao_atual || row.cotacao || row.preco_atual || "0");

      if (quantidade <= 0 || precoMedio <= 0) {
        results.push({ ticker, status: "ignorado", error: "Quantidade ou preço médio inválido" });
        errorCount++;
        continue;
      }

      try {
        // 1. Upsert asset
        const assetData: any = {
          ticker,
          nome: row.nome || row.name || ticker,
          classe: row.classe || row.class || row.tipo || "acao",
          ativo: true,
        };
        if (cotacaoAtual > 0) {
          assetData.cotacao_atual = cotacaoAtual;
          assetData.cotacao_atualizada_em = new Date().toISOString();
        }

        const { data: existingAsset } = await supabase.from("wealth_assets").select("id").eq("ticker", ticker).single();

        let assetId: string;
        if (existingAsset) {
          assetId = existingAsset.id;
          if (cotacaoAtual > 0) {
            await supabase.from("wealth_assets").update({ cotacao_atual: cotacaoAtual, cotacao_atualizada_em: new Date().toISOString() }).eq("id", assetId);
          }
        } else {
          const { data: newAsset, error: assetError } = await supabase.from("wealth_assets").insert(assetData).select("id").single();
          if (assetError) throw assetError;
          assetId = newAsset.id;
        }

        // 2. Check existing position
        const { data: existPos } = await supabase.from("wealth_positions")
          .select("id,quantidade,preco_medio")
          .eq("client_id", client_id).eq("asset_id", assetId).single();

        if (existPos) {
          // Update: recalculate average price
          const qtdTotal = existPos.quantidade + quantidade;
          const custoTotal = (existPos.quantidade * existPos.preco_medio) + (quantidade * precoMedio);
          const novoPM = custoTotal / qtdTotal;
          await supabase.from("wealth_positions").update({
            quantidade: qtdTotal,
            preco_medio: novoPM,
            updated_at: new Date().toISOString(),
          }).eq("id", existPos.id);
        } else {
          // Create position
          const valorAtual = cotacaoAtual > 0 ? quantidade * cotacaoAtual : null;
          await supabase.from("wealth_positions").insert({
            client_id,
            asset_id: assetId,
            instituicao: row.instituicao || row.corretora || row.broker || null,
            quantidade,
            preco_medio: precoMedio,
            valor_atual: valorAtual,
            data_primeira_compra: row.data_compra || row.data || null,
          });
        }

        // 3. Register transaction
        await supabase.from("wealth_transactions").insert({
          client_id,
          asset_id: assetId,
          tipo: "compra",
          data: row.data_compra || row.data || new Date().toISOString().split("T")[0],
          quantidade,
          preco_unitario: precoMedio,
          valor_total: quantidade * precoMedio,
          instituicao: row.instituicao || row.corretora || null,
          fonte: "csv",
        });

        results.push({ ticker, status: "ok" });
        successCount++;
      } catch (e: any) {
        results.push({ ticker, status: "erro", error: e.message });
        errorCount++;
      }
    }

    return NextResponse.json({
      success: true,
      client: client.nome,
      summary: { total: rows.length, success: successCount, errors: errorCount },
      details: results,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
