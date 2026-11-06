-- P&M · Catálogo de Serviços (/dashboard/pm/servicos) · RD-98 pilar 4 (exclusão rastreável)
-- PDCA auditor_pdca_2: agency_servico NÃO tinha deleted_at e fn_agency_servico_excluir fazia DELETE FÍSICO quando o
-- serviço não estava em uso — exclusão não rastreável (sem "quem excluiu", sem audit, sem filtro na listagem).
-- Esta migration é ADITIVA: acrescenta deleted_at/deleted_by + índice, transforma o DELETE físico em SOFT-DELETE
-- com audit_log_global (RD-98 p4), e faz a listagem ignorar os excluídos. Nenhuma tabela/policy/grant existente é
-- removida; o caminho "em uso" (desativar) continua igual, agora também auditado. Dado de cliente nunca é apagado.

-- (1) camada de exclusão rastreável na tabela ------------------------------------------------------------------
ALTER TABLE public.agency_servico ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.agency_servico ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- índice dos serviços vivos (listagem filtra deleted_at IS NULL por empresa)
CREATE INDEX IF NOT EXISTS idx_agency_servico_vivos
  ON public.agency_servico (company_id) WHERE deleted_at IS NULL;

-- (2) exclusão vira soft-delete rastreável -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agency_servico_excluir(p_company_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uso boolean; v_uid uuid := auth.uid(); v_s public.agency_servico%ROWTYPE;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);

  SELECT * INTO v_s FROM public.agency_servico
   WHERE id = p_id AND company_id = p_company_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'servico_nao_encontrado'; END IF;

  v_uso := EXISTS (SELECT 1 FROM public.agency_contrato_itens ci WHERE ci.servico_id = p_id)
        OR EXISTS (SELECT 1 FROM public.agency_jobs j WHERE j.servico_id = p_id)
        OR EXISTS (SELECT 1 FROM public.agency_pacote_item pi WHERE pi.servico_item_id = p_id)
        OR EXISTS (SELECT 1 FROM public.agency_propostas ap, jsonb_array_elements(COALESCE(ap.itens,'[]'::jsonb)) it
                   WHERE ap.company_id = p_company_id AND it->>'servico_id' = p_id::text);

  IF v_uso THEN
    -- serviço em uso: não some do histórico, apenas é desativado (como antes), agora rastreado
    UPDATE public.agency_servico SET ativo = false, atualizado_em = now()
     WHERE id = p_id AND company_id = p_company_id;
    INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid), 'agency_servico', p_id::text,
            'servico_desativado_em_uso',
            jsonb_build_object('nome', v_s.nome, 'tipo', v_s.tipo, 'ativo', v_s.ativo),
            jsonb_build_object('ativo', false, 'motivo', 'em_uso'));
    RETURN jsonb_build_object('ok', true, 'modo', 'desativado', 'motivo', 'em_uso');
  END IF;

  -- não está em uso: SOFT-DELETE rastreável (antes era DELETE físico — RD-98 p4)
  UPDATE public.agency_servico
     SET deleted_at = now(), deleted_by = v_uid, ativo = false, atualizado_em = now()
   WHERE id = p_id AND company_id = p_company_id;
  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid), 'agency_servico', p_id::text,
          'servico_excluido',
          jsonb_build_object('nome', v_s.nome, 'tipo', v_s.tipo, 'ativo', v_s.ativo),
          jsonb_build_object('deleted_at', now(), 'deleted_by', v_uid));
  RETURN jsonb_build_object('ok', true, 'modo', 'excluido');
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_agency_servico_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_agency_servico_excluir(uuid, uuid) TO authenticated;

-- (3) listagem ignora os excluídos -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agency_servico_listar(p_company_id uuid, p_incluir_inativos boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_agency_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'responsavel_nome', (SELECT e.nome FROM public.agency_equipe e WHERE e.id = s.responsavel_padrao_id),
      'pacote_itens', COALESCE((SELECT jsonb_agg(jsonb_build_object('servico_item_id', pi.servico_item_id, 'quantidade', pi.quantidade,
                        'nome', (SELECT s2.nome FROM public.agency_servico s2 WHERE s2.id=pi.servico_item_id)))
                        FROM public.agency_pacote_item pi WHERE pi.pacote_id = s.id), '[]'::jsonb),
      'usos', (SELECT count(*) FROM public.agency_contrato_itens ci WHERE ci.servico_id = s.id)
             + (SELECT count(*) FROM public.agency_jobs j WHERE j.servico_id = s.id)
    ) ORDER BY s.ordem, s.nome), '[]'::jsonb) INTO v
    FROM public.agency_servico s
   WHERE s.company_id = p_company_id AND s.deleted_at IS NULL AND (p_incluir_inativos OR s.ativo);
  RETURN jsonb_build_object('ok', true, 'servicos', v);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_agency_servico_listar(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_agency_servico_listar(uuid, boolean) TO authenticated;
