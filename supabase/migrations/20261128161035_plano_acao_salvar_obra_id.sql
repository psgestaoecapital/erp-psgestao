-- Plano de Ação 5W2H: writer passa a aceitar o elo OPCIONAL ação → obra do Hub.
-- Code: code-desenvolvedor-3 · tarefa eng_chefe c008d5d8 (GAP #6377, slice 1/writer).
--
-- GAP (RD-38): o bloco "Ações abertas desta obra" do cockpit (fn_obra_plano_acao_abertas)
-- lê erp_plano_acao WHERE obra_id = <obra>, mas fn_plano_acao_salvar NÃO lia obra_id —
-- então nenhuma ação jamais ficava ligada a uma obra (0 linhas com obra_id no banco) e o
-- bloco só mostrava estado vazio. Esta migration habilita o writer (slice 1). O seletor de
-- obra na tela (PlanoAcaoView) e o atalho "Nova ação" no cockpit vêm na fatia seguinte.
--
-- Aditivo e seguro: obra_id é OPCIONAL; ausência/valor vazio = comportamento idêntico ao
-- de hoje. Valida que a obra é da MESMA empresa (não vaza obra de outro tenant). A coluna
-- erp_plano_acao.obra_id já existe. Sem alterar dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_plano_acao_salvar(p_company_id uuid, p_plano jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_ano int := extract(year from now())::int; v_seq int; v_codigo text;
  v_titulo text := nullif(btrim(p_plano->>'titulo'),'');
  v_prioridade text := coalesce(nullif(p_plano->>'prioridade',''),'media');
  v_reuniao uuid := nullif(p_plano->>'reuniao_id','')::uuid;
  v_origem text := nullif(p_plano->>'origem','');
  v_quando date := nullif(p_plano->>'quando','')::date;
  v_resp uuid := nullif(p_plano->>'responsavel_user_id','')::uuid;
  v_resp_nome text := nullif(btrim(p_plano->>'responsavel_nome'),'');
  v_obra uuid := nullif(p_plano->>'obra_id','')::uuid;
  v_old record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_titulo IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
  IF v_prioridade NOT IN ('alta','media','baixa') THEN RETURN jsonb_build_object('ok',false,'erro','prioridade_invalida'); END IF;
  IF v_reuniao IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM erp_plano_acao_reuniao WHERE id = v_reuniao AND company_id = p_company_id AND excluido_em IS NULL) THEN
      RETURN jsonb_build_object('ok',false,'erro','reuniao_invalida'); END IF;
    v_origem := 'reuniao';  -- ação dentro de reunião nasce/fica com origem = reunião
  END IF;
  IF v_origem IS NOT NULL AND v_origem NOT IN ('reuniao','indicador','auditoria','chamado','outro') THEN RETURN jsonb_build_object('ok',false,'erro','origem_invalida'); END IF;
  -- elo opcional com a obra do Hub: só aceita obra da MESMA empresa, não excluída.
  IF v_obra IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM projetos_obras WHERE id = v_obra AND company_id = p_company_id AND deleted_at IS NULL) THEN
      RETURN jsonb_build_object('ok',false,'erro','obra_invalida'); END IF;
  END IF;

  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('plano_acao_num:'||p_company_id::text||':'||v_ano::text));
    SELECT coalesce(max(seq),0)+1 INTO v_seq FROM erp_plano_acao WHERE company_id = p_company_id AND ano = v_ano;
    v_codigo := 'PA-'||v_ano::text||'-'||lpad(v_seq::text,4,'0');
    INSERT INTO erp_plano_acao (company_id, ano, seq, codigo, titulo, o_que, por_que, onde, setor_id, quando,
        responsavel_user_id, responsavel_nome, como, custo_estimado, custo_real, prioridade, origem, origem_ref,
        indicador_vinculado, reuniao_id, obra_id, criado_por, criado_em, atualizado_em)
    VALUES (p_company_id, v_ano, v_seq, v_codigo, v_titulo, nullif(p_plano->>'o_que',''), nullif(p_plano->>'por_que',''),
        nullif(p_plano->>'onde',''), nullif(p_plano->>'setor_id','')::uuid, v_quando, v_resp, v_resp_nome,
        nullif(p_plano->>'como',''), nullif(p_plano->>'custo_estimado','')::numeric, nullif(p_plano->>'custo_real','')::numeric,
        v_prioridade, v_origem, nullif(p_plano->>'origem_ref',''), nullif(p_plano->>'indicador_vinculado',''),
        v_reuniao, v_obra, auth.uid(), now(), now())
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'id',v_id,'codigo',v_codigo);
  END IF;

  SELECT * INTO v_old FROM erp_plano_acao WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  UPDATE erp_plano_acao SET
    titulo = v_titulo, o_que = nullif(p_plano->>'o_que',''), por_que = nullif(p_plano->>'por_que',''),
    onde = nullif(p_plano->>'onde',''), setor_id = nullif(p_plano->>'setor_id','')::uuid, quando = v_quando,
    responsavel_user_id = v_resp, responsavel_nome = v_resp_nome, como = nullif(p_plano->>'como',''),
    custo_estimado = nullif(p_plano->>'custo_estimado','')::numeric, custo_real = nullif(p_plano->>'custo_real','')::numeric,
    prioridade = v_prioridade, origem = v_origem, origem_ref = nullif(p_plano->>'origem_ref',''),
    indicador_vinculado = nullif(p_plano->>'indicador_vinculado',''),
    reuniao_id = CASE WHEN p_plano ? 'reuniao_id' THEN v_reuniao ELSE reuniao_id END,
    obra_id = CASE WHEN p_plano ? 'obra_id' THEN v_obra ELSE obra_id END, atualizado_em = now()
  WHERE id = p_id;
  IF coalesce(v_old.quando::text,'') <> coalesce(v_quando::text,'') THEN
    INSERT INTO erp_plano_acao_historico (plano_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'prazo', v_old.quando::text, v_quando::text, auth.uid(), now());
  END IF;
  IF coalesce(v_old.responsavel_user_id::text, v_old.responsavel_nome,'') <> coalesce(v_resp::text, v_resp_nome,'') THEN
    INSERT INTO erp_plano_acao_historico (plano_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'responsavel', coalesce(v_old.responsavel_nome, v_old.responsavel_user_id::text),
            coalesce(v_resp_nome, v_resp::text), auth.uid(), now());
  END IF;
  IF coalesce(v_old.titulo,'') <> v_titulo THEN
    INSERT INTO erp_plano_acao_historico (plano_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'titulo', v_old.titulo, v_titulo, auth.uid(), now());
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'codigo',v_old.codigo);
END $function$;

-- Guarda RD: SECURITY DEFINER nunca aberta a anônimo (a função já confere a empresa do
-- registro via p_company_id ∈ get_user_company_ids()/is_admin() e auth.uid()).
REVOKE ALL ON FUNCTION public.fn_plano_acao_salvar(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_salvar(uuid, jsonb, uuid) TO authenticated, service_role;
