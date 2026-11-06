-- Hub · /dashboard/projetos/visitas — delta até 95 (aud8/Max 27/10, caixa 3dd26f79 · Code: desenvolvedor_4_g)
-- Foto DEMO 0006 12:43Z: nota 70. RD-95 já coberto (busca, filtro_status, KPIs ind_*, registro_local,
-- fotos_arquivos, proximo_passo, acoes com "?"). O fluxo de fotos/anexos existe (painel "Fotos e arquivos (N)");
-- o (0) na DEMO é semente vazia, não falta de recurso. Deltas de dado/feature:
--   RD-98 pilar 3 (ORIGEM): a rota estava sem system_screens.views_consumidas/rpcs_chamadas (vazios).
--   RD-98 pilar 4 (EXCLUSÃO RASTREÁVEL): a visita não tinha como ser excluída de forma rastreável.
--     Acrescenta soft-delete (deleted_at/excluido_por) + RPCs guardadas fn_crm_visita_excluir/_restaurar
--     (auth + empresa, desfazer 15 min só por quem excluiu, audit_log_global); a lista filtra deleted_at IS NULL;
--     nunca DELETE físico.
--
-- Migration ADITIVA (RD-94.1 c): colunas/índice/funções NOVOS + dados de ajuda + metadados de system_screens;
-- nenhuma função/RLS/view existente tocada, nenhum dado de cliente apagado.

ALTER TABLE public.erp_crm_visita
  ADD COLUMN IF NOT EXISTS deleted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE INDEX IF NOT EXISTS idx_crm_visita_vivas
  ON public.erp_crm_visita (company_id, data_visita DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_crm_visita_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id INTO v_company FROM public.erp_crm_visita WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Visita não encontrada ou já excluída'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.erp_crm_visita SET deleted_at = now(), excluido_por = auth.uid() WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_crm_visita', p_id, 'excluir', jsonb_build_object('deleted_at', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_crm_visita_restaurar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.erp_crm_visita%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para desfazer'); END IF;
  SELECT * INTO v FROM public.erp_crm_visita WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.deleted_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Visita não está excluída'); END IF;
  IF v.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.excluido_por IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só quem excluiu pode desfazer'); END IF;
  IF v.deleted_at < now() - interval '15 minutes' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Passou o prazo de 15 minutos para desfazer'); END IF;
  UPDATE public.erp_crm_visita SET deleted_at = NULL, excluido_por = NULL WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_crm_visita_excluir(uuid)   FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_crm_visita_restaurar(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_crm_visita_excluir(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crm_visita_restaurar(uuid) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Visitas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/projetos/visitas', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.visitas.excluir','Excluir visita','Não se preenche. É a ação de remover a visita da lista.','Tira a visita da lista; não some de vez — fica recuperável por 15 minutos pelo "Desfazer", com quem excluiu e quando registrados.','Excluir uma visita duplicada','Achar que apaga para sempre: é exclusão reversível (soft-delete), nunca exclusão física.',801),
 ('projetos.visitas.desfazer_exclusao','Desfazer exclusão','Não se preenche. É o atalho para trazer a visita de volta.','Recupera a última visita excluída, dentro de 15 minutos, só por quem a excluiu.','Cliquei em Excluir sem querer → Desfazer','Esperar demais: passados 15 minutos o Desfazer não vale mais.',802)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical, status = EXCLUDED.status;

-- RD-98 p3: origem do dado de src/app/dashboard/projetos/visitas/page.tsx (grep: .from + .rpc)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'erp_crm_visita',        -- visitas (filtra deleted_at IS NULL)
        'erp_crm_anexo',         -- fotos/arquivos por visita (filtra deleted_at)
        'erp_crm_oportunidade',  -- oportunidade/obra/cliente da visita (join)
        'erp_clientes'           -- cliente da oportunidade (join)
       ]::text[],
       rpcs_chamadas = ARRAY[
        'fn_crm_visita_salvar',    -- criar/editar visita e registrar local (GPS)
        'fn_crm_visita_excluir',   -- exclusão rastreável (RD-98 p4)
        'fn_crm_visita_restaurar', -- desfazer exclusão (15 min)
        'fn_usuarios_da_empresa'   -- responsável/vendedor (nomes)
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/visitas';
