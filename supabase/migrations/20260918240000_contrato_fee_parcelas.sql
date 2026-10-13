-- #59 PDOIS — Solicitação de contrato + CONTRATO DE FEE com parcelas (padrão SIGA "Adicionar Fee").
-- Contexto 41707b67 · onda P3+P4 do P&M · atende também #57 (anexar contrato). RD-26/38/65/67/30/34.
-- Decisões A/B do P&M: colunas na GE (erp_contratos); /pm/contratos é atalho filtrado. Nada de tela paralela.
-- Idempotente (deploy-migrations aplica no merge; sem carimbo de ledger à mão).

-- ── 1 · Colunas novas em erp_contratos (reusa `nome` como título; não cria coluna titulo) ──────────
ALTER TABLE public.erp_contratos
  ADD COLUMN IF NOT EXISTS proposta_id          uuid REFERENCES public.agency_propostas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS solicitante_id       uuid,
  ADD COLUMN IF NOT EXISTS responsavel_id       uuid,
  ADD COLUMN IF NOT EXISTS prazo_desejado       date,
  ADD COLUMN IF NOT EXISTS origem               text,
  ADD COLUMN IF NOT EXISTS codigo_identificador text,
  ADD COLUMN IF NOT EXISTS texto_legal          text;

-- ── 2 · CHECK de status (lista completa; inclui os existentes: só 'ativo'/'excluido' hoje). RD-30 ──
DO $$
BEGIN
  -- só cria o CHECK se nenhuma linha atual violar a lista (conferido: distinct = ativo,excluido).
  IF NOT EXISTS (
    SELECT 1 FROM public.erp_contratos
    WHERE status IS NOT NULL AND status NOT IN (
      'solicitado','em_elaboracao','aguardando_informacoes','em_revisao','aguardando_aprovacao',
      'ativo','cancelado','suspenso','encerrado','excluido'
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_contratos_status_check2'
  ) THEN
    ALTER TABLE public.erp_contratos ADD CONSTRAINT erp_contratos_status_check2 CHECK (
      status IS NULL OR status IN (
        'solicitado','em_elaboracao','aguardando_informacoes','em_revisao','aguardando_aprovacao',
        'ativo','cancelado','suspenso','encerrado','excluido'
      )
    );
  END IF;
END $$;

-- ── 3 · Plano de parcelas do fee ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_contrato_parcelas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id       uuid NOT NULL REFERENCES public.erp_contratos(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL,
  numero            int  NOT NULL,
  vencimento        date NOT NULL,
  valor             numeric NOT NULL DEFAULT 0,
  conta_bancaria_id uuid REFERENCES public.erp_banco_contas(id) ON DELETE SET NULL,
  forma_pagamento   text,
  pagador_cliente_id uuid,
  receber_id        uuid REFERENCES public.erp_receber(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contrato_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_contrato_parcelas_contrato ON public.erp_contrato_parcelas(contrato_id);
CREATE INDEX IF NOT EXISTS idx_contrato_parcelas_company  ON public.erp_contrato_parcelas(company_id);

ALTER TABLE public.erp_contrato_parcelas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contrato_parcelas_tenant ON public.erp_contrato_parcelas;
CREATE POLICY contrato_parcelas_tenant ON public.erp_contrato_parcelas
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_contrato_parcelas TO authenticated, service_role;

-- ── 4 · fn_contrato_gerar_receber: comportamento ATUAL + grava data_competencia (mês do vencimento) ─
CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_receber(p_contrato_id uuid, p_mes_referencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato record; v_ref_externa text; v_data_vencimento date; v_descricao text;
  v_receber_id uuid; v_already_exists boolean;
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
    v_contrato.company_id, v_contrato.cliente_id, v_contrato.cliente_nome, v_descricao,
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
      'data_vencimento', v_data_vencimento, 'valor', COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal)), now());

  RETURN jsonb_build_object('success', true, 'receber_id', v_receber_id, 'ref_externa', v_ref_externa,
    'valor', COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal), 'data_vencimento', v_data_vencimento);
END;
$function$;

-- ── 5 · Gerador do PLANO de parcelas (fee finito). Mesma escrita de erp_receber do recorrente (RD-65),
--        mas 1 título POR PARCELA, idempotente por parcela (ref 'contrato_parcela'), competência = mês
--        da parcela. Só status 'ativo'. Não duplica: pula parcela que já tem receber_id vivo. ────────
CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_parcelas(p_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato record; v_p record; v_ref text; v_receber_id uuid; v_gerados int := 0; v_pulados int := 0; v_total numeric := 0;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'contrato nao encontrado'); END IF;
  -- guarda de empresa (005d9881): sem JWT (cron/interno) ou service_role passa; usuário só na própria empresa.
  IF coalesce(current_setting('request.jwt.claims', true), '') <> '' AND auth.role() <> 'service_role'
     AND v_contrato.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501'; END IF;
  IF v_contrato.status != 'ativo' THEN RETURN jsonb_build_object('success', false, 'error', format('contrato %s nao esta ativo', v_contrato.status)); END IF;

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
      v_contrato.company_id, v_contrato.cliente_id, v_contrato.cliente_nome,
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
      jsonb_build_object('gerados', v_gerados, 'pulados', v_pulados, 'total', v_total), now());
  END IF;

  RETURN jsonb_build_object('success', true, 'gerados', v_gerados, 'pulados', v_pulados, 'total', v_total);
