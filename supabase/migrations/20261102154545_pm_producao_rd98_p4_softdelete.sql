-- P&M · /dashboard/producao (Workspace da Agência) — RD-98 p4 (exclusão rastreável)
-- CEO 31/10 (PDCA VERMELHO auditor_pdca_2). Code: desenvolvedor_4_g
--
-- PROBLEMA (RD-38, provado no dado · DEMO Agência b0700000-0000-4000-a000-000000000002):
--   excluir(table,id) em src/app/dashboard/producao/page.tsx fazia supabase.from(table).delete()
--   -> DELETE FÍSICO de dado de cliente em agency_clientes / agency_jobs / agency_tarefas
--   (clientes=870, jobs=8203, tarefas abundantes). Sem deleted_at, sem quem-excluiu, sem audit_log.
--
-- CORREÇÃO: exclusão passa a ser SOFT-DELETE rastreável (excluido_em + excluido_por) com trilha em
--   audit_log_global, por uma RPC guardada (fn_pm_registro_excluir). Mesma doutrina da RD-98 p4 já
--   aplicada em fn_medicao_cliente_excluir (20261028110052). agency_jobs já tinha as colunas; aqui
--   acrescenta em agency_clientes e agency_tarefas (aditivo, IF NOT EXISTS).
--
-- Regressão: as colunas nascem NULL em todo registro atual, então o filtro `excluido_em IS NULL` nas
--   listagens é NO-OP sobre os dados de hoje; a única mudança de comportamento é que exclusões FUTURAS
--   preservam o registro em vez de apagá-lo. Aditivo e reversível por natureza.

-- 1) Colunas de soft-delete (agency_jobs já possui)
ALTER TABLE public.agency_clientes
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

ALTER TABLE public.agency_tarefas
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Exclusão rastreável do Workspace da Agência (soft-delete + audit). Nunca DELETE físico.
--    Whitelist estática das 3 tabelas da tela — sem SQL dinâmico; guarda por empresa em todas.
CREATE OR REPLACE FUNCTION public.fn_pm_registro_excluir(p_tabela text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid;
BEGIN
  IF p_tabela = 'agency_clientes' THEN
    SELECT company_id INTO v_co FROM agency_clientes WHERE id = p_id AND excluido_em IS NULL;
    IF v_co IS NULL THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
    PERFORM public.fn__guarda_empresa(v_co);
    UPDATE agency_clientes SET excluido_em = now(), excluido_por = auth.uid()
      WHERE id = p_id AND company_id = v_co;
  ELSIF p_tabela = 'agency_jobs' THEN
    SELECT company_id INTO v_co FROM agency_jobs WHERE id = p_id AND excluido_em IS NULL;
    IF v_co IS NULL THEN RAISE EXCEPTION 'Job não encontrado'; END IF;
    PERFORM public.fn__guarda_empresa(v_co);
    UPDATE agency_jobs SET excluido_em = now(), excluido_por = auth.uid()
      WHERE id = p_id AND company_id = v_co;
  ELSIF p_tabela = 'agency_tarefas' THEN
    SELECT company_id INTO v_co FROM agency_tarefas WHERE id = p_id AND excluido_em IS NULL;
    IF v_co IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
    PERFORM public.fn__guarda_empresa(v_co);
    UPDATE agency_tarefas SET excluido_em = now(), excluido_por = auth.uid()
      WHERE id = p_id AND company_id = v_co;
  ELSE
    RAISE EXCEPTION 'Tabela não permitida: %', p_tabela;
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_co, auth.uid(), p_tabela, p_id, 'excluir',
            jsonb_build_object('excluido_em', NULL),
            jsonb_build_object('excluido_em', now()));

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_registro_excluir(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_registro_excluir(text, uuid) TO authenticated, service_role;
