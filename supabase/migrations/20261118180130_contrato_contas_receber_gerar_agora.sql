-- Contas a receber de contrato — "Gerar agora" + anexo não obrigatório + sync do header do plano
--
-- SPEC Eng. Chefe (RD-41). Diagnóstico (RD-38, auditado no banco): fn_contrato_parcelas_salvar só grava o
-- desenho das parcelas; quem gera as contas a receber é fn_contrato_gerar_parcelas, com trava dura de status
-- 'ativo'. Contrato em elaboração => 0 contas a receber. O financeiro precisa poder gerar AGORA (mesmo em
-- elaboração, sem anexo), mantendo idempotência, guarda de empresa e o comportamento atual como default seguro.
--
-- ADITIVA/CORRETIVA e REVERSÍVEL:
--  3.1 fn_contrato_mudar_status: default da exigência de anexo true -> false (empresa ainda pode exigir).
--  3.2 fn_contrato_gerar_parcelas: + param opcional p_ignorar_status (DROP do overload 1-arg + recria 2-arg,
--      para não criar ambiguidade de chamada); marca sem_contas_receber=false ao gerar.
--  3.3 NOVA fn_contrato_parcelas_gerar_agora: RPC fina do botão "Gerar agora".
--  3.4 fn_contrato_mudar_status: edge do sem_contas_receber ("já gerado" prevalece).
--  3.5 fn_contrato_parcelas_salvar: sincroniza erp_contratos.numero_parcelas com o plano (NÃO toca valor).
-- Reverter: recriar as 3 funções na forma anterior (DROP da 2-arg + recria a 1-arg) e DROP da RPC nova.
-- Nada destrutivo roda na aplicação; idempotência por ref_externa_sistema='contrato_parcela' preservada.

