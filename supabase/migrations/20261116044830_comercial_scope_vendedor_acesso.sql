-- SEGURANÇA/LGPD (CEO 13/11/2026, tarefa 52d96e50) — escopo de VENDEDOR no painel comercial, fail-closed.
--
-- Problema: fn_bi_comercial_scope lia o código do vendedor de `bi_comercial_vendedor` (tabela VAZIA, sem tela que
-- a alimente). A tela "Administração › Vendedores" e as RPCs (fn_com_vendedor_acesso_listar/_salvar) já existem e
-- gravam em `com_vendedor_acesso`, mas o ESCOPO nunca foi ligado a ela. Resultado: para dar acesso ao painel a um
-- vendedor hoje, só havia o caminho de papel de gestor (CLIENT_MANAGER/diretor), que cai em modo 'lider' e mostra
-- a EMPRESA INTEIRA — vazamento (todas as vendas, todos os vendedores, faturamento total).
--
-- Correção (mínima e cirúrgica): fn_bi_comercial_scope passa a ler o vínculo login↔código de `com_vendedor_acesso`
-- (só `ativo`). FAIL-CLOSED: usuário NÃO-líder sem vínculo ativo => 'sem_acesso' (vê NADA — nunca a empresa toda).
-- Líder/admin/sócio seguem com acesso total (lógica inalterada, precedência mantida). Todos os consumidores do
-- escopo (base, kpis, pareto, série, análise, metas, ranking) já leem `modo`/`cod` — nada mais muda.
-- `bi_comercial_vendedor` está com 0 linhas em toda a base; a troca não causa regressão.
-- Modelo atual: 1 código por login (única por company_id+user_id em com_vendedor_acesso / ON CONFLICT no _salvar),
-- que é o caso do CEO (liberar um vendedor para ver só a própria venda).

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_scope(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_cod text; v_lider boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('modo', 'sem_acesso'); END IF;
  v_lider := public.is_admin() OR EXISTS (
    SELECT 1 FROM tenant_user_roles r
     WHERE r.user_id = v_uid AND r.company_id = p_company_id AND COALESCE(r.is_active, true)
       AND (r.role IN ('CLIENT_OWNER','CLIENT_MANAGER')
            OR r.observacao ILIKE '%diretor_vendas%' OR r.observacao ILIKE '%assistente_vendas%'));
  -- Vínculo login↔código vem da tela Administração › Vendedores (com_vendedor_acesso, só ativo).
  SELECT a.codigo INTO v_cod
    FROM public.com_vendedor_acesso a
   WHERE a.user_id = v_uid AND a.company_id = p_company_id AND a.ativo = true
   ORDER BY a.atualizado_em DESC NULLS LAST
   LIMIT 1;
  -- Líder tem precedência (nunca fica restrito por acaso); depois vendedor mapeado; senão NADA (fail-closed).
  IF v_lider THEN RETURN jsonb_build_object('modo', 'lider');
  ELSIF v_cod IS NOT NULL THEN RETURN jsonb_build_object('modo', 'vendedor', 'cod', v_cod);
  ELSE RETURN jsonb_build_object('modo', 'sem_acesso'); END IF;
END $function$;

-- Grants (gate check-fn-guards): re-afirma o padrão da função SECURITY DEFINER. anon NUNCA executa.
REVOKE ALL ON FUNCTION public.fn_bi_comercial_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_scope(uuid) TO authenticated, service_role;
