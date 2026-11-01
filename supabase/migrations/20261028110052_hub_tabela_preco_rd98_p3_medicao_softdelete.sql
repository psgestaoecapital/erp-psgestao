-- Hub · /dashboard/projetos/tabelas-preco — RD-98 p3 (origem do dado) + p4 parcial (medição rastreável)
-- CEO 27/10 (DELTA aud8). Code: desenvolvedor_4_g
--
-- 1) RD-98 p3: system_screens.views_consumidas/rpcs_chamadas estavam NULL nesta rota. Preenche com o que a
--    tela consome DE FATO (grep real de src/app/dashboard/projetos/tabelas-preco — RD-38).
-- 2) RD-98 p4 (exclusão rastreável) para a MEDIÇÃO ao cliente (documento de faturamento): deixa de ser DELETE
--    físico e passa a soft-delete (deleted_at + deleted_by) com trilha em audit_log_global. A listagem e o
--    saldo passam a ignorar medições excluídas.
--
-- Segurança/regressão: o filtro `deleted_at IS NULL` é NO-OP sobre os dados atuais (toda medição tem
--    deleted_at = NULL logo após o ALTER), então saldo e listagem continuam idênticos; a única mudança de
--    comportamento é que exclusões futuras preservam o registro em vez de apagá-lo.
-- (A exclusão de FAIXA — erp_tabela_preco_item — continua física nesta PR; o soft-delete dela toca 5 leitores
--    de precificação/viagem e será feito numa PR dedicada, com prova.)

-- 1) Coluna de soft-delete na medição ao cliente
ALTER TABLE public.erp_medicao_cliente
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2) Exclusão rastreável da medição (soft-delete + audit). Nunca DELETE físico.
CREATE OR REPLACE FUNCTION public.fn_medicao_cliente_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid; v_desc text; v_total numeric;
BEGIN
  SELECT company_id, descricao, total INTO v_co, v_desc, v_total
    FROM erp_medicao_cliente WHERE id = p_id AND deleted_at IS NULL;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Medição não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  UPDATE erp_medicao_cliente
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE id = p_id AND company_id = v_co;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_co, auth.uid(), 'erp_medicao_cliente', p_id, 'excluir',
            jsonb_build_object('descricao', v_desc, 'total', v_total, 'deleted_at', NULL),
            jsonb_build_object('descricao', v_desc, 'total', v_total, 'deleted_at', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_medicao_cliente_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_medicao_cliente_excluir(uuid) TO authenticated, service_role;

-- 3) Saldo do contrato ignora medições excluídas (soft-deleted). Resto do corpo intacto.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_saldo(p_tabela uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid; v_out jsonb;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  SELECT coalesce(jsonb_agg(jsonb_build_object('servico_ref', s.servico_ref, 'contratada', s.quantidade_contratada,
           'medida', m.med, 'saldo', s.quantidade_contratada - m.med) ORDER BY s.servico_ref), '[]'::jsonb)
    INTO v_out
    FROM erp_tabela_preco_saldo s
    CROSS JOIN LATERAL (SELECT coalesce(sum(i.quantidade), 0) AS med
                          FROM erp_medicao_cliente_item i JOIN erp_medicao_cliente c ON c.id = i.medicao_id
                         WHERE c.tabela_id = p_tabela AND c.deleted_at IS NULL AND i.servico_ref = s.servico_ref) m
   WHERE s.tabela_id = p_tabela;
  RETURN jsonb_build_object('ok', true, 'linhas', v_out);
END $function$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_saldo(uuid) TO authenticated, service_role;

-- 4) RD-98 p3: origem do dado da rota
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'erp_tabela_preco_cliente','erp_tabela_preco_item','erp_tabela_preco_condicao',
         'erp_tabela_preco_codigo','erp_medicao_cliente','erp_medicao_cliente_item','projetos_servicos'
       ]::text[],
       rpcs_chamadas = ARRAY[
         'fn_tabela_preco_pode_gravar','fn_tabela_preco_faixa_salvar','fn_tabela_preco_faixa_excluir',
         'fn_tabela_preco_medir','fn_tabela_preco_saldo','fn_tabela_preco_saldo_gravar',
         'fn_tabela_preco_vinculos','fn_tabela_preco_vinculo_gravar',
         'fn_medicao_cliente_salvar','fn_medicao_cliente_excluir'
       ]::text[]
 WHERE rota = '/dashboard/projetos/tabelas-preco';
