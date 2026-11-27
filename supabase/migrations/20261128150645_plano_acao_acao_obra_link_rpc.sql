-- Hub · Plano de Ação 5W2H na obra (CEO 20/11 13:21, msg eng_chefe 112b6b3a) — FATIA DE GRAVAÇÃO/LEITURA
-- Code: desenvolvedor_4_g
-- ============================================================================
-- A fatia de banco 20261126002645 já ADICIONOU a coluna opcional `obra_id` (FK -> projetos_obras,
-- ON DELETE SET NULL) em erp_plano_acao e erp_plano_acao_reuniao. Faltava o motor LER/GRAVAR o elo:
--   1) fn_plano_acao_salvar passa a aceitar e VALIDAR p_plano->>'obra_id' (obra da MESMA empresa,
--      não excluída) e persiste na ação.
--   2) fn_plano_acao_listar passa a devolver obra_id + obra_numero + obra_nome (LEFT JOIN), para a
--      tela do Hub exibir/filtrar e prefixar na edição.
--
-- ADITIVA e sem regressão para a Indústria: quando o payload NÃO traz a chave 'obra_id' (é o caso da
-- tela da Indústria, que não mostra o campo), o INSERT grava NULL e o UPDATE PRESERVA o valor atual
-- (CASE WHEN p_plano ? 'obra_id'); as colunas novas do listar são ignoradas por quem não as usa.
-- Não toca RLS (as 2 tabelas e projetos_obras já têm RLS por empresa), menu, cálculo nem dado de cliente.
-- CREATE OR REPLACE de função existente (sensível) -> etiqueta revisao-eng-chefe, espera MERGE AUTORIZADO.
--
-- RD-38 (conferido no código vivo da main, não suposto):
--   src/components/plano-acao/PlanoAcaoView.tsx chama fn_plano_acao_salvar(p_plano jsonb) e
--   fn_plano_acao_listar; a obra do Hub é public.projetos_obras (id uuid, company_id, numero, nome,
--   deleted_at). As 3 funções fn_dre* não entram aqui. Definições abaixo = cópia fiel das vivas
--   (pg_get_functiondef) + SÓ o tratamento de obra_id.
-- ============================================================================

-- 1) GRAVAÇÃO da ação: aceita e valida obra_id (opcional)
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
  -- obra opcional: se vier, tem de ser obra da MESMA empresa e não excluída (elo Hub)
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