END;
$function$;

-- ── 6 · Solicitar elaboração de contrato (comercial). Cria 'solicitado', copia da proposta quando houver. ─
CREATE OR REPLACE FUNCTION public.fn_contrato_solicitar(
  p_company_id uuid, p_proposta_id uuid DEFAULT NULL, p_dados jsonb DEFAULT '{}'::jsonb,
  p_prazo_desejado date DEFAULT NULL, p_observacoes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_numero varchar; v_id uuid; v_prop record; v_resp uuid; v_n_fin int;
  v_cli_id uuid; v_cli_nome text; v_valor numeric; v_escopo text; v_titulo text; v_origem text;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','company_id_ausente'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  -- responsável = único usuário com role 'financeiro' na empresa (0 ou >1 → nulo + aviso)
  SELECT count(*) INTO v_n_fin FROM user_companies WHERE company_id = p_company_id AND role = 'financeiro';
  IF v_n_fin = 1 THEN SELECT user_id INTO v_resp FROM user_companies WHERE company_id = p_company_id AND role = 'financeiro'; END IF;

  IF p_proposta_id IS NOT NULL THEN
    SELECT * INTO v_prop FROM agency_propostas WHERE id = p_proposta_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','proposta_nao_encontrada'); END IF;
    v_origem := 'proposta';
    v_cli_id := COALESCE(v_prop.erp_cliente_id, v_prop.cliente_id);
    v_titulo := COALESCE(NULLIF(btrim(v_prop.titulo),''), 'Contrato da proposta '||v_prop.numero);
    -- valor RECALCULADO dos itens (fonte da verdade), fallback ao valor_final da proposta
    SELECT COALESCE(SUM(valor_total),0) INTO v_valor FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
    IF v_valor = 0 THEN v_valor := COALESCE(v_prop.valor_final, v_prop.valor_total, 0); END IF;
    SELECT string_agg(format('• %s (%s x R$ %s)', descricao, quantidade, to_char(valor_unitario,'FM999999990.00')), E'\n' ORDER BY ordem)
      INTO v_escopo FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
  ELSE
    v_origem := 'manual';
    v_cli_id := NULLIF(p_dados->>'cliente_id','')::uuid;
    v_titulo := COALESCE(NULLIF(btrim(p_dados->>'titulo'),''), NULLIF(btrim(p_dados->>'nome'),''), 'Contrato');
    v_valor := COALESCE(NULLIF(p_dados->>'valor_mensal','')::numeric, 0);
    v_escopo := NULLIF(p_dados->>'escopo','');
  END IF;
  v_cli_nome := COALESCE(NULLIF(btrim(p_dados->>'cliente_nome'),''), (SELECT COALESCE(nome_fantasia, razao_social) FROM erp_clientes WHERE id = v_cli_id));

  v_numero := next_contrato_numero(p_company_id);
  -- data_inicio é NOT NULL na tabela; no 'solicitado' é um placeholder (o real é definido na elaboração/fee form).
  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, tipo, nome, escopo,
    valor_mensal, valor_atual, data_inicio, status, origem, proposta_id, solicitante_id, responsavel_id,
    prazo_desejado, observacoes, codigo_identificador, natureza, created_by)
  VALUES (p_company_id, v_numero, v_cli_id, v_cli_nome,
    COALESCE(NULLIF(btrim(p_dados->>'tipo'),''),'servico'), v_titulo, v_escopo,
    v_valor, v_valor, COALESCE(NULLIF(p_dados->>'data_inicio','')::date, CURRENT_DATE), 'solicitado', v_origem, p_proposta_id, v_uid, v_resp,
    p_prazo_desejado, p_observacoes, NULLIF(btrim(p_dados->>'codigo_identificador'),''), 'receita', v_uid)
  RETURNING id INTO v_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (v_id, p_company_id, 'solicitado',
    format('Contrato solicitado (%s)%s', v_origem, CASE WHEN v_resp IS NULL THEN ' — sem responsável financeiro definido' ELSE '' END),
    jsonb_build_object('proposta_id', p_proposta_id, 'responsavel_id', v_resp, 'n_financeiro', v_n_fin), v_uid, now());

  RETURN jsonb_build_object('ok', true, 'contrato_id', v_id, 'numero', v_numero, 'responsavel_id', v_resp,
    'aviso', CASE WHEN v_resp IS NULL THEN 'sem responsável financeiro único (0 ou >1) — defina manualmente' ELSE NULL END);
END;
$function$;

