-- RD-98 p4: inativação/exclusão de serviço do catálogo de produtividade
-- (src/components/projetos/ProdutividadePanel.tsx) rastreável no audit_log_global central, com o autor.
--
-- A fn_servico_excluir inativava o serviço (ativo=false) mas NÃO registrava quem o fez nem gravava na
-- trilha única public.audit_log_global. Agora grava o autor (auth.uid()) e o evento, espelhando o
-- padrão das demais exclusões do Hub.
--
-- Aditiva e segura: apenas CREATE OR REPLACE, mesma assinatura e mesmo comportamento (soft-delete via
-- ativo=false); acrescenta um único INSERT no audit_log_global apenas quando a linha foi de fato
-- inativada (FOUND). Guarda por company_id (get_user_company_ids) intacta.
CREATE OR REPLACE FUNCTION public.fn_servico_excluir(p_servico_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  UPDATE projetos_servicos SET ativo = false, updated_at = now()
   WHERE id = p_servico_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  -- RD-98 p4: trilha central de auditoria com o autor
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'projetos_servicos', p_servico_id, 'inativar',
            jsonb_build_object('ativo', false, 'em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- check_fn_guards regra 1: fecha a função ao anon (idempotente; CREATE OR REPLACE reabriria a régua)
REVOKE ALL ON FUNCTION public.fn_servico_excluir(uuid, uuid) FROM anon;