-- 2) LEITURA: devolve o elo com a obra (obra_id/obra_numero/obra_nome) para a tela do Hub
CREATE OR REPLACE FUNCTION public.fn_plano_acao_listar(p_company_id uuid, p_status text DEFAULT NULL::text, p_responsavel uuid DEFAULT NULL::uuid, p_setor uuid DEFAULT NULL::uuid, p_prioridade text DEFAULT NULL::text, p_origem text DEFAULT NULL::text, p_so_atrasadas boolean DEFAULT false, p_busca text DEFAULT NULL::text, p_reuniao uuid DEFAULT NULL::uuid, p_incluir_arquivadas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; q text := nullif(btrim(p_busca),'');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.prazo_ord NULLS LAST, a.criado_em DESC) INTO v FROM (
    SELECT pa.id, pa.codigo, pa.titulo, pa.o_que, pa.por_que, pa.onde, pa.setor_id, s.nome AS setor_nome,
           pa.quando, pa.responsavel_user_id, pa.responsavel_nome, pa.como, pa.custo_estimado, pa.custo_real,
           pa.status, pa.prioridade, pa.origem, pa.origem_ref, pa.indicador_vinculado, pa.resultado_obtido,
           pa.reuniao_id, re.codigo AS reuniao_codigo, re.titulo AS reuniao_titulo,
           pa.obra_id, ob.numero AS obra_numero, ob.nome AS obra_nome,
           pa.concluida_em, pa.criado_em, pa.atualizado_em,
           (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')) AS atrasada,
           pa.arquivada, pa.arquivada_em,
           pa.quando AS prazo_ord
    FROM erp_plano_acao pa
    LEFT JOIN prod_setor s ON s.id = pa.setor_id
    LEFT JOIN erp_plano_acao_reuniao re ON re.id = pa.reuniao_id
    LEFT JOIN projetos_obras ob ON ob.id = pa.obra_id
    WHERE pa.company_id = p_company_id AND pa.excluido_em IS NULL
      AND (p_incluir_arquivadas OR NOT pa.arquivada)
      AND (p_status IS NULL OR pa.status = p_status)
      AND (p_responsavel IS NULL OR pa.responsavel_user_id = p_responsavel)
      AND (p_setor IS NULL OR pa.setor_id = p_setor)
      AND (p_prioridade IS NULL OR pa.prioridade = p_prioridade)
      AND (p_origem IS NULL OR pa.origem = p_origem)
      AND (p_reuniao IS NULL OR pa.reuniao_id = p_reuniao)
      AND (NOT p_so_atrasadas OR (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')))
      AND (q IS NULL OR pa.titulo ILIKE '%'||q||'%' OR pa.codigo ILIKE '%'||q||'%'
           OR coalesce(pa.o_que,'') ILIKE '%'||q||'%' OR coalesce(pa.responsavel_nome,'') ILIKE '%'||q||'%'
           OR coalesce(pa.origem_ref,'') ILIKE '%'||q||'%' OR coalesce(re.titulo,'') ILIKE '%'||q||'%' OR coalesce(re.codigo,'') ILIKE '%'||q||'%')
  ) a;
  RETURN jsonb_build_object('ok',true,'resultados',coalesce(v,'[]'::jsonb));
END $function$;

-- 3) RD-95: "?" do campo novo "Obra" na tela do Hub (rota /dashboard/hub/plano-acao). Idempotente por chave única.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT 'plano_acao.obra', '/dashboard/hub/plano-acao', 'Plano de Ação 5W2H', 'Obra (opcional)',
       'Selecione a obra do Hub a que esta ação pertence. Deixe em branco se a ação não for de uma obra específica.',
       'Liga a ação 5W2H à obra: ela passa a aparecer no cockpit da obra e pode ser filtrada por obra.',
       'Ex.: 001 · Residencial Jardins',
       'Ligar a uma obra de outra empresa — a lista só mostra as obras da empresa selecionada.',
       'hub', 60, 1, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'plano_acao.obra');

-- 4) GRAVAÇÃO da reunião: aceita e valida obra_id (opcional) — "Onde" sugere a obra da reunião
CREATE OR REPLACE FUNCTION public.fn_plano_acao_reuniao_salvar(p_company_id uuid, p_reuniao jsonb, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_ano int := extract(year from now())::int; v_seq int; v_codigo text;
  v_titulo text := nullif(btrim(p_reuniao->>'titulo'),'');
  v_status text := coalesce(nullif(p_reuniao->>'status',''),'agendada');
  v_data timestamptz := nullif(p_reuniao->>'data_hora','')::timestamptz;
  v_dono uuid := nullif(p_reuniao->>'dono_user_id','')::uuid;
  v_dono_nome text := nullif(btrim(p_reuniao->>'dono_nome'),'');
  v_obra uuid := nullif(p_reuniao->>'obra_id','')::uuid;
  v_old record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_titulo IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
  IF v_status NOT IN ('agendada','realizada','cancelada') THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF v_obra IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM projetos_obras WHERE id = v_obra AND company_id = p_company_id AND deleted_at IS NULL) THEN
      RETURN jsonb_build_object('ok',false,'erro','obra_invalida'); END IF;
  END IF;

  IF p_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('plano_reuniao_num:'||p_company_id::text||':'||v_ano::text));
    SELECT coalesce(max(seq),0)+1 INTO v_seq FROM erp_plano_acao_reuniao WHERE company_id = p_company_id AND ano = v_ano;
    v_codigo := 'RE-'||v_ano::text||'-'||lpad(v_seq::text,4,'0');
    INSERT INTO erp_plano_acao_reuniao (company_id, ano, seq, codigo, titulo, data_hora, local, dono_user_id, dono_nome,
        participantes, pauta, ata, status, obra_id, criado_por, criado_em, atualizado_em)
    VALUES (p_company_id, v_ano, v_seq, v_codigo, v_titulo, v_data, nullif(p_reuniao->>'local',''), v_dono, v_dono_nome,
        nullif(p_reuniao->>'participantes',''), nullif(p_reuniao->>'pauta',''), nullif(p_reuniao->>'ata',''), v_status,
        v_obra, auth.uid(), now(), now())
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'id',v_id,'codigo',v_codigo);
  END IF;

  SELECT * INTO v_old FROM erp_plano_acao_reuniao WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nao_encontrado'); END IF;
  UPDATE erp_plano_acao_reuniao SET
    titulo = v_titulo, data_hora = v_data, local = nullif(p_reuniao->>'local',''),
    dono_user_id = v_dono, dono_nome = v_dono_nome, participantes = nullif(p_reuniao->>'participantes',''),
    pauta = nullif(p_reuniao->>'pauta',''), ata = nullif(p_reuniao->>'ata',''), status = v_status,
    obra_id = CASE WHEN p_reuniao ? 'obra_id' THEN v_obra ELSE obra_id END, atualizado_em = now()
  WHERE id = p_id;
  IF coalesce(v_old.titulo,'') <> v_titulo THEN
    INSERT INTO erp_plano_acao_reuniao_historico (reuniao_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'titulo', v_old.titulo, v_titulo, auth.uid(), now()); END IF;
  IF coalesce(v_old.data_hora::text,'') <> coalesce(v_data::text,'') THEN
    INSERT INTO erp_plano_acao_reuniao_historico (reuniao_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'data', v_old.data_hora::text, v_data::text, auth.uid(), now()); END IF;
  IF coalesce(v_old.dono_user_id::text, v_old.dono_nome,'') <> coalesce(v_dono::text, v_dono_nome,'') THEN
    INSERT INTO erp_plano_acao_reuniao_historico (reuniao_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'dono', coalesce(v_old.dono_nome, v_old.dono_user_id::text), coalesce(v_dono_nome, v_dono::text), auth.uid(), now()); END IF;
  IF coalesce(v_old.status,'') <> v_status THEN
    INSERT INTO erp_plano_acao_reuniao_historico (reuniao_id, company_id, campo, de, para, por, em)
    VALUES (p_id, p_company_id, 'status', v_old.status, v_status, auth.uid(), now()); END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'codigo',v_old.codigo);
