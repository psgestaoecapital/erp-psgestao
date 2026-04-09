import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

type Transacao = { data: string; descricao: string; valor: number; raw?: string };

// Parse OFX format
function parseOFX(text: string): Transacao[] {
  const txns: Transacao[] = [];
  const blocks = text.split(/<STMTTRN>/gi);
  for (const block of blocks) {
    const dtMatch = block.match(/<DTPOSTED>(\d{8})/i);
    const amtMatch = block.match(/<TRNAMT>([+-]?[\d.,]+)/i);
    const memoMatch = block.match(/<MEMO>([^\n<]+)/i) || block.match(/<NAME>([^\n<]+)/i);
    if (dtMatch && amtMatch) {
      const d = dtMatch[1];
      const data = `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
      const valor = Math.abs(parseFloat(amtMatch[1].replace(",", ".")));
      const descricao = (memoMatch?.[1] || "").trim();
      txns.push({ data, descricao, valor });
    }
  }
  return txns;
}

// Parse CSV format (flexible - detects columns)
function parseCSV(text: string): Transacao[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return [];

  // Detect separator
  const sep = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].toLowerCase().split(sep).map(h => h.replace(/"/g, "").trim());

  // Find column indices
  const dateIdx = header.findIndex(h => h.includes("data") || h.includes("date") || h.includes("dt"));
  const descIdx = header.findIndex(h => h.includes("desc") || h.includes("hist") || h.includes("memo") || h.includes("nome") || h.includes("estabelecimento") || h.includes("loja"));
  const valIdx = header.findIndex(h => h.includes("valor") || h.includes("amount") || h.includes("vlr") || h.includes("montante") || h.includes("total"));

  if (dateIdx === -1 && valIdx === -1) return [];

  const txns: Transacao[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length <= Math.max(dateIdx, descIdx, valIdx)) continue;

    const data = dateIdx >= 0 ? cols[dateIdx] : "";
    const descricao = descIdx >= 0 ? cols[descIdx] : cols.slice(1).join(" ").trim();
    let valorStr = valIdx >= 0 ? cols[valIdx] : "0";
    valorStr = valorStr.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
    const valor = Math.abs(parseFloat(valorStr) || 0);

    if (valor > 0) txns.push({ data, descricao, valor });
  }
  return txns;
}

// Normalize date to comparable format
function normDate(d: string): string {
  if (!d) return "";
  // Try DD/MM/YYYY
  const p1 = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (p1) {
    const yr = p1[3].length === 2 ? "20" + p1[3] : p1[3];
    return `${yr}-${p1[2].padStart(2, "0")}-${p1[1].padStart(2, "0")}`;
  }
  // Try YYYY-MM-DD
  const p2 = d.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (p2) return `${p2[1]}-${p2[2].padStart(2, "0")}-${p2[3].padStart(2, "0")}`;
  return d;
}

// Date difference in days
function dateDiff(d1: string, d2: string): number {
  const a = new Date(normDate(d1));
  const b = new Date(normDate(d2));
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 999;
  return Math.abs((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// Simple string similarity (Jaccard on words)
function similarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  const wb = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  if (wa.size === 0 && wb.size === 0) return 0;
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? inter / union : 0;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const companyId = formData.get("company_id") as string;
    const operadora = formData.get("operadora") as string || "Cartão";

    if (!file || !companyId) return NextResponse.json({ error: "Arquivo e empresa obrigatórios" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. PARSE FILE
    const text = await file.text();
    const fileName = file.name.toLowerCase();
    let faturaItens: Transacao[] = [];

    if (fileName.endsWith(".ofx") || fileName.endsWith(".ofc")) {
      faturaItens = parseOFX(text);
    } else if (fileName.endsWith(".csv") || fileName.endsWith(".txt") || fileName.endsWith(".tsv")) {
      faturaItens = parseCSV(text);
    } else {
      return NextResponse.json({ error: "Formato não suportado. Use OFX, CSV ou TXT." }, { status: 400 });
    }

    if (faturaItens.length === 0) return NextResponse.json({ error: "Nenhuma transação encontrada no arquivo." }, { status: 400 });

    // 2. LOAD OMIE CONTAS A PAGAR
    const { data: imports } = await supabase.from("omie_imports").select("import_data").eq("company_id", companyId).eq("import_type", "contas_pagar");

    const omieItens: Transacao[] = [];
    const clienteNomes: Record<string, string> = {};

    // Load client names
    const { data: cliImports } = await supabase.from("omie_imports").select("import_data").eq("company_id", companyId).eq("import_type", "clientes");
    if (cliImports) {
      for (const ci of cliImports) {
        const cls = ci.import_data?.clientes_cadastro || [];
        if (Array.isArray(cls)) for (const c of cls) {
          const cod = c.codigo_cliente_omie || c.codigo_cliente || c.codigo;
          clienteNomes[String(cod)] = c.nome_fantasia || c.razao_social || c.nome || "";
        }
      }
    }

    if (imports) {
      for (const imp of imports) {
        const regs = imp.import_data?.conta_pagar_cadastro || [];
        if (!Array.isArray(regs)) continue;
        for (const r of regs) {
          const codCF = String(r.codigo_cliente_fornecedor || "");
          omieItens.push({
            data: r.data_vencimento || r.data_emissao || "",
            descricao: clienteNomes[codCF] || r.observacao || `Fornecedor ${codCF}`,
            valor: Number(r.valor_documento) || 0,
            raw: r.numero_documento || "",
          });
        }
      }
    }

    // 3. MATCHING ENGINE
    const totalFatura = faturaItens.reduce((s, t) => s + t.valor, 0);
    const usedOmie = new Set<number>();
    const resultados: any[] = [];

    for (const fat of faturaItens) {
      let bestMatch: any = null;
      let bestScore = 0;

      for (let oi = 0; oi < omieItens.length; oi++) {
        if (usedOmie.has(oi)) continue;
        const omie = omieItens[oi];

        // Score calculation
        let score = 0;

        // Value match (most important)
        const valDiff = Math.abs(fat.valor - omie.valor);
        if (valDiff === 0) score += 50;
        else if (valDiff < 0.05) score += 45;
        else if (valDiff / Math.max(fat.valor, 1) < 0.01) score += 35;
        else if (valDiff / Math.max(fat.valor, 1) < 0.05) score += 20;
        else continue; // Skip if value too different

        // Date match
        const dd = dateDiff(fat.data, omie.data);
        if (dd === 0) score += 30;
        else if (dd <= 1) score += 25;
        else if (dd <= 3) score += 20;
        else if (dd <= 7) score += 10;
        else if (dd <= 15) score += 5;

        // Description similarity
        const sim = similarity(fat.descricao, omie.descricao);
        score += Math.round(sim * 20);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = { ...omie, index: oi, score };
        }
      }

      if (bestMatch && bestScore >= 45) {
        usedOmie.add(bestMatch.index);
        resultados.push({
          fonte: "fatura",
          data_transacao: fat.data,
          descricao: fat.descricao,
          valor: fat.valor,
          match_descricao: bestMatch.descricao,
          match_valor: bestMatch.valor,
          match_data: bestMatch.data,
          match_score: bestScore,
          status: bestScore >= 70 ? "conciliado" : "sugestao",
        });
      } else {
        resultados.push({
          fonte: "fatura",
          data_transacao: fat.data,
          descricao: fat.descricao,
          valor: fat.valor,
          match_descricao: "",
          match_valor: 0,
          match_data: "",
          match_score: 0,
          status: "somente_fatura",
        });
      }
    }

    // Items only in Omie (not matched)
    for (let oi = 0; oi < omieItens.length; oi++) {
      if (usedOmie.has(oi)) continue;
      const omie = omieItens[oi];
      // Only include if it looks like it could be a card transaction (reasonable value range)
      if (omie.valor > 0 && omie.valor < faturaItens.reduce((max, f) => Math.max(max, f.valor), 0) * 3) {
        resultados.push({
          fonte: "omie",
          data_transacao: omie.data,
          descricao: omie.descricao,
          valor: omie.valor,
          match_descricao: "",
          match_valor: 0,
          match_data: "",
          match_score: 0,
          status: "somente_omie",
        });
      }
    }

    // 4. SAVE TO DATABASE
    const conciliados = resultados.filter(r => r.status === "conciliado").length;
    const sugestoes = resultados.filter(r => r.status === "sugestao").length;
    const somenteFatura = resultados.filter(r => r.status === "somente_fatura").length;
    const somenteOmie = resultados.filter(r => r.status === "somente_omie").length;
    const totalOmieMatched = resultados.filter(r => r.status === "conciliado" || r.status === "sugestao").reduce((s, r) => s + r.match_valor, 0);

    const { data: conc } = await supabase.from("conciliacao_cartao").insert({
      company_id: companyId,
      nome_fatura: file.name,
      operadora,
      total_fatura: totalFatura,
      total_omie: totalOmieMatched,
      divergencia: totalFatura - totalOmieMatched,
      itens_conciliados: conciliados,
      itens_divergentes: sugestoes,
      itens_somente_fatura: somenteFatura,
      itens_somente_omie: somenteOmie,
    }).select().single();

    if (conc) {
      for (const r of resultados) {
        await supabase.from("conciliacao_itens").insert({
          conciliacao_id: conc.id, ...r,
        });
      }
    }

    return NextResponse.json({
      success: true,
      conciliacao_id: conc?.id,
      resumo: {
        transacoes_fatura: faturaItens.length,
        transacoes_omie: omieItens.length,
        conciliados,
        sugestoes,
        somente_fatura: somenteFatura,
        somente_omie: somenteOmie,
        total_fatura: totalFatura,
        total_omie: totalOmieMatched,
        divergencia: totalFatura - totalOmieMatched,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
