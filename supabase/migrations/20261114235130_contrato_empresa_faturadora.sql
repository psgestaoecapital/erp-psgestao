-- P2/Pdois · Contrato · contexto 2a3909d9 (CEO na P2 11/11) · Code: rodrigo-code
--
-- PR 1 — EMPRESA QUE FATURA (escolha do FINANCEIRO, nunca do comercial).
-- O comercial abre o contrato sempre pela empresa do CRM (ex.: Prigol/P2). Na etapa do
-- financeiro (antes de Ativar), o financeiro escolhe a EMPRESA QUE FATURA entre as empresas
-- do MESMO grupo econômico (companies.group_id) às quais o usuário tem acesso. As parcelas /
-- contas a receber (e a NF, que segue a empresa do título) nascem na empresa escolhida; o
-- contrato, o job e a produção continuam na empresa do contrato.
--
-- Genérico para qualquer grupo com várias empresas (RD-102: nada específico da P2). Aditivo e
-- idempotente. Coluna nova NULLABLE (padrão = a própria empresa do contrato, via COALESCE);
-- nenhum contrato existente muda de comportamento. Função SECURITY DEFINER valida fail-closed:
-- mesmo group_id + usuário com acesso à empresa escolhida.
--
-- RD-38 (prova em produção, transação desfeita antes do merge):
--   - erp_contratos.empresa_faturadora_id NÃO existia (0 ocorrências) → aditiva.
--   - fn_contrato_gerar_parcelas/receber reproduzidas IDÊNTICAS à definição viva, única mudança:
--     company_id do erp_receber passa a COALESCE(empresa_faturadora_id, company_id). Eventos e
--     agregados do contrato seguem na empresa do contrato.

-- 1) Coluna aditiva ----------------------------------------------------------------------
ALTER TABLE public.erp_contratos
  ADD COLUMN IF NOT EXISTS empresa_faturadora_id uuid REFERENCES public.companies(id);
COMMENT ON COLUMN public.erp_contratos.empresa_faturadora_id IS
  'Empresa do mesmo grupo que FATURA este contrato (parcelas/contas a receber/NF). NULL = a própria empresa do contrato (company_id). Escolhido pelo financeiro.';

