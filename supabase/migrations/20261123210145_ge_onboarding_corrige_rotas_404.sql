-- GE · /dashboard/gestao-empresarial/implantacao · PDCA (auditor_pdca_2, BLOQUEADO)
-- 2 dos 5 botoes do wizard de onboarding levam a 404 (quebra a 1a jornada do cliente GE):
--   passo 2 "Importe seus lancamentos": rota_acao '/dashboard/importer-universal' (typo en)
--     -> rota REAL '/dashboard/importar-universal' (src/app/dashboard/importar-universal/page.tsx)
--   passo 3 "Cadastre seus contratos recorrentes": rota_acao '/dashboard/contratos-recorrentes'
--     -> rota REAL '/dashboard/cadastros/contratos-recorrentes'
-- CREATE OR REPLACE corrigindo SO os 2 literais de rota. Logica de completude INTACTA.
-- RD-38: rotas reais conferidas no repo (page.tsx existem); as com typo nao existem.
-- Code: desenvolvedor_4_g

CREATE OR REPLACE FUNCTION public.fn_ge_onboarding_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_nome text;
  v_tem_plano boolean;
  v_passo_1_contas boolean;
  v_passo_2_lancamentos boolean;
  v_passo_3_contratos boolean;
  v_passo_4_categorias boolean;
  v_passo_5_dre boolean;
  v_total_completos int;
  v_pct_completo numeric;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('erro', true, 'mensagem', 'Selecione uma empresa para acessar a Gestão Empresarial');
  END IF;

  SELECT razao_social INTO v_empresa_nome FROM companies WHERE id = p_company_id;
  IF v_empresa_nome IS NULL THEN
    RETURN jsonb_build_object('erro', true, 'mensagem', 'Empresa não encontrada');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) INTO v_tem_plano;

  IF NOT v_tem_plano THEN
    RETURN jsonb_build_object('sem_plano', true, 'empresa_nome', v_empresa_nome,
      'mensagem', 'Empresa não tem plano Gestão Empresarial ativo');
  END IF;

  v_passo_1_contas := EXISTS (SELECT 1 FROM erp_banco_contas WHERE company_id = p_company_id);
  v_passo_2_lancamentos := EXISTS (SELECT 1 FROM erp_lancamentos WHERE company_id = p_company_id);
  v_passo_3_contratos := EXISTS (SELECT 1 FROM erp_contratos WHERE company_id = p_company_id);

  -- Fix passo 4: erp_plano_contas (tabela correta) + threshold >= 1
  v_passo_4_categorias := EXISTS (SELECT 1 FROM erp_plano_contas WHERE company_id = p_company_id);

  v_passo_5_dre := EXISTS (SELECT 1 FROM m2_dre_divisional WHERE company_id = p_company_id);

  v_total_completos := (v_passo_1_contas::int + v_passo_2_lancamentos::int +
    v_passo_3_contratos::int + v_passo_4_categorias::int + v_passo_5_dre::int);
  v_pct_completo := ROUND((v_total_completos * 100.0) / 5, 0);

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'empresa_nome', v_empresa_nome,
    'sem_plano', false,
    'onboarding_completo', v_total_completos = 5,
    'total_passos', 5,
    'passos_completos', v_total_completos,
    'pct_completo', v_pct_completo,
    'passos', jsonb_build_array(
      jsonb_build_object('numero', 1, 'titulo', 'Cadastre suas contas bancárias',
        'descricao', 'Quais bancos sua empresa usa? Santander, Inter, Sicoob... O sistema vai mostrar seus saldos aqui.',
        'icone', 'building-bank', 'rota_acao', '/dashboard/cadastros/contas-bancarias',
        'completo', v_passo_1_contas),
      jsonb_build_object('numero', 2, 'titulo', 'Importe seus lançamentos',
        'descricao', 'Suba uma planilha (Excel/CSV) ou arquivo OFX do banco. Ou cadastre manualmente.',
        'icone', 'file-upload', 'rota_acao', '/dashboard/importar-universal',
        'completo', v_passo_2_lancamentos),
      jsonb_build_object('numero', 3, 'titulo', 'Cadastre seus contratos recorrentes',
        'descricao', 'Aluguéis, mensalidades, contratos de serviço. O sistema gera as cobranças automaticamente todo mês.',
        'icone', 'repeat', 'rota_acao', '/dashboard/cadastros/contratos-recorrentes',
        'completo', v_passo_3_contratos),
      jsonb_build_object('numero', 4, 'titulo', 'Organize suas categorias contábeis',
        'descricao', 'Classifique suas receitas e despesas (Aluguel, Fornecedores, Vendas...). O sistema sugere as padrões.',
        'icone', 'tags', 'rota_acao', '/dashboard/cadastros/plano-contas',
        'completo', v_passo_4_categorias),
      jsonb_build_object('numero', 5, 'titulo', 'Configure seu DRE por área',
        'descricao', 'Sua empresa tem várias linhas de negócio? (Ex: Tintas, Gesso, Imóveis). Veja performance separada por área.',
        'icone', 'chart-pie', 'rota_acao', '/dashboard/dre-divisional/configurar',
        'completo', v_passo_5_dre, 'opcional', true)
    )
  );
END;
$function$;
