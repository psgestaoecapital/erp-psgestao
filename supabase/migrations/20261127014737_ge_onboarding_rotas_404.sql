-- GE · JORNADA 1 (primeiros passos de empresa nova) · correção de 2 rotas 404 no onboarding
-- Code: code-desenvolvedor-3
--
-- Problema (PDCA GE · auditor_pdca_2, PROVADO no dado · DEMO GE b0700000-0000-4000-a000-000000000004):
-- A tela /dashboard/gestao-empresarial/implantacao (OnboardingFiveSteps) renderiza 5 cards cujo botão
-- "Começar" faz router.push(passo.rota_acao). DUAS das 5 rota_acao devolvidas por fn_ge_onboarding_status
-- apontavam para rotas que NÃO existem no app (404) — inclusive o passo 2, o único passo incompleto do
-- onboarding da DEMO. O usuário novo clicava exatamente no passo que precisa concluir e caía em 404.
--
--   · passo 2 "Importe seus lançamentos": '/dashboard/importer-universal' (inglês, não existe)
--        → rota correta: '/dashboard/importar-universal' (src/app/dashboard/importar-universal/page.tsx EXISTE)
--   · passo 3 "Cadastre seus contratos recorrentes": '/dashboard/contratos-recorrentes' (não existe)
--        → rota correta: '/dashboard/cadastros/contratos-recorrentes' (EXISTE)
--
-- As outras 3 rotas estão OK e NÃO são tocadas: /dashboard/cadastros/contas-bancarias,
-- /dashboard/cadastros/plano-contas, /dashboard/dre-divisional/configurar.
--
-- Esta migration é um CREATE OR REPLACE superset puro do corpo VIVO (lido com pg_get_functiondef, RD-38):
-- muda APENAS as 2 strings de rota. Nenhuma coluna/tabela/assinatura/cálculo alterado; função só-leitura
-- (SECURITY DEFINER com fn__guarda_empresa no topo). ACL preservada (authenticated + service_role, sem anon).
--
-- RD-38 (prova antes/depois do PR):
--   ANTES  → passos[1].rota_acao = '/dashboard/importer-universal'      (404)
--            passos[2].rota_acao = '/dashboard/contratos-recorrentes'   (404)
--   DEPOIS → passos[1].rota_acao = '/dashboard/importar-universal'      (200, page.tsx existe)
--            passos[2].rota_acao = '/dashboard/cadastros/contratos-recorrentes' (200, page.tsx existe)
--   As demais 3 rotas ficam idênticas; pct_completo e o restante do contrato inalterados.

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

-- Guarda da função SECURITY DEFINER (check_fn_guards): fecha chamada RPC direta por anon e
-- reafirma o acesso só de quem está logado. CREATE OR REPLACE preserva grants; REVOKE anon explícito.
-- ACL viva preservada: authenticated=X, service_role=X (sem anon).
REVOKE ALL ON FUNCTION public.fn_ge_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_onboarding_status(uuid) TO authenticated, service_role;
