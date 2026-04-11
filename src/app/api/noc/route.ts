import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = "https://horsymhsinqcimflrtjo.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

export async function GET(req: NextRequest) {
  try {
    const sb = createClient(supabaseUrl, supabaseKey);

    // 1. EMPRESAS
    const { data: companies } = await sb.from("companies").select("id, nome, created_at, omie_app_key");
    const totalEmpresas = companies?.length || 0;

    // 2. USUÁRIOS
    const { data: users } = await sb.from("users").select("id, email, role, last_sign_in_at, created_at, updated_at");
    const totalUsuarios = users?.length || 0;
    const porRole: Record<string, number> = {};
    (users || []).forEach((u: any) => { porRole[u.role] = (porRole[u.role] || 0) + 1; });

    // 3. IMPORTS (Omie/Nibo)
    const { data: imports } = await sb.from("omie_imports").select("company_id, import_type, record_count, imported_at");
    const totalImports = imports?.length || 0;
    const totalRegistros = (imports || []).reduce((s: number, i: any) => s + (i.record_count || 0), 0);
    const ultimaSync = imports?.length ? imports.sort((a: any, b: any) => b.imported_at?.localeCompare(a.imported_at || ""))[0] : null;

    // Agrupar por empresa
    const importsPorEmpresa: Record<string, { tipos: string[]; registros: number; ultimaSync: string }> = {};
    (imports || []).forEach((imp: any) => {
      if (!importsPorEmpresa[imp.company_id]) importsPorEmpresa[imp.company_id] = { tipos: [], registros: 0, ultimaSync: "" };
      importsPorEmpresa[imp.company_id].tipos.push(imp.import_type);
      importsPorEmpresa[imp.company_id].registros += imp.record_count || 0;
      if (imp.imported_at > (importsPorEmpresa[imp.company_id].ultimaSync || "")) importsPorEmpresa[imp.company_id].ultimaSync = imp.imported_at;
    });

    // 4. RELATÓRIOS IA
    const { data: aiReports } = await sb.from("ai_reports").select("id, company_id, report_type, created_at, metadata");
    const totalV19 = (aiReports || []).filter((r: any) => r.report_type === "v19_ceo").length;
    const totalRelatorios = aiReports?.length || 0;

    // 5. BPO
    const { data: bpoExec } = await sb.from("bpo_execucoes").select("id, company_id, created_at, status");
    const totalBpoRuns = bpoExec?.length || 0;
    const { data: bpoClass } = await sb.from("bpo_classificacoes").select("id, company_id, status");
    const totalClassificacoes = bpoClass?.length || 0;

    // 6. USER_COMPANIES (atribuições)
    const { data: userCompanies } = await sb.from("user_companies").select("user_id, company_id");

    // 7. FINANCIAMENTOS
    const { data: financiamentos } = await sb.from("financiamentos").select("id, company_id");

    // 8. WEALTH
    const { data: wealthClients } = await sb.from("wealth_clients").select("id").limit(1000);
    const { data: wealthAssets } = await sb.from("wealth_assets").select("id").limit(1000);

    // 9. ORÇAMENTO
    const { data: orcamentos } = await sb.from("orcamento").select("id, company_id");

    // 10. PLANO DE AÇÃO
    const { data: planoAcao } = await sb.from("plano_acao").select("id, company_id, status");

    // ═══ MONTAR DADOS POR EMPRESA ═══
    const empresasDetalhe = (companies || []).map((c: any) => {
      const imp = importsPorEmpresa[c.id] || { tipos: [], registros: 0, ultimaSync: "" };
      const reports = (aiReports || []).filter((r: any) => r.company_id === c.id);
      const bpo = (bpoExec || []).filter((b: any) => b.company_id === c.id);
      const usersEmpresa = (userCompanies || []).filter((uc: any) => uc.company_id === c.id);
      return {
        id: c.id,
        nome: c.nome || "Sem nome",
        criadoEm: c.created_at,
        temOmie: !!c.omie_app_key,
        tiposImport: imp.tipos,
        registrosImportados: imp.registros,
        ultimaSync: imp.ultimaSync,
        v19Gerados: reports.filter((r: any) => r.report_type === "v19_ceo").length,
        relatoriosTotal: reports.length,
        bpoRuns: bpo.length,
        usuariosVinculados: usersEmpresa.length,
      };
    });

    // ═══ SAÚDE DOS SERVIÇOS (check rápido) ═══
    const servicos = [];

    // Supabase — se chegou até aqui, está online
    servicos.push({ nome: "Supabase (PostgreSQL)", status: "online", detalhe: `${totalEmpresas} empresas, ${totalRegistros} registros` });

    // Vercel — se está respondendo, está online
    servicos.push({ nome: "Vercel (Aplicação)", status: "online", detalhe: "Respondendo normalmente" });

    // Anthropic — check se key existe
    const temAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    servicos.push({ nome: "Anthropic Claude API", status: temAnthropicKey ? "configurado" : "sem chave", detalhe: temAnthropicKey ? `${totalV19} V19 gerados` : "ANTHROPIC_API_KEY não configurada" });

    // GitHub — check se token existe
    const temGithubToken = !!process.env.GITHUB_TOKEN;
    servicos.push({ nome: "GitHub (Deploy)", status: temGithubToken ? "configurado" : "sem token", detalhe: temGithubToken ? "Deploy automático ativo" : "GITHUB_TOKEN não configurado" });

    // ═══ RESPOSTA ═══
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      resumo: {
        empresas: totalEmpresas,
        usuarios: totalUsuarios,
        usuariosPorRole: porRole,
        registrosImportados: totalRegistros,
        tiposImport: totalImports,
        v19Gerados: totalV19,
        relatoriosTotal: totalRelatorios,
        bpoRuns: totalBpoRuns,
        classificacoesBpo: totalClassificacoes,
        financiamentos: financiamentos?.length || 0,
        wealthClientes: wealthClients?.length || 0,
        wealthAtivos: wealthAssets?.length || 0,
        orcamentos: orcamentos?.length || 0,
        planosAcao: planoAcao?.length || 0,
        atribuicoesUsuario: userCompanies?.length || 0,
        ultimaSync: ultimaSync?.imported_at || null,
      },
      servicos,
      empresas: empresasDetalhe,
      usuarios: (users || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        ultimoLogin: u.last_sign_in_at || u.updated_at,
        criadoEm: u.created_at,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
