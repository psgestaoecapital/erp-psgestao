import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const context: any = { timestamp: new Date().toISOString(), sections: {} };

    // 1. Listar todas as tabelas do banco
    const { data: tables } = await supabase.rpc('get_tables_info').maybeSingle();
    // Fallback: query known tables
    const knownTables = [
      'empresas', 'lancamentos', 'usuarios', 'linhas_negocio', 'lancamentos_linhas',
      'assessorias', 'assessoria_usuarios', 'clientes_assessoria', 'diagnosticos',
      'diagnostico_curvas_abc', 'diagnostico_imports',
      'modulos_sistema', 'permissoes_nivel', 'planos_licenca', 'planos_modulos',
      'ind_unidades', 'ind_turnos', 'ind_apontamentos_bovinos', 'ind_lotes_animais',
      'ind_custos_turno', 'ind_qualidade_sif', 'ind_kpis_diarios', 'ind_alertas_ceo',
      'contador_escritorios', 'contador_convites', 'contador_api_keys'
    ];

    const tableStats: any[] = [];
    for (const t of knownTables) {
      try {
        const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
        if (count !== null) tableStats.push({ tabela: t, registros: count });
      } catch(e) {}
    }
    context.sections.tabelas = tableStats;

    // 2. Empresas cadastradas
    const { data: empresas } = await supabase.from('empresas').select('id, nome, cnpj, status').order('nome');
    context.sections.empresas = empresas || [];

    // 3. Módulos do sistema
    const { data: modulos } = await supabase.from('modulos_sistema').select('id, nome, grupo, ativo').order('ordem');
    context.sections.modulos = modulos || [];

    // 4. Assessorias
    try {
      const { data: assessorias } = await supabase.from('assessorias').select('id, nome, plano, status, max_clientes');
      context.sections.assessorias = assessorias || [];
    } catch(e) { context.sections.assessorias = []; }

    // 5. Planos de licença
    try {
      const { data: planos } = await supabase.from('planos_licenca').select('id, nome, preco_min, preco_max');
      context.sections.planos = planos || [];
    } catch(e) { context.sections.planos = []; }

    // 6. Linhas de negócio
    try {
      const { data: linhas } = await supabase.from('linhas_negocio').select('id, nome, empresa_id');
      context.sections.linhas_negocio = linhas || [];
    } catch(e) { context.sections.linhas_negocio = []; }

    // 7. Diagnósticos recentes
    try {
      const { data: diags } = await supabase.from('diagnosticos').select('id, titulo, status, created_at, clientes_assessoria(nome)').order('created_at', { ascending: false }).limit(5);
      context.sections.diagnosticos_recentes = diags || [];
    } catch(e) { context.sections.diagnosticos_recentes = []; }

    // 8. Contagem geral
    context.sections.resumo = {
      total_tabelas: tableStats.length,
      total_registros: tableStats.reduce((s: number, t: any) => s + t.registros, 0),
      total_empresas: (empresas || []).length,
      total_modulos: (modulos || []).length,
    };

    return NextResponse.json(context);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
