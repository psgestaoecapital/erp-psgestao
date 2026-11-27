-- GE · Guia de Implantação (Primeiros passos) — passo 2 "Importe seus lançamentos" nunca ficava verde.
-- Bug (auditor_pdca_2, provado RD-38): fn_ge_onboarding_status marcava o passo 2 por
--   EXISTS (SELECT 1 FROM erp_lancamentos WHERE company_id = p_company_id)
-- mas erp_lancamentos está VAZIA no sistema inteiro (0 linhas) — o destino foi removido do importador.
-- O fluxo "Importe seus lançamentos" manda o usuário para /dashboard/importar-universal, que grava em
-- erp_receber/erp_pagar (TABELA_MAP) e, pelo despacho SIGA, fn_import_financeiro_v3 → erp_pagar/erp_receber;
-- o OFX do banco alimenta conciliacao_movimento. erp_lancamentos NUNCA é populada. Logo o passo 2 era
-- INALCANÇÁVEL: o onboarding travava em 80% (4/5) para toda empresa, para sempre.
--
-- PROVA NO DADO (RD-38, read-only):
--   DEMO GE b0700000-0000-4000-a000-000000000004: erp_receber=29, erp_pagar=121, conciliacao_movimento=14,
--   erp_lancamentos=0 → antes passo 2 = FALSE (onboarding 80%); depois passo 2 = TRUE (onboarding 100% com
--   os passos 1/3/4/5 já verdes). Sistema inteiro: erp_lancamentos total = 0.
--
-- CONSERTO (núcleo, genérico — serve a qualquer ramo): o passo 2 reflete o que o usuário REALMENTE cria ao
-- "importar lançamentos": tem contas a receber OU a pagar (não soft-deletadas) OU movimento de extrato
-- importado (OFX → conciliacao_movimento). Aditivo, sem DDL de estrutura, sem tocar dado de cliente.
-- Anti-regressão: mantém fn__guarda_empresa(p_company_id), a checagem de plano e todo o resto byte-idêntico.
-- SECURITY DEFINER só lê; ACL espelha a viva (authenticated + service_role; REVOKE anon).
-- Code: code-desenvolvedor-3

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

  -- Fix passo 2 (auditor_pdca_2, RD-38): o importador escreve em erp_receber/erp_pagar (e OFX em
  -- conciliacao_movimento), nunca em erp_lancamentos (tabela morta, 0 linhas no sistema). O passo fica
  -- verde quando o usuário de fato tem lançamentos importados/cadastrados.
  v_passo_2_lancamentos :=
         EXISTS (SELECT 1 FROM erp_receber WHERE company_id = p_company_id AND deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM erp_pagar   WHERE company_id = p_company_id AND deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM conciliacao_movimento WHERE company_id = p_company_id);

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

REVOKE ALL ON FUNCTION public.fn_ge_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_onboarding_status(uuid) TO authenticated, service_role;