END $function$;

-- 5) LEITURA das reuniões: devolve o elo com a obra (obra_id/obra_numero/obra_nome)
CREATE OR REPLACE FUNCTION public.fn_plano_acao_reuniao_listar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(r) ORDER BY r.data_ord DESC NULLS LAST, r.criado_em DESC) INTO v FROM (
    SELECT re.id, re.codigo, re.titulo, re.data_hora, re.local, re.dono_user_id, re.dono_nome, re.participantes,
           re.pauta, re.ata, re.status, re.criado_em,
           re.obra_id, ob.numero AS obra_numero, ob.nome AS obra_nome,
           coalesce(re.data_hora, re.criado_em) AS data_ord,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL) AS acoes_total,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL AND a.status = 'aberta') AS acoes_abertas,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL
              AND a.quando IS NOT NULL AND a.quando < current_date AND a.status NOT IN ('concluida','cancelada')) AS acoes_atrasadas,
           (SELECT count(*) FROM erp_plano_acao a WHERE a.reuniao_id = re.id AND a.excluido_em IS NULL AND a.status = 'concluida') AS acoes_concluidas
    FROM erp_plano_acao_reuniao re
    LEFT JOIN projetos_obras ob ON ob.id = re.obra_id
    WHERE re.company_id = p_company_id AND re.excluido_em IS NULL
  ) r;
  RETURN jsonb_build_object('ok',true,'reunioes',coalesce(v,'[]'::jsonb));
END $function$;

-- 6) RD-95: "?" do campo "Obra" da reunião na tela do Hub. Idempotente por chave única.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT 'plano_acao.reuniao_obra', '/dashboard/hub/plano-acao', 'Plano de Ação 5W2H', 'Obra da reunião (opcional)',
       'Selecione a obra do Hub tratada nesta reunião. Deixe em branco para uma reunião geral, não ligada a uma obra.',
       'Liga a reunião à obra e sugere a mesma obra nas ações criadas a partir dela.',
       'Ex.: 001 · Residencial Jardins',
       'Ligar a uma obra de outra empresa — a lista só mostra as obras da empresa selecionada.',
       'hub', 61, 1, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'plano_acao.reuniao_obra');

-- 7) RD-95: "?" do FILTRO por obra na lista do Hub. Idempotente por chave única.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT 'plano_acao.f_obra', '/dashboard/hub/plano-acao', 'Plano de Ação 5W2H', 'Filtro por obra',
       'Escolha uma obra para ver só as ações ligadas a ela. "Todas" mostra as ações de qualquer obra e as sem obra.',
       'Foca o plano de ação numa obra específica do Hub.',
       'Ex.: 001 · Residencial Jardins',
       'Esperar ver ações sem obra ao escolher uma obra — o filtro mostra só as daquela obra.',
       'hub', 62, 1, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'plano_acao.f_obra');

-- 8) Guarda de funções (check_fn_guards · segurança): as 4 funções SECURITY DEFINER recriadas
--    mantêm a ACL VIVA (authenticated + service_role; sem anon). REVOKE de PUBLIC/anon + GRANT explícito,
--    espelhando o estado atual em produção. Idempotente.
REVOKE ALL ON FUNCTION public.fn_plano_acao_salvar(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_salvar(uuid, jsonb, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_plano_acao_listar(uuid, text, uuid, uuid, text, text, boolean, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_listar(uuid, text, uuid, uuid, text, text, boolean, text, uuid, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_plano_acao_reuniao_salvar(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_reuniao_salvar(uuid, jsonb, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_plano_acao_reuniao_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_reuniao_listar(uuid) TO authenticated, service_role;