-- ============================================================================================
-- 3.5) fn_contrato_parcelas_salvar — sincroniza numero_parcelas (só grava o desenho; não gera receber)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_contrato_parcelas_salvar(p_contrato_id uuid, p_parcelas jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = ''; v_item jsonb; v_n int := 0;
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_c.status = 'ativo' THEN RETURN jsonb_build_object('ok',false,'erro','contrato_ativo_nao_edita_plano'); END IF;
  IF p_parcelas IS NULL OR jsonb_typeof(p_parcelas) <> 'array' THEN RETURN jsonb_build_object('ok',false,'erro','parcelas_invalidas'); END IF;

  DELETE FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    v_n := v_n + 1;
    INSERT INTO erp_contrato_parcelas (contrato_id, company_id, numero, vencimento, valor, conta_bancaria_id, forma_pagamento, pagador_cliente_id)
    VALUES (p_contrato_id, v_c.company_id, v_n,
      (v_item->>'vencimento')::date, COALESCE((v_item->>'valor')::numeric,0),
      NULLIF(v_item->>'conta_bancaria_id','')::uuid, NULLIF(v_item->>'forma_pagamento',''),
      COALESCE(NULLIF(v_item->>'pagador_cliente_id','')::uuid, v_c.cliente_id));
  END LOOP;
  -- 3.5: cabeçalho acompanha o plano (ex.: Enertrafo mostrava 2 com plano de 3). Só numero_parcelas; valor fica a cargo do CEO.
  UPDATE erp_contratos SET numero_parcelas = v_n, updated_at = now() WHERE id = p_contrato_id;
  RETURN jsonb_build_object('ok', true, 'parcelas', v_n);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contrato_parcelas_salvar(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_parcelas_salvar(uuid, jsonb) TO authenticated, service_role;

-- ============================================================================================
-- 3.2) fn_contrato_gerar_parcelas — + p_ignorar_status (DROP 1-arg, recria 2-arg) + sem_contas_receber=false
-- ============================================================================================
DROP FUNCTION IF EXISTS public.fn_contrato_gerar_parcelas(uuid);
CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_parcelas(p_contrato_id uuid, p_ignorar_status boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato record; v_p record; v_ref text; v_receber_id uuid; v_gerados int := 0; v_pulados int := 0; v_total numeric := 0;
  v_empresa_fat uuid;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'contrato nao encontrado'); END IF;
  -- guarda de empresa (005d9881): sem JWT (cron/interno) ou service_role passa; usuário só na própria empresa.
  IF coalesce(current_setting('request.jwt.claims', true), '') <> '' AND auth.role() <> 'service_role'
     AND v_contrato.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501'; END IF;
  -- trava de status: só exige 'ativo' quando NÃO é geração antecipada (p_ignorar_status).
  IF NOT p_ignorar_status AND v_contrato.status != 'ativo' THEN RETURN jsonb_build_object('success', false, 'error', format('contrato %s nao esta ativo', v_contrato.status)); END IF;

  v_empresa_fat := COALESCE(v_contrato.empresa_faturadora_id, v_contrato.company_id);

  FOR v_p IN SELECT * FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id ORDER BY numero LOOP
    v_ref := format('contrato:%s:parcela:%s', p_contrato_id, v_p.numero);
    -- idempotência: parcela já com título vivo (não deletado) → pula.
    IF v_p.receber_id IS NOT NULL AND EXISTS (SELECT 1 FROM erp_receber WHERE id = v_p.receber_id AND deleted_at IS NULL) THEN
      v_pulados := v_pulados + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM erp_receber WHERE ref_externa_sistema = 'contrato_parcela' AND ref_externa_id = v_ref AND deleted_at IS NULL) THEN
      v_pulados := v_pulados + 1; CONTINUE; END IF;

    INSERT INTO erp_receber (
      company_id, cliente_id, cliente_nome, descricao, categoria, valor,
      data_emissao, data_vencimento, data_competencia, status, forma_pagamento,
      conta_bancaria_id, linha_negocio, observacoes, recorrente, parcela,
      ref_externa_id, ref_externa_sistema, contrato_id
    ) VALUES (
      v_empresa_fat, v_contrato.cliente_id, v_contrato.cliente_nome,
      format('%s - Parcela %s/%s', v_contrato.nome, v_p.numero, (SELECT count(*) FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id)),
      'Receita Recorrente', v_p.valor,
      CURRENT_DATE, v_p.vencimento, date_trunc('month', v_p.vencimento)::date, 'aberto', v_p.forma_pagamento,
      v_p.conta_bancaria_id, v_contrato.tipo, format('Fee do contrato %s (parcela %s)', v_contrato.numero, v_p.numero),
      true, v_p.numero::text, v_ref, 'contrato_parcela', p_contrato_id
    ) RETURNING id INTO v_receber_id;

    UPDATE erp_contrato_parcelas SET receber_id = v_receber_id, updated_at = now() WHERE id = v_p.id;
    v_gerados := v_gerados + 1; v_total := v_total + COALESCE(v_p.valor,0);
  END LOOP;

  IF v_gerados > 0 THEN
    UPDATE erp_contratos SET ultimo_titulo_gerado_em = CURRENT_DATE,
      sem_contas_receber = false,
      total_titulos_gerados = COALESCE(total_titulos_gerados,0) + v_gerados,
      total_faturado = COALESCE(total_faturado,0) + v_total, updated_at = now()
    WHERE id = p_contrato_id;
    INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, created_at)
    VALUES (p_contrato_id, v_contrato.company_id, 'parcelas_geradas',
      format('%s parcela(s) gerada(s) em contas a receber (R$ %s)', v_gerados, to_char(v_total,'FM999999990.00')),
      jsonb_build_object('gerados', v_gerados, 'pulados', v_pulados, 'total', v_total, 'empresa_faturadora', v_empresa_fat), now());
  END IF;

  RETURN jsonb_build_object('success', true, 'gerados', v_gerados, 'pulados', v_pulados, 'total', v_total);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contrato_gerar_parcelas(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_gerar_parcelas(uuid, boolean) TO authenticated, service_role;

-- ============================================================================================
-- 3.1 + 3.4) fn_contrato_mudar_status — anexo default false; edge do sem_contas_receber ("já gerado" prevalece)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_contrato_mudar_status(p_contrato_id uuid, p_status text, p_mensagem text DEFAULT NULL::text, p_gerar_receber boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_uid uuid := auth.uid(); v_n_arq int; v_soma numeric; v_ger jsonb;
  v_exige_anexo boolean;
  v_validos text[] := ARRAY['solicitado','em_elaboracao','aguardando_info','em_revisao','aguardando_aprovacao','ativo','cancelado','suspenso','encerrado'];
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF NOT (p_status = ANY(v_validos)) THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF p_status = 'aguardando_info' AND COALESCE(btrim(p_mensagem),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'erro','mensagem_obrigatoria'); END IF;

  IF p_status = 'ativo' THEN
    -- #2a3909d9 + SPEC gerar-agora: exigência do anexo é configurável por empresa; DEFAULT agora é false
    -- (empresa que quiser exigir seta exigir_contrato_anexado=true na sua config).
    v_exige_anexo := COALESCE((SELECT exigir_contrato_anexado FROM erp_contratos_config WHERE company_id = v_c.company_id), false);
    IF v_exige_anexo THEN
      SELECT count(*) INTO v_n_arq FROM erp_contratos_arquivos WHERE contrato_id = p_contrato_id AND tipo IN ('contrato','contrato_assinado');
      IF v_n_arq < 1 THEN RETURN jsonb_build_object('ok',false,'erro','anexo_contrato_obrigatorio'); END IF;
    END IF;
    -- exigir plano com valor só faz sentido quando vamos gerar as contas a receber
    IF p_gerar_receber THEN
      SELECT COALESCE(SUM(valor),0) INTO v_soma FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;
      IF v_soma <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','plano_sem_valor'); END IF;
    END IF;
  END IF;

  UPDATE erp_contratos
     SET status = p_status, updated_at = now(),
         -- 3.4: "já gerado" prevalece — se há conta a receber viva do contrato, nunca marcar sem_contas_receber=true.
         sem_contas_receber = CASE
           WHEN EXISTS (SELECT 1 FROM erp_receber WHERE contrato_id = p_contrato_id AND ref_externa_sistema = 'contrato_parcela' AND deleted_at IS NULL) THEN false
           WHEN p_status = 'ativo' THEN NOT p_gerar_receber
           ELSE sem_contas_receber END
   WHERE id = p_contrato_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_contrato_id, v_c.company_id, 'status_'||p_status,
    COALESCE(NULLIF(btrim(p_mensagem),''), format('Status alterado de %s para %s', v_c.status, p_status)),
    jsonb_build_object('de', v_c.status, 'para', p_status), v_uid, now());

  IF p_status = 'ativo' THEN
    IF p_gerar_receber THEN
      v_ger := fn_contrato_gerar_parcelas(p_contrato_id);
    ELSE
      -- ativado sem gerar: fica no histórico (quem/quando) para o selo e a auditoria
      INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
      VALUES (p_contrato_id, v_c.company_id, 'ativado_sem_contas_receber',
        'Contrato ativado sem gerar contas a receber (cobrança externa, permuta ou lançamento manual).',
        jsonb_build_object('por', v_uid), v_uid, now());
      v_ger := jsonb_build_object('gerados', 0, 'total', 0, 'sem_contas_receber', true);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'gerador', v_ger,
    'sem_contas_receber', CASE WHEN p_status = 'ativo' THEN NOT p_gerar_receber ELSE NULL END);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text, boolean) TO authenticated, service_role;