-- 2) Lista de empresas faturadoras possíveis (mesmo grupo + acesso do usuário) ------------
-- SECURITY DEFINER para ler companies/group com segurança; fail-closed: sem acesso ao contrato
-- devolve vazio. Sempre inclui a empresa do próprio contrato (é o padrão).
CREATE OR REPLACE FUNCTION public.fn_contrato_empresas_faturadoras(p_contrato_id uuid)
 RETURNS TABLE(company_id uuid, nome text, atual boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN; END IF;
  -- guarda: usuário só vê se tem acesso à empresa do contrato (interno/service_role passam)
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT co.id,
         COALESCE(NULLIF(btrim(co.nome_fantasia),''), co.razao_social, co.id::text) AS nome,
         (co.id = COALESCE(v_c.empresa_faturadora_id, v_c.company_id)) AS atual
  FROM companies co
  WHERE
    -- a própria empresa do contrato é sempre uma opção (o padrão)
    co.id = v_c.company_id
    OR (
      -- demais empresas do MESMO grupo às quais o usuário tem acesso
      co.group_id IS NOT NULL
      AND co.group_id = (SELECT group_id FROM companies WHERE id = v_c.company_id)
      AND (v_interno OR auth.role()='service_role' OR is_admin() OR co.id IN (SELECT get_user_company_ids()))
    )
  ORDER BY (co.id = v_c.company_id) DESC, nome;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_contrato_empresas_faturadoras(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_empresas_faturadoras(uuid) TO authenticated, service_role;

-- 3) Definir a empresa faturadora (fail-closed) ------------------------------------------
-- Valida: contrato existe + acesso à empresa do contrato; empresa escolhida no MESMO grupo e
-- com acesso do usuário (ou a própria empresa do contrato). NULL volta ao padrão (empresa do
-- contrato). Não permite trocar com contrato já ativo (parcelas já geradas na empresa anterior).
CREATE OR REPLACE FUNCTION public.fn_contrato_definir_empresa_faturadora(p_contrato_id uuid, p_empresa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_grp uuid; v_grp_alvo uuid;
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_c.status = 'ativo' THEN
    RETURN jsonb_build_object('ok',false,'erro','contrato_ja_ativo'); END IF;

  -- NULL ou a própria empresa do contrato → padrão (grava NULL = usa company_id)
  IF p_empresa_id IS NULL OR p_empresa_id = v_c.company_id THEN
    UPDATE erp_contratos SET empresa_faturadora_id = NULL, updated_at = now() WHERE id = p_contrato_id;
    RETURN jsonb_build_object('ok',true,'empresa_faturadora_id', v_c.company_id, 'padrao', true);
  END IF;

  -- mesmo grupo
  SELECT group_id INTO v_grp FROM companies WHERE id = v_c.company_id;
  SELECT group_id INTO v_grp_alvo FROM companies WHERE id = p_empresa_id;
  IF v_grp IS NULL OR v_grp_alvo IS NULL OR v_grp <> v_grp_alvo THEN
    RETURN jsonb_build_object('ok',false,'erro','empresa_fora_do_grupo'); END IF;

  -- acesso do usuário à empresa escolhida (fail-closed; interno/admin/service_role passam)
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin() OR p_empresa_id IN (SELECT get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso_empresa_faturadora'); END IF;

  UPDATE erp_contratos SET empresa_faturadora_id = p_empresa_id, updated_at = now() WHERE id = p_contrato_id;
  RETURN jsonb_build_object('ok',true,'empresa_faturadora_id', p_empresa_id, 'padrao', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_contrato_definir_empresa_faturadora(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_definir_empresa_faturadora(uuid, uuid) TO authenticated, service_role;

-- 4) Geradores de título: receber nasce na EMPRESA QUE FATURA -----------------------------
-- Reprodução IDÊNTICA à definição viva; única mudança: company_id do erp_receber passa a
-- COALESCE(v_contrato.empresa_faturadora_id, v_contrato.company_id). Eventos e agregados do
-- contrato permanecem na empresa do contrato.
CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_parcelas(p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  IF v_contrato.status != 'ativo' THEN RETURN jsonb_build_object('success', false, 'error', format('contrato %s nao esta ativo', v_contrato.status)); END IF;

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

REVOKE ALL ON FUNCTION public.fn_contrato_gerar_parcelas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_gerar_parcelas(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_receber(p_contrato_id uuid, p_mes_referencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato record; v_ref_externa text; v_data_vencimento date; v_descricao text;
  v_receber_id uuid; v_already_exists boolean; v_empresa_fat uuid;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'contrato nao encontrado'); END IF;
  -- guarda de empresa (005d9881): sem JWT (cron/interno) ou service_role passa; usuário só na própria empresa.
  IF coalesce(current_setting('request.jwt.claims', true), '') <> '' AND auth.role() <> 'service_role'
     AND v_contrato.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501'; END IF;
  IF v_contrato.status != 'ativo' THEN
    RETURN jsonb_build_object('success', false, 'error', format('contrato esta com status %s, nao pode gerar fatura', v_contrato.status)); END IF;
  IF v_contrato.data_inicio > p_mes_referencia THEN
    RETURN jsonb_build_object('success', false, 'error', 'mes de referencia anterior ao inicio do contrato'); END IF;
  IF v_contrato.data_fim IS NOT NULL AND v_contrato.data_fim < p_mes_referencia THEN
    RETURN jsonb_build_object('success', false, 'error', 'mes de referencia posterior ao fim do contrato'); END IF;

  v_empresa_fat := COALESCE(v_contrato.empresa_faturadora_id, v_contrato.company_id);
  v_data_vencimento := date_trunc('month', p_mes_referencia)::date + (COALESCE(v_contrato.dia_vencimento, 10) - 1) * interval '1 day';
  v_ref_externa := format('contrato:%s:mes:%s', v_contrato.id, to_char(p_mes_referencia, 'YYYY-MM'));

  SELECT EXISTS(SELECT 1 FROM erp_receber WHERE ref_externa_sistema = 'contrato_recorrente' AND ref_externa_id = v_ref_externa) INTO v_already_exists;
  IF v_already_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'fatura ja gerada para este mes', 'ref_externa', v_ref_externa, 'idempotente', true); END IF;

  v_descricao := format('%s - Ref. %s', v_contrato.nome, to_char(p_mes_referencia, 'MM/YYYY'));

  INSERT INTO erp_receber (
    company_id, cliente_id, cliente_nome, descricao, categoria, valor,
    data_emissao, data_vencimento, data_competencia, status, forma_pagamento, centro_custo,
    linha_negocio, observacoes, recorrente, ref_externa_id, ref_externa_sistema, contrato_id
  ) VALUES (
    v_empresa_fat, v_contrato.cliente_id, v_contrato.cliente_nome, v_descricao,
    'Receita Recorrente', COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal),
    p_mes_referencia, v_data_vencimento, date_trunc('month', v_data_vencimento)::date, 'aberto', v_contrato.forma_pagamento, NULL,
    v_contrato.tipo, format('Gerado automaticamente do contrato %s em %s', v_contrato.numero, now()::date),
    true, v_ref_externa, 'contrato_recorrente', v_contrato.id
  ) RETURNING id INTO v_receber_id;

  UPDATE erp_contratos SET ultimo_titulo_gerado_em = CURRENT_DATE,
      total_titulos_gerados = COALESCE(total_titulos_gerados, 0) + 1,
      total_faturado = COALESCE(total_faturado, 0) + COALESCE(valor_atual, valor_mensal), updated_at = now()
  WHERE id = p_contrato_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, created_at)
  VALUES (p_contrato_id, v_contrato.company_id, 'fatura_gerada',
    format('Fatura gerada para %s no valor de R$ %s', to_char(p_mes_referencia, 'MM/YYYY'),
      to_char(COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal), 'FM999999990.00')),
    jsonb_build_object('receber_id', v_receber_id, 'ref_externa', v_ref_externa,
      'data_vencimento', v_data_vencimento, 'valor', COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal),
      'empresa_faturadora', v_empresa_fat), now());

  RETURN jsonb_build_object('success', true, 'receber_id', v_receber_id, 'ref_externa', v_ref_externa,
    'valor', COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal), 'data_vencimento', v_data_vencimento);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_contrato_gerar_receber(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_gerar_receber(uuid, date) TO authenticated, service_role;

-- 5) RD-95: "?" do campo "Empresa que fatura" --------------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('contrato.empresa_faturadora','/dashboard/contratos','Faturamento','Empresa que fatura',
   'Escolha qual empresa do grupo vai FATURAR este contrato. A lista traz só as empresas do mesmo grupo econômico às quais você tem acesso. O padrão é a própria empresa do contrato.',
   'As parcelas, as contas a receber e a nota fiscal nascem na empresa escolhida. O contrato, o job e a produção continuam na empresa onde o contrato foi aberto. É a decisão do financeiro — o comercial não escolhe.',
   'Contrato aberto na agência do grupo, mas faturado pela produtora do mesmo grupo.',
   'Só aparece a empresa do contrato? Então não há outra empresa do mesmo grupo com o seu acesso. A escolha também não pode mudar depois que o contrato já está ativo.',
   'ge', 60, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
