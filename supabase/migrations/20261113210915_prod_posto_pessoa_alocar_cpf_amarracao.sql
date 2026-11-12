-- Tarefa 029fd118 (decisão 1 do Eng. Chefe 11/11; CEO 06/11): o CPF é a CHAVE DE AMARRAÇÃO da pessoa no posto.
-- Hoje a tela de Postos aloca a pessoa só pelo CPF (dígitos). O fn_prod_posto_pessoa_alocar guardava esse CPF
-- solto, SEM resolver o funcionario_id — então o fn_prod_posto_pessoas_listar mostrava "CPF manual" e "Sem nome
-- no cadastro" mesmo para quem JÁ está no cadastro da empresa (compliance_funcionarios).
--
-- MUDANÇA (aditiva, RD-97 — mesma assinatura e mesmos params que a tela já usa):
--   1. Quando vier só o CPF (sem funcionario_id), casa a pessoa pelo CPF no cadastro da PRÓPRIA empresa
--      (compliance_funcionarios, normalizando os dois lados). Casou → grava funcionario_id (a tela passa a
--      mostrar o nome e "do ponto"). NÃO casou (pessoa nova/terceiro, fora do cadastro) → mantém MANUAL (só o
--      CPF), nunca descarta.
--   2. A de-duplicação da vigência aberta no posto passa a casar por funcionario_id OU pelo CPF normalizado —
--      assim ninguém fica duplicado quando a mesma pessoa estava como "CPF manual" e agora casou no cadastro.
--   3. Grava o CPF normalizado (só dígitos), para a de-duplicação por CPF ser estável.
-- Isolamento preservado: só resolve dentro de v_comp (empresa do posto), a guarda de acesso continua intacta.
-- Prova RD-38 (DEMO Indústria b07...005, BEGIN/ROLLBACK): CPF 55500000160 → "Ana Paula Demo"/origem 'ponto';
-- CPF inexistente 00000000191 → nome nulo/origem 'manual'. Nenhum dado de cliente é alterado.

CREATE OR REPLACE FUNCTION public.fn_prod_posto_pessoa_alocar(p_dados jsonb, p_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_posto   uuid := NULLIF(p_dados->>'posto_id','')::uuid;
  v_func    uuid := NULLIF(p_dados->>'funcionario_id','')::uuid;
  v_cpf     text := NULLIF(btrim(coalesce(p_dados->>'cpf','')),'');
  v_cpf_dig text := NULLIF(regexp_replace(coalesce(p_dados->>'cpf',''),'[^0-9]','','g'),'');
  v_turno   uuid := NULLIF(p_dados->>'turno_id','')::uuid;
  v_ini     date := COALESCE(NULLIF(p_dados->>'vigencia_inicio','')::date, CURRENT_DATE);
  v_comp uuid; v_plant uuid; v_id uuid; v_uid uuid := COALESCE(auth.uid(), p_user);
BEGIN
  IF v_posto IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_obrigatorio'); END IF;
  SELECT company_id, plant_id INTO v_comp, v_plant FROM prod_posto WHERE id = v_posto;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_plant IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_sem_planta'); END IF;
  IF v_func IS NULL AND v_cpf IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_pessoa'); END IF;

  -- amarração pelo CPF (CEO 06/11): com o CPF, casa a pessoa no cadastro da PRÓPRIA empresa e grava o
  -- funcionario_id. Sem par no cadastro, segue MANUAL (só o CPF) — pessoa nova/terceiro não é descartada.
  IF v_func IS NULL AND v_cpf_dig IS NOT NULL THEN
    SELECT cf.id INTO v_func
      FROM compliance_funcionarios cf
     WHERE cf.company_id = v_comp
       AND regexp_replace(COALESCE(cf.cpf,''),'[^0-9]','','g') = v_cpf_dig
     ORDER BY (cf.ativo IS TRUE) DESC, cf.updated_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_func IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM compliance_funcionarios WHERE id = v_func AND company_id = v_comp) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'funcionario_outra_empresa'); END IF;

  -- encerra a vigência aberta anterior da MESMA pessoa no posto — por funcionario_id OU pelo CPF normalizado
  UPDATE prod_posto_pessoa
     SET vigencia_fim = GREATEST(vigencia_inicio, v_ini - 1)
   WHERE posto_id = v_posto AND vigencia_fim IS NULL
     AND (
       (v_func IS NOT NULL AND funcionario_id = v_func)
       OR (v_cpf_dig IS NOT NULL AND regexp_replace(COALESCE(cpf,''),'[^0-9]','','g') = v_cpf_dig)
     );

  INSERT INTO prod_posto_pessoa (company_id, plant_id, posto_id, funcionario_id, cpf, turno_id, vigencia_inicio, criado_por)
  VALUES (v_comp, v_plant, v_posto, v_func, COALESCE(v_cpf_dig, v_cpf), v_turno, v_ini, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_comp, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
          'prod_posto_pessoa', v_id::text, 'posto_pessoa_alocar', NULL,
          jsonb_build_object('posto_id', v_posto, 'funcionario_id', v_func, 'cpf', COALESCE(v_cpf_dig, v_cpf),
                             'turno_id', v_turno, 'vigencia_inicio', v_ini));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- ACL mantida (fecha anon; só usuário logado e a conexão de serviço executam)
REVOKE ALL ON FUNCTION public.fn_prod_posto_pessoa_alocar(jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prod_posto_pessoa_alocar(jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_pessoa_alocar(jsonb, uuid) TO authenticated, service_role;
