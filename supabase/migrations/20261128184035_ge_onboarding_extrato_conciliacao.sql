-- GE onboarding — passo "Importe seus lançamentos" passa a reconhecer o extrato importado por OFX.
-- Bug de honestidade de status (auditor_pdca_2 27/11, provado RD-38): o passo 2 do guia e o campo
-- extrato_lancamentos da home contavam SÓ erp_lancamentos (planilha-universal), que está vazia em todo o
-- sistema (0 linhas). Mas o import de OFX/extrato — exatamente o que o passo 2 manda fazer ("Suba... arquivo
-- OFX do banco") — grava em conciliacao_movimento, não em erp_lancamentos. Resultado: quem importa OFX volta
-- ao guia e o passo CONTINUA incompleto para sempre (a DEMO GE trava em 4/5 = 80%).
-- Prova DEMO GE b0700000-...-0004: erp_lancamentos=0, conciliacao_movimento=14 → com esta correção o passo
-- fica completo (como deve, critério c). Fontes: erp_lancamentos (planilha) OR conciliacao_movimento (OFX).
-- eh_madura NÃO muda (segue erp_pagar>=10; sem regressão da #4117). Só o display do passo de extrato muda.
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
  -- "Importei meu movimento": conta a planilha-universal (erp_lancamentos) OU o OFX/extrato (conciliacao_movimento).
  -- O passo manda importar OFX, que cai em conciliacao_movimento — por isso ele também completa o passo.
  v_passo_2_lancamentos := EXISTS (SELECT 1 FROM erp_lancamentos WHERE company_id = p_company_id)
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
  SELECT COUNT(*) INTO v_total_contas       FROM erp_banco_contas WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_clientes     FROM erp_clientes     WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_lancamentos  FROM erp_pagar        WHERE company_id = p_company_id;
  -- MESMA fonte do guia (fn_ge_onboarding_status passo 2): extrato importado por planilha (erp_lancamentos)
  -- OU por OFX (conciliacao_movimento). Antes contava só erp_lancamentos (vazia), travando o passo pela via OFX.
  SELECT (SELECT COUNT(*) FROM erp_lancamentos      WHERE company_id = p_company_id)
       + (SELECT COUNT(*) FROM conciliacao_movimento WHERE company_id = p_company_id)
    INTO v_total_extrato;
  SELECT COUNT(*) INTO v_total_orcamentos   FROM erp_orcamentos   WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'eh_madura', v_total_contas >= 1 AND v_total_clientes >= 3 AND v_total_lancamentos >= 10,
    'contas', v_total_contas,
    'clientes', v_total_clientes,
    'lancamentos', v_total_lancamentos,
    -- extrato bancário importado (planilha OU OFX): alinhado ao passo 2 do guia
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

-- ACL das funções SECURITY DEFINER recriadas (check_fn_guards): espelha a ACL viva
-- (authenticated + service_role; anon/PUBLIC revogados). CREATE OR REPLACE preserva a ACL — sem regressão de acesso.
REVOKE ALL ON FUNCTION public.fn_ge_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_onboarding_status(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_onboarding_maturidade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_maturidade(uuid) TO authenticated, service_role;
