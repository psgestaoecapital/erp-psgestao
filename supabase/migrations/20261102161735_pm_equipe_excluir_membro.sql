-- PDCA P&M (auditor_pdca_2) · /dashboard/pm/equipe · RD-98 pilar 4 (exclusão RASTREÁVEL de membro) + RD-95 "?".
--
-- Hoje a tela só tem incluir/alterar (e um toggle "Ativo"); não há EXCLUIR com soft-delete auditado. Esta migration
-- é ADITIVA: acrescenta colunas de exclusão em agency_equipe, cria a função de exclusão (soft-delete + audit_log),
-- o texto de ajuda da ação e completa a origem (system_screens). NÃO apaga nem altera dado de cliente; sem RLS nova
-- (as policies de agency_equipe por empresa já cobrem as linhas); a função tem guarda de empresa e REVOKE anon.

-- (1) Colunas de exclusão rastreável (aditivas, idempotentes).
ALTER TABLE public.agency_equipe
  ADD COLUMN IF NOT EXISTS excluido_em    timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por   uuid,
  ADD COLUMN IF NOT EXISTS excluido_motivo text;

-- (2) Função de exclusão (soft-delete): marca excluido_em/por/motivo + ativo=false e registra em audit_log_global.
--     Guarda de empresa (get_user_company_ids/is_admin), idempotente, espelha fn_cliente_arquivar.
CREATE OR REPLACE FUNCTION public.fn_agency_equipe_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text; v_excl timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id, nome, excluido_em INTO v_company, v_nome, v_excl
    FROM public.agency_equipe WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'membro_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_excl IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'ja_excluido', true); END IF;  -- idempotente
  UPDATE public.agency_equipe
     SET excluido_em = now(), excluido_por = auth.uid(), excluido_motivo = nullif(btrim(p_motivo), ''),
         ativo = false, updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'agency_equipe', p_id, 'excluir',
            jsonb_build_object('excluido_em', null),
            jsonb_build_object('excluido_em', now(), 'nome', v_nome, 'motivo', nullif(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_agency_equipe_excluir(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_equipe_excluir(uuid, text) TO authenticated, service_role;

-- (3) RD-95 · "?" da ação Excluir (idempotente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'pm.equipe.excluir', 'Equipe', 'Excluir membro',
       'Botão para excluir este membro da equipe.',
       'Remove o membro da equipe de forma rastreável (guarda quem excluiu e quando) e reversível pela auditoria; o membro deixa de aparecer na lista e de contar na margem. Diferente de "Ativo", que só o marca como temporariamente inativo mantendo-o na equipe.',
       'Desligar alguém que saiu da agência.',
       'Não use para afastamento temporário — nesse caso desmarque "Ativo".',
       50, '/dashboard/pm/equipe', 'pm', 'publicado'
ON CONFLICT (chave) DO NOTHING;

-- (4) RD-98 pilar 3 (origem) · a tela passa a consumir fn_agency_equipe_excluir.
UPDATE public.system_screens
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT e ORDER BY e)
         FROM unnest(coalesce(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_agency_equipe_excluir']) AS e
       )
 WHERE rota = '/dashboard/pm/equipe'
   AND NOT ('fn_agency_equipe_excluir' = ANY(coalesce(rpcs_chamadas, ARRAY[]::text[])));
