import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export async function POST(req: Request) {
  try {
    const { company_id } = await req.json();
    if (!company_id) return NextResponse.json({ error: "company_id obrigatorio" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Load approved classifications not yet applied
    const { data: aprovados } = await supabase
      .from("bpo_classificacoes")
      .select("*")
      .eq("company_id", company_id)
      .eq("status", "aprovado")
      .is("aplicado_em", null);

    if (!aprovados || aprovados.length === 0) {
      return NextResponse.json({ message: "Nenhuma classificacao pendente de aplicacao", aplicados: 0 });
    }

    // 2. Load omie_imports for this company
    const { data: imports } = await supabase
      .from("omie_imports")
      .select("id, import_type, import_data")
      .eq("company_id", company_id)
      .in("import_type", ["contas_pagar", "contas_receber"]);

    if (!imports || imports.length === 0) {
      return NextResponse.json({ message: "Nenhum import encontrado", aplicados: 0 });
    }

    let aplicados = 0;
    const agora = new Date().toISOString();

    // 3. For each approved classification, find and update the matching lancamento
    for (const aprov of aprovados) {
      const catFinal = aprov.categoria_final || aprov.categoria_sugerida;
      if (!catFinal) continue;

      let matched = false;

      for (const imp of imports) {
        if (!imp.import_data) continue;

        const key = imp.import_type === "contas_pagar" ? "conta_pagar_cadastro" : "conta_receber_cadastro";
        const regs = imp.import_data[key];
        if (!Array.isArray(regs)) continue;

        for (const reg of regs) {
          // Match by documento + valor + data
          const doc = reg.numero_documento || reg.numero_pedido || reg.numero_documento_fiscal || "";
          const val = Number(reg.valor_documento) || 0;
          const dataL = reg.data_emissao || reg.data_vencimento || "";

          const matchDoc = aprov.documento && doc && String(doc) === String(aprov.documento);
          const matchVal = Math.abs(val - Math.abs(aprov.valor || 0)) < 0.01;
          const matchData = aprov.data_lancamento && dataL && dataL.includes(aprov.data_lancamento);

          // Match by at least 2 of 3 criteria
          const matches = [matchDoc, matchVal, matchData].filter(Boolean).length;
          if (matches >= 2) {
            // Apply the BPO category
            reg.descricao_categoria_original = reg.descricao_categoria || reg.codigo_categoria || "";
            reg.descricao_categoria = catFinal;
            reg.categoria_bpo = catFinal;
            reg.bpo_aplicado = true;
            matched = true;
            break;
          }
        }

        if (matched) {
          // Save updated import_data back
          await supabase
            .from("omie_imports")
            .update({ import_data: imp.import_data })
            .eq("id", imp.id);
          break;
        }
      }

      // Mark classification as applied
      if (matched) {
        await supabase
          .from("bpo_classificacoes")
          .update({ aplicado_em: agora })
          .eq("id", aprov.id);
        aplicados++;
      }
    }

    // 4. Log
    await supabase.from("bpo_sync_log").insert({
      company_id,
      tipo: "retroalimentacao",
      status: "sucesso",
      registros_processados: aprovados.length,
      classificacoes_geradas: aplicados,
      duracao_ms: 0,
    });

    return NextResponse.json({
      message: `${aplicados} de ${aprovados.length} classificacoes aplicadas ao omie_imports`,
      aplicados,
      total_aprovados: aprovados.length,
      nao_encontrados: aprovados.length - aplicados,
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
