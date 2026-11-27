-- PDCA GE · /dashboard/gestao-empresarial (home) + /dashboard/gestao-empresarial/implantacao (guia)
-- RAIZ (adendo auditor_pdca_2 27/11, provado no dado — RD-38):
--   `erp_lancamentos` está VAZIA sistema-wide (0 linhas). Os lançamentos reais (OFX/extrato do banco)
--   caem em `conciliacao_movimento`; planilha/CSV e manual caem em `erp_pagar`/`erp_receber`.
--   Por isso o passo 2 do guia ("Importe seus lançamentos"), que conferia `erp_lancamentos`, NUNCA
--   completava — e contradizia a home: DEMO GE mostrava 100% "madura" na home e 80% (passo 2 incompleto)
--   no guia, para a MESMA empresa.
--
-- PROVA (DEMO GE b0700000-0000-4000-a000-000000000004, HEAD atual):
--   erp_lancamentos = 0   |   conciliacao_movimento = 14   |   erp_pagar = 214124   |   erp_receber = 115760
--   fn_ge_onboarding_status → passo 2 = false, pct = 80 (único passo incompleto).
--   Com a fonte real, passo 2 = true → pct = 100 (contradição resolvida, critério c/e do PDCA).
--
-- CORREÇÃO (aditiva, só medição; não altera dado de cliente nem estrutura):
--   1) fn_ge_onboarding_status: passo 2 completa quando a empresa tem QUALQUER lançamento importado
--      — extrato bancário (conciliacao_movimento), contas a pagar/receber (planilha/manual) ou a
--      tabela legada erp_lancamentos (compat). Igual à intenção do próprio passo ("planilha/OFX ou manual").
--   2) fn_onboarding_maturidade: o campo `extrato_lancamentos` ("extrato bancário importado") passa a
--      contar `conciliacao_movimento` (onde o OFX de fato cai), mantendo verdadeira a invariante do #6375
--      ("mesma fonte do guia"). `eh_madura` INALTERADO (erp_pagar >= 10) — não regride #4117.

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

  -- RAIZ (adendo 27/11): lançamentos reais caem em conciliacao_movimento (OFX/extrato),
  -- erp_pagar/erp_receber (planilha/manual) ou erp_lancamentos (legado). erp_lancamentos está
  -- vazia sistema-wide, então conferir só ela nunca completava. Conferir as fontes reais.
  v_passo_2_lancamentos :=
       EXISTS (SELECT 1 FROM conciliacao_movimento WHERE company_id = p_company_id)
    OR EXISTS (SELECT 1 FROM erp_pagar            WHERE company_id = p_company_id)
    OR EXISTS (SELECT 1 FROM erp_receber          WHERE company_id = p_company_id)
    OR EXISTS (SELECT 1 FROM erp_lancamentos      WHERE company_id = p_company_id);

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

CREATE OR REPLACE FUNCTION public.fn_onboarding_maturidade(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_contas int;
  v_total_clientes int;
  v_total_lancamentos int;
  v_total_extrato int;
  v_total_orcamentos int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT COUNT(*) INTO v_total_contas       FROM erp_banco_contas     WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_clientes     FROM erp_clientes         WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_lancamentos  FROM erp_pagar            WHERE company_id = p_company_id;
  -- extrato bancário importado = OFX/extrato do banco, que cai em conciliacao_movimento
  -- (erp_lancamentos está vazia sistema-wide; contar ela daria sempre 0). Mantém a invariante
  -- do #6375 ("mesma fonte do guia"): o passo 2 do guia também passa a considerar essa fonte.
  SELECT COUNT(*) INTO v_total_extrato      FROM conciliacao_movimento WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_orcamentos   FROM erp_orcamentos       WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'eh_madura', v_total_contas >= 1 AND v_total_clientes >= 3 AND v_total_lancamentos >= 10,
    'contas', v_total_contas,
    'clientes', v_total_clientes,
    'lancamentos', v_total_lancamentos,
    -- extrato bancário importado (conciliacao_movimento) — mesma fonte real que o guia confere
    'extrato_lancamentos', v_total_extrato,
    'orcamentos', v_total_orcamentos,
    'pct_maturidade', LEAST(100,
      ((LEAST(v_total_contas,1)::float / 1 * 33) +
       (LEAST(v_total_clientes,3)::float / 3 * 33) +
       (LEAST(v_total_lancamentos,10)::float / 10 * 34))::int
    )
  );
END;
$function$;