-- ── 7 · Gerar plano de parcelas automáticas (botão "Automáticas"). Substitui o plano só se não-ativo. ─
CREATE OR REPLACE FUNCTION public.fn_contrato_parcelas_gerar(
  p_contrato_id uuid, p_primeiro_vencimento date, p_n int, p_valor numeric, p_conta_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = ''; v_i int; v_conta uuid;
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_c.status = 'ativo' THEN RETURN jsonb_build_object('ok',false,'erro','contrato_ativo_nao_edita_plano'); END IF;
  IF p_n IS NULL OR p_n < 1 THEN RETURN jsonb_build_object('ok',false,'erro','n_parcelas_invalido'); END IF;

  v_conta := COALESCE(p_conta_id, (SELECT id FROM erp_banco_contas WHERE company_id = v_c.company_id AND ativo AND COALESCE(principal,false) ORDER BY created_at LIMIT 1));
  DELETE FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;  -- só chega aqui se não-ativo
  FOR v_i IN 1..p_n LOOP
    INSERT INTO erp_contrato_parcelas (contrato_id, company_id, numero, vencimento, valor, conta_bancaria_id, forma_pagamento, pagador_cliente_id)
    VALUES (p_contrato_id, v_c.company_id, v_i,
      (p_primeiro_vencimento + ((v_i-1) || ' month')::interval)::date, COALESCE(p_valor,0), v_conta, v_c.forma_pagamento, v_c.cliente_id);
  END LOOP;
  UPDATE erp_contratos SET valor_mensal = COALESCE(p_valor, valor_mensal), valor_atual = COALESCE(p_valor, valor_atual), updated_at = now() WHERE id = p_contrato_id;
  RETURN jsonb_build_object('ok', true, 'parcelas', p_n, 'conta_bancaria_id', v_conta);
END;
$function$;

-- ── 8 · Salvar plano editado manualmente (+ / X / valor / conta). Substitui o plano (não-ativo). ────
CREATE OR REPLACE FUNCTION public.fn_contrato_parcelas_salvar(p_contrato_id uuid, p_parcelas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  UPDATE erp_contratos SET updated_at = now() WHERE id = p_contrato_id;
  RETURN jsonb_build_object('ok', true, 'parcelas', v_n);
END;
$function$;

-- ── 9 · Transição de status (+ evento). 'aguardando_informacoes' exige mensagem; 'ativo' exige ≥1
--        arquivo tipo 'contrato' e plano com soma>0 → dispara o gerador de parcelas. ────────────────
CREATE OR REPLACE FUNCTION public.fn_contrato_mudar_status(p_contrato_id uuid, p_status text, p_mensagem text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_uid uuid := auth.uid(); v_n_arq int; v_soma numeric; v_ger jsonb;
  v_validos text[] := ARRAY['solicitado','em_elaboracao','aguardando_informacoes','em_revisao','aguardando_aprovacao','ativo','cancelado','suspenso','encerrado'];
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF NOT (p_status = ANY(v_validos)) THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF p_status = 'aguardando_informacoes' AND COALESCE(btrim(p_mensagem),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'erro','mensagem_obrigatoria'); END IF;

  IF p_status = 'ativo' THEN
    SELECT count(*) INTO v_n_arq FROM erp_contratos_arquivos WHERE contrato_id = p_contrato_id AND tipo IN ('contrato','contrato_assinado');
    IF v_n_arq < 1 THEN RETURN jsonb_build_object('ok',false,'erro','anexo_contrato_obrigatorio'); END IF;
    SELECT COALESCE(SUM(valor),0) INTO v_soma FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;
    IF v_soma <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','plano_sem_valor'); END IF;
  END IF;

  UPDATE erp_contratos SET status = p_status, updated_at = now() WHERE id = p_contrato_id;
  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_contrato_id, v_c.company_id, 'status_'||p_status,
    COALESCE(NULLIF(btrim(p_mensagem),''), format('Status alterado de %s para %s', v_c.status, p_status)),
    jsonb_build_object('de', v_c.status, 'para', p_status), v_uid, now());

  IF p_status = 'ativo' THEN v_ger := fn_contrato_gerar_parcelas(p_contrato_id); END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'gerador', v_ger);
END;
$function$;

-- ── 10 · ACL: sem EXECUTE p/ anon/public; só authenticated/service_role (guarda de empresa no corpo) ─
-- fn_contrato_gerar_receber já existia com EXECUTE p/ anon (vazamento pré-existente) — revoga aqui (005d9881).
REVOKE EXECUTE ON FUNCTION public.fn_contrato_gerar_receber(uuid, date) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_gerar_receber(uuid, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_gerar_parcelas(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_solicitar(uuid, uuid, jsonb, date, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_parcelas_gerar(uuid, date, int, numeric, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_parcelas_salvar(uuid, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_gerar_parcelas(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_solicitar(uuid, uuid, jsonb, date, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_parcelas_gerar(uuid, date, int, numeric, uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_parcelas_salvar(uuid, jsonb) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text) TO authenticated, service_role;
