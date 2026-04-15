import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

type CostCenterMap = {
  source_type: string;
  source_key: string;
  business_line_id: string;
  allocation_pct: number;
  cost_scope: string;
  priority: number;
};

type CostTypeRule = {
  category_pattern: string;
  match_type: string;
  cost_nature: string;
  cost_behavior: string;
  cost_group: string;
  priority: number;
  company_id: string | null;
};

type AllocationResult = {
  company_id: string;
  periodo: string;
  business_line_id: string | null;
  cost_group: string;
  cost_nature: string;
  cost_behavior: string;
  costing_method: string;
  valor: number;
  moeda: string;
  taxa_cambio: number;
  valor_original: number;
  valor_brl: number;
  allocation_source: string;
  source_table: string;
  categoria_origem: string;
  fornecedor: string;
  documento: string;
  descricao: string;
};

// ═══════════════════════════════════════════════════════════
// HELPER: Parse mês/ano de data BR ou ISO
// ═══════════════════════════════════════════════════════════

function parsePeriodo(dt: string): string | null {
  if (!dt || typeof dt !== "string") return null;
  // DD/MM/YYYY
  const p1 = dt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (p1) {
    const mes = parseInt(p1[2]);
    let ano = parseInt(p1[3]);
    if (p1[3].length === 2) ano = 2000 + ano;
    if (ano >= 2015 && ano <= 2035 && mes >= 1 && mes <= 12)
      return `${ano}-${String(mes).padStart(2, "0")}`;
  }
  // YYYY-MM-DD
  const p2 = dt.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (p2) {
    const ano = parseInt(p2[1]);
    const mes = parseInt(p2[2]);
    if (ano >= 2015 && ano <= 2035 && mes >= 1 && mes <= 12)
      return `${ano}-${String(mes).padStart(2, "0")}`;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// HELPER: Extrair categoria do registro Omie (com fallback rateio)
// ═══════════════════════════════════════════════════════════

function getCategoriaOmie(r: any): string {
  if (r.codigo_categoria) return r.codigo_categoria;
  if (Array.isArray(r.categorias) && r.categorias.length > 0) {
    const sorted = [...r.categorias].sort((a: any, b: any) => (b.percentual || 0) - (a.percentual || 0));
    if (sorted[0]?.codigo_categoria) return sorted[0].codigo_categoria;
  }
  return "sem_cat";
}

// ═══════════════════════════════════════════════════════════
// HELPER: Classificar custo usando regras
// ═══════════════════════════════════════════════════════════

function classifyCost(
  categoria: string,
  descricao: string,
  rules: CostTypeRule[]
): { cost_nature: string; cost_behavior: string; cost_group: string } {
  const catLower = (categoria || "").toLowerCase();
  const descLower = (descricao || "").toLowerCase();
  const combined = `${catLower} ${descLower}`;

  for (const rule of rules) {
    const pattern = rule.category_pattern.toLowerCase();
    let match = false;

    switch (rule.match_type) {
      case "prefix":
        match = catLower.startsWith(pattern);
        break;
      case "exact":
        match = catLower === pattern;
        break;
      case "keyword":
        match = combined.includes(pattern);
        break;
      case "regex":
        try { match = new RegExp(pattern, "i").test(combined); } catch { }
        break;
    }

    if (match) {
      return {
        cost_nature: rule.cost_nature,
        cost_behavior: rule.cost_behavior,
        cost_group: rule.cost_group,
      };
    }
  }

  // Default: indireto, fixo, outros
  return { cost_nature: "indireto", cost_behavior: "fixo", cost_group: "outros" };
}

// ═══════════════════════════════════════════════════════════
// HELPER: Resolver alocação por linha de negócio
// ═══════════════════════════════════════════════════════════

function resolveAllocation(
  record: any,
  companyId: string,
  centerMaps: CostCenterMap[],
  catMap: Record<string, string>
): { business_line_id: string | null; allocation_pct: number; source: string }[] {

  // CAMADA 1: distribuicao[] do Omie (mais preciso)
  if (Array.isArray(record.distribuicao) && record.distribuicao.length > 0) {
    const allocations: { business_line_id: string | null; allocation_pct: number; source: string }[] = [];

    for (const dist of record.distribuicao) {
      const depName = (dist.cDesDep || "").toUpperCase().trim();
      const pct = dist.nPerDep || 0;

      // Busca no cost_center_map por nome de departamento
      const mapping = centerMaps.find(
        m => m.source_type === "omie_departamento" &&
          m.source_key.toUpperCase().trim() === depName
      );

      if (mapping) {
        allocations.push({
          business_line_id: mapping.business_line_id,
          allocation_pct: pct,
          source: "omie_distribuicao",
        });
      } else {
        // Departamento sem mapeamento — vai pra "Não Alocado" com a %
        allocations.push({
          business_line_id: null,
          allocation_pct: pct,
          source: "omie_distribuicao_sem_mapa",
        });
      }
    }

    if (allocations.length > 0) return allocations;
  }

  // CAMADA 2: Categoria Omie
  const cat = getCategoriaOmie(record);
  if (cat && cat !== "sem_cat") {
    const catDesc = catMap[cat] || "";
    const catMappings = centerMaps
      .filter(m => m.source_type === "omie_categoria" && m.source_key === cat)
      .sort((a, b) => a.priority - b.priority);

    if (catMappings.length > 0) {
      return catMappings.map(m => ({
        business_line_id: m.business_line_id,
        allocation_pct: m.allocation_pct,
        source: "omie_categoria",
      }));
    }
  }

  // CAMADA 3: CNPJ do fornecedor/cliente (fallback)
  const cnpj = record.cnpj_fornecedor || record.cnpj_cliente || "";
  if (cnpj) {
    const cnpjMappings = centerMaps
      .filter(m => m.source_type === "cnpj" && m.source_key === cnpj)
      .sort((a, b) => a.priority - b.priority);

    if (cnpjMappings.length > 0) {
      return cnpjMappings.map(m => ({
        business_line_id: m.business_line_id,
        allocation_pct: m.allocation_pct,
        source: "cnpj_fallback",
      }));
    }
  }

  // CAMADA 4: Não alocado
  return [{ business_line_id: null, allocation_pct: 100, source: "nao_alocado" }];
}

// ═══════════════════════════════════════════════════════════
// STATUS filter (mesma lógica do Process API)
// ═══════════════════════════════════════════════════════════

const STATUS_EXCLUIDOS = new Set([
  "CANCELADO", "CANCELADA", "ESTORNADO", "ESTORNADA",
  "DEVOLVIDO", "DEVOLVIDA", "ANULADO", "ANULADA",
  "REJEITADO", "REJEITADA", "CANCELAMENTO",
]);

// ═══════════════════════════════════════════════════════════
// POST HANDLER
// ═══════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const { company_ids, periodo } = await req.json();

    if (!company_ids?.length || !periodo) {
      return NextResponse.json(
        { error: "company_ids e periodo são obrigatórios" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ═══ 1. CARREGAR DADOS BASE ═══

    // Importações do Omie
    const { data: rawImports } = await supabase
      .from("omie_imports")
      .select("company_id, import_type, import_data, imported_at")
      .in("company_id", company_ids);

    if (!rawImports?.length) {
      return NextResponse.json({ error: "Sem dados importados" }, { status: 404 });
    }

    // Dedup: manter só a importação mais recente por (company_id, import_type)
    const importMap = new Map<string, any>();
    for (const imp of rawImports) {
      const key = `${imp.company_id}|${imp.import_type}`;
      const existing = importMap.get(key);
      if (!existing || new Date(imp.imported_at || 0) > new Date(existing.imported_at || 0))
        importMap.set(key, imp);
    }
    const imports = Array.from(importMap.values());

    // Mapeamento de centros de custo
    const { data: centerMapsRaw } = await supabase
      .from("cost_center_map")
      .select("*")
      .in("company_id", company_ids)
      .eq("ativo", true)
      .order("priority");

    const centerMaps: CostCenterMap[] = (centerMapsRaw || []).map((m: any) => ({
      source_type: m.source_type,
      source_key: m.source_key,
      business_line_id: m.business_line_id,
      allocation_pct: Number(m.allocation_pct) || 100,
      cost_scope: m.cost_scope,
      priority: m.priority,
    }));

    // Regras de classificação (global + empresa)
    const { data: rulesRaw } = await supabase
      .from("cost_type_rules")
      .select("*")
      .or(`company_id.is.null,company_id.in.(${company_ids.join(",")})`)
      .eq("ativo", true)
      .order("priority");

    // Empresa-specific rules first (override globals)
    const rules: CostTypeRule[] = (rulesRaw || [])
      .sort((a: any, b: any) => {
        // Company-specific primeiro
        if (a.company_id && !b.company_id) return -1;
        if (!a.company_id && b.company_id) return 1;
        return (a.priority || 10) - (b.priority || 10);
      })
      .map((r: any) => ({
        category_pattern: r.category_pattern,
        match_type: r.match_type,
        cost_nature: r.cost_nature,
        cost_behavior: r.cost_behavior,
        cost_group: r.cost_group,
        priority: r.priority,
        company_id: r.company_id,
      }));

    // Mapa de categorias (código → descrição)
    const catMap: Record<string, string> = {};
    for (const imp of imports) {
      if (imp.import_type === "categorias") {
        const regs = imp.import_data?.categoria_cadastro || [];
        if (Array.isArray(regs)) {
          for (const c of regs) {
            const cod = c.codigo || c.cCodigo || c.cCodCateg || "";
            const desc = c.descricao || c.cDescricao || c.cDescrCateg || "";
            if (cod) catMap[cod] = desc || cod;
          }
        }
      }
    }

    // Mapa de clientes/fornecedores
    const nomeMap: Record<string, string> = {};
    for (const imp of imports) {
      if (imp.import_type === "clientes") {
        const cls = imp.import_data?.clientes_cadastro || [];
        if (Array.isArray(cls)) {
          for (const c of cls) {
            const cod = c.codigo_cliente_omie || c.codigo_cliente || c.codigo;
            nomeMap[String(cod)] = c.nome_fantasia || c.razao_social || c.nome || "";
          }
        }
      }
    }

    // ═══ 2. LIMPAR ALOCAÇÕES ANTERIORES DO PERÍODO ═══
    // Versionamento: incrementa versão ao invés de deletar
    // (mas pra simplicidade, deletamos a versão atual e recriamos)

    await supabase
      .from("cost_allocations")
      .delete()
      .in("company_id", company_ids)
      .eq("periodo", periodo);

    // ═══ 3. PROCESSAR CONTAS A PAGAR (CUSTOS/DESPESAS) ═══

    const results: AllocationResult[] = [];
    let audit = {
      total_registros: 0,
      cancelados: 0,
      fora_periodo: 0,
      sem_valor: 0,
      com_distribuicao: 0,
      sem_distribuicao: 0,
      alocados: 0,
      nao_alocados: 0,
    };

    for (const imp of imports) {
      if (imp.import_type !== "contas_pagar") continue;

      const regs = imp.import_data?.conta_pagar_cadastro || [];
      if (!Array.isArray(regs)) continue;

      for (const r of regs) {
        audit.total_registros++;

        // Filtrar cancelados
        const status = (r.status_titulo || "").toUpperCase().trim();
        if (STATUS_EXCLUIDOS.has(status)) { audit.cancelados++; continue; }

        // Valor
        const valor = Number(r.valor_documento) || 0;
        if (valor <= 0) { audit.sem_valor++; continue; }

        // Data (previsão como primária)
        const dt = r.data_previsao || r.data_vencimento || r.data_emissao || "";
        const per = parsePeriodo(dt);
        if (!per || per !== periodo) { audit.fora_periodo++; continue; }

        // Categoria
        const cat = getCategoriaOmie(r);
        const catDesc = catMap[cat] || r.descricao_categoria || cat;

        // Fornecedor
        const codCF = String(r.codigo_cliente_fornecedor || r.codigo_fornecedor || "");
        const fornecedor = r.observacao || nomeMap[codCF] || `Fornecedor ${codCF}`;

        // Classificar o custo
        const classification = classifyCost(cat, catDesc, rules);

        // Resolver alocação por linha de negócio
        const allocations = resolveAllocation(r, imp.company_id, centerMaps, catMap);

        const hasDistrib = Array.isArray(r.distribuicao) && r.distribuicao.length > 0;
        if (hasDistrib) audit.com_distribuicao++;
        else audit.sem_distribuicao++;

        // Gerar registros de alocação
        for (const alloc of allocations) {
          const valorAlocado = valor * (alloc.allocation_pct / 100);

          if (alloc.business_line_id) audit.alocados++;
          else audit.nao_alocados++;

          // ABSORÇÃO: todos os custos vão pro produto
          results.push({
            company_id: imp.company_id,
            periodo,
            business_line_id: alloc.business_line_id,
            cost_group: classification.cost_group,
            cost_nature: classification.cost_nature,
            cost_behavior: classification.cost_behavior,
            costing_method: "absorcao",
            valor: valorAlocado,
            moeda: "BRL",
            taxa_cambio: 1,
            valor_original: valorAlocado,
            valor_brl: valorAlocado,
            allocation_source: alloc.source,
            source_table: "omie_imports",
            categoria_origem: cat,
            fornecedor,
            documento: r.numero_documento || "",
            descricao: catDesc,
          });

          // VARIÁVEL: só custos variáveis vão pro produto
          // Fixos vão como "período" (business_line_id = null)
          results.push({
            company_id: imp.company_id,
            periodo,
            business_line_id: classification.cost_behavior === "variavel"
              ? alloc.business_line_id
              : null, // fixos → período (não alocado ao produto)
            cost_group: classification.cost_group,
            cost_nature: classification.cost_nature,
            cost_behavior: classification.cost_behavior,
            costing_method: "variavel",
            valor: valorAlocado,
            moeda: "BRL",
            taxa_cambio: 1,
            valor_original: valorAlocado,
            valor_brl: valorAlocado,
            allocation_source: classification.cost_behavior === "variavel"
              ? alloc.source
              : "custo_periodo",
            source_table: "omie_imports",
            categoria_origem: cat,
            fornecedor,
            documento: r.numero_documento || "",
            descricao: catDesc,
          });
        }
      }
    }

    // ═══ 4. PROCESSAR CONTAS A RECEBER (RECEITAS) ═══

    for (const imp of imports) {
      if (imp.import_type !== "contas_receber") continue;

      const regs = imp.import_data?.conta_receber_cadastro || [];
      if (!Array.isArray(regs)) continue;

      for (const r of regs) {
        const status = (r.status_titulo || "").toUpperCase().trim();
        if (STATUS_EXCLUIDOS.has(status)) continue;

        const valor = Number(r.valor_documento) || 0;
        if (valor <= 0) continue;

        const dt = r.data_previsao || r.data_vencimento || r.data_emissao || "";
        const per = parsePeriodo(dt);
        if (!per || per !== periodo) continue;

        const cat = getCategoriaOmie(r);
        const catDesc = catMap[cat] || r.descricao_categoria || cat;
        const codCF = String(r.codigo_cliente_fornecedor || r.codigo_cliente || "");
        const cliente = r.nome_cliente || nomeMap[codCF] || `Cliente ${codCF}`;

        // Receitas: alocar por linha de negócio via distribuição
        const allocations = resolveAllocation(r, imp.company_id, centerMaps, catMap);

        for (const alloc of allocations) {
          const valorAlocado = valor * (alloc.allocation_pct / 100);

          // Receita é igual em absorção e variável
          for (const method of ["absorcao", "variavel"] as const) {
            results.push({
              company_id: imp.company_id,
              periodo,
              business_line_id: alloc.business_line_id,
              cost_group: "receita",
              cost_nature: "direto",
              cost_behavior: "variavel",
              costing_method: method,
              valor: valorAlocado,
              moeda: "BRL",
              taxa_cambio: 1,
              valor_original: valorAlocado,
              valor_brl: valorAlocado,
              allocation_source: alloc.source,
              source_table: "omie_imports",
              categoria_origem: cat,
              fornecedor: cliente,
              documento: r.numero_documento || "",
              descricao: catDesc,
            });
          }
        }
      }
    }

    // ═══ 5. SALVAR EM BATCH ═══

    const batchSize = 500;
    let savedCount = 0;

    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);
      const { error } = await supabase.from("cost_allocations").insert(batch);
      if (error) {
        console.error("Erro ao salvar batch:", error.message);
      } else {
        savedCount += batch.length;
      }
    }

    // ═══ 6. GERAR RESUMO ═══

    // Absorção: DRE por linha de negócio
    const resumoAbsorcao: Record<string, Record<string, number>> = {};
    for (const r of results) {
      if (r.costing_method !== "absorcao") continue;
      const bl = r.business_line_id || "nao_alocado";
      if (!resumoAbsorcao[bl]) resumoAbsorcao[bl] = {};
      resumoAbsorcao[bl][r.cost_group] = (resumoAbsorcao[bl][r.cost_group] || 0) + r.valor;
    }

    // Variável: Margem de contribuição por linha
    const resumoVariavel: Record<string, { receita: number; variavel: number; mc: number }> = {};
    for (const r of results) {
      if (r.costing_method !== "variavel") continue;
      const bl = r.business_line_id || "nao_alocado";
      if (!resumoVariavel[bl]) resumoVariavel[bl] = { receita: 0, variavel: 0, mc: 0 };
      if (r.cost_group === "receita") {
        resumoVariavel[bl].receita += r.valor;
      } else if (r.cost_behavior === "variavel" && r.business_line_id) {
        resumoVariavel[bl].variavel += r.valor;
      }
    }
    for (const bl of Object.keys(resumoVariavel)) {
      resumoVariavel[bl].mc = resumoVariavel[bl].receita - resumoVariavel[bl].variavel;
    }

    // Buscar nomes das linhas
    const { data: blNames } = await supabase
      .from("business_lines")
      .select("id, name")
      .in("company_id", company_ids);

    const blNameMap: Record<string, string> = {};
    if (blNames) for (const bl of blNames) blNameMap[bl.id] = bl.name;

    const duracao = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      periodo,
      duracao_ms: duracao,
      audit,
      registros_salvos: savedCount,
      resumo_absorcao: Object.entries(resumoAbsorcao).map(([bl, groups]) => ({
        linha: blNameMap[bl] || (bl === "nao_alocado" ? "Não Alocado" : bl),
        ...groups,
        total_custos: Object.entries(groups)
          .filter(([k]) => k !== "receita")
          .reduce((s, [, v]) => s + v, 0),
        resultado: (groups.receita || 0) - Object.entries(groups)
          .filter(([k]) => k !== "receita")
          .reduce((s, [, v]) => s + v, 0),
      })),
      resumo_variavel: Object.entries(resumoVariavel).map(([bl, data]) => ({
        linha: blNameMap[bl] || (bl === "nao_alocado" ? "Não Alocado / Custos Fixos" : bl),
        receita: data.receita,
        custos_variaveis: data.variavel,
        margem_contribuicao: data.mc,
        mc_pct: data.receita > 0 ? ((data.mc / data.receita) * 100).toFixed(1) + "%" : "0%",
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