-- ============================================================================================
-- 3.3) NOVA RPC fina — "Salvar e gerar contas a receber agora"
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_contrato_parcelas_gerar_agora(p_contrato_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_uid uuid := auth.uid(); v_soma numeric; v_ger jsonb;
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  -- guarda de empresa (mesma das demais RPCs de contrato)
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  -- exige plano com valor (não exige anexo nem status 'ativo')
  SELECT COALESCE(SUM(valor),0) INTO v_soma FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;
  IF v_soma <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','plano_sem_valor'); END IF;

  v_ger := fn_contrato_gerar_parcelas(p_contrato_id, true);
  IF COALESCE((v_ger->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_ger->>'error','falha_geracao'), 'gerador', v_ger);
  END IF;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_contrato_id, v_c.company_id, 'parcelas_geradas_antecipado',
    format('Contas a receber geradas antecipadamente (%s parcela(s), R$ %s) com o contrato em %s.',
           COALESCE(v_ger->>'gerados','0'), to_char(COALESCE((v_ger->>'total')::numeric,0),'FM999999990.00'), v_c.status),
    jsonb_build_object('gerados', v_ger->'gerados', 'pulados', v_ger->'pulados', 'total', v_ger->'total', 'por', v_uid), v_uid, now());

  RETURN jsonb_build_object('ok', true, 'gerados', COALESCE((v_ger->>'gerados')::int,0), 'total', COALESCE((v_ger->>'total')::numeric,0));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contrato_parcelas_gerar_agora(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_parcelas_gerar_agora(uuid) TO authenticated, service_role;

-- ============================================================================================
-- 4) Ajuda (RD-95) do novo campo "Geração das contas a receber" no editor de parcelas do contrato
-- ============================================================================================
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ge.contratos.geracao_contas_receber','/dashboard/contratos','Contratos','Geração das contas a receber',
   'Escolha quando as cobranças do contrato nascem: "ao ativar o contrato" (padrão) ou "agora" (mesmo em elaboração, sem anexo).',
   'Dá ao financeiro o controle de quando as contas a receber do contrato são criadas — útil quando a nota fiscal sai depois mas a cobrança já precisa existir.',
   'Trabalho entregue, NF só em 3 meses: escolha "Gerar agora" para já lançar as 3 parcelas no contas a receber.',
   'Achar que "Salvar plano" já cria as cobranças — não cria: ele só desenha as parcelas. As contas a receber nascem ao ativar ou com "Gerar agora".',
   'gestao_empresarial',10,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
