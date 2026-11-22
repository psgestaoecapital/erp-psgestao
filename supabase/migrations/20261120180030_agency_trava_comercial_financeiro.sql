-- CEO 18/11 (Pdois · Parte B): TRAVAR a obrigatoriedade comercial→financeiro. O elo que gera cobrança não pode
-- avançar sem os dados. Antes, fn_agency_contrato_solicitar_financeiro só exigia recorrente+fee+cliente (ignorava
-- CNPJ, serviço e nº de parcelas; projeto nem passava) e fn_agency_proposta_aprovar não exigia ao menos 1 serviço.
-- Agora ambas devolvem `faltando: [...]` e BLOQUEIAM; o elo passa a cobrir também PROJETO (valor + parcelas).
--
-- Obrigatórios (CEO): (1) cliente vinculado COM documento (CNPJ/CPF); (2) ao menos 1 serviço/item;
-- (3) valor+forma — recorrente: fee_mensal>0 + dia_vencimento; projeto: valor_projeto>0 + nº de parcelas.
-- Aditiva (RD-97): + coluna numero_parcelas em agency_contratos; helper de validação; funções recriadas (DROP+CREATE
-- do listar só p/ ganhar a coluna faltando — mesmo nome, redefinir). Não apaga nem altera dado de cliente.
-- SENSÍVEL (elo de cobrança) → revisao-eng-chefe + MERGE AUTORIZADO.

-- ───────────── 1) Coluna de parcelas (projeto) ─────────────
ALTER TABLE public.agency_contratos ADD COLUMN IF NOT EXISTS numero_parcelas integer;

-- ───────────── 2) Helper: o que falta num contrato da P&M p/ ir ao financeiro ─────────────
CREATE OR REPLACE FUNCTION public.fn__agency_contrato_faltando(p_contrato_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r     agency_contratos%ROWTYPE;
  v_doc   text;
  v_itens integer;
  v_falta text[] := '{}';
BEGIN
  SELECT * INTO v_r FROM agency_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN ARRAY['contrato_nao_encontrado']; END IF;

  -- (1) cliente vinculado COM documento (casa com a Parte A: nada de cliente em branco)
  IF v_r.erp_cliente_id IS NULL THEN
    v_falta := v_falta || 'cliente';
  ELSE
    SELECT NULLIF(btrim(COALESCE(cnpj_cpf, cpf_cnpj)), '') INTO v_doc
      FROM erp_clientes WHERE id = v_r.erp_cliente_id AND company_id = v_r.company_id;
    IF v_doc IS NULL THEN v_falta := v_falta || 'cnpj_cliente'; END IF;
  END IF;

  -- (2) ao menos 1 serviço/item
  SELECT count(*) INTO v_itens FROM agency_contrato_itens
   WHERE contrato_id = p_contrato_id AND deleted_at IS NULL;
  IF v_itens = 0 THEN v_falta := v_falta || 'servico'; END IF;

  -- (3) valor + forma de cobrança por tipo
  IF v_r.tipo = 'projeto' THEN
    IF COALESCE(v_r.valor_projeto, 0) <= 0 THEN v_falta := v_falta || 'valor_projeto'; END IF;
    IF COALESCE(v_r.numero_parcelas, 0) < 1 THEN v_falta := v_falta || 'parcelas'; END IF;
  ELSE  -- recorrente (padrão)
    IF COALESCE(v_r.fee_mensal, 0) <= 0 THEN v_falta := v_falta || 'fee_mensal'; END IF;
    IF v_r.dia_vencimento IS NULL OR v_r.dia_vencimento < 1 OR v_r.dia_vencimento > 31 THEN
      v_falta := v_falta || 'dia_vencimento';
    END IF;
  END IF;

  RETURN v_falta;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn__agency_contrato_faltando(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__agency_contrato_faltando(uuid) TO authenticated, service_role;

-- ───────────── 3) Solicitar financeiro: trava dura + cobre projeto ─────────────
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_solicitar_financeiro(p_agency_contrato_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_r   public.agency_contratos%ROWTYPE;
  v_cli public.erp_clientes%ROWTYPE;
  v_num varchar;
  v_nome varchar;
  v_erp uuid;
  v_ano text := to_char(current_date, 'YYYY');
  v_falta text[];
  v_projeto boolean;
  v_valor_mensal numeric;
  v_parcelas integer;
BEGIN
  SELECT * INTO v_r FROM agency_contratos WHERE id = p_agency_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado');
  END IF;

  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = ''
          OR auth.role() = 'service_role'
          OR v_r.company_id IN (SELECT get_user_company_ids())
          OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- Idempotente: já ligado ao financeiro → nada a fazer.
  IF v_r.erp_contrato_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_vinculado', true, 'erp_contrato_id', v_r.erp_contrato_id);
  END IF;

  -- TRAVA: não avança sem os obrigatórios (lista exata do que falta; o botão mostra).
  v_falta := fn__agency_contrato_faltando(p_agency_contrato_id);
  IF COALESCE(array_length(v_falta, 1), 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', v_falta[1], 'faltando', to_jsonb(v_falta));
  END IF;

  SELECT * INTO v_cli FROM erp_clientes
   WHERE id = v_r.erp_cliente_id AND company_id = v_r.company_id;

  v_projeto := (v_r.tipo = 'projeto');
  v_parcelas := CASE WHEN v_projeto THEN v_r.numero_parcelas ELSE NULL END;
  v_valor_mensal := CASE WHEN v_projeto
                         THEN round(v_r.valor_projeto / GREATEST(COALESCE(v_r.numero_parcelas, 1), 1), 2)
                         ELSE v_r.fee_mensal END;

  PERFORM pg_advisory_xact_lock(hashtextextended('ctr_num:' || v_r.company_id::text || v_ano, 0));
  v_num := next_contrato_numero(v_r.company_id);

  v_nome := 'Contrato ' || CASE WHEN v_projeto THEN 'por projeto' ELSE 'recorrente' END || ' P&M — '
            || COALESCE(NULLIF(btrim(v_cli.nome_fantasia), ''),
                        NULLIF(btrim(v_cli.razao_social), ''), 'cliente');

  INSERT INTO erp_contratos (
    company_id, numero, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone,
    tipo, nome, valor_mensal, valor_atual, numero_parcelas, data_inicio, data_fim, dia_vencimento,
    periodicidade, natureza, status, proposta_id, solicitante_id, origem, created_by
  ) VALUES (
    v_r.company_id, v_num, v_r.erp_cliente_id,
    COALESCE(NULLIF(btrim(v_cli.nome_fantasia), ''), NULLIF(btrim(v_cli.razao_social), '')),
    NULLIF(btrim(COALESCE(v_cli.cnpj_cpf, v_cli.cpf_cnpj)), ''),
    NULLIF(btrim(v_cli.email), ''),
    NULLIF(btrim(COALESCE(v_cli.telefone, v_cli.celular)), ''),
    'agencia_pm', v_nome, v_valor_mensal, v_valor_mensal, v_parcelas,
    COALESCE(v_r.data_inicio, current_date), v_r.data_fim,
    COALESCE(v_r.dia_vencimento, 10), 'mensal', 'receita',
    'solicitado', v_r.proposta_id, auth.uid(), 'agency_contrato', auth.uid()
  ) RETURNING id INTO v_erp;

  UPDATE agency_contratos
     SET erp_contrato_id = v_erp, atualizado_em = now()
   WHERE id = p_agency_contrato_id;

  RETURN jsonb_build_object('ok', true, 'erp_contrato_id', v_erp, 'numero', v_num, 'status', 'solicitado',
                            'tipo', CASE WHEN v_projeto THEN 'projeto' ELSE 'recorrente' END);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_contrato_solicitar_financeiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_solicitar_financeiro(uuid) TO authenticated, service_role;

-- ───────────── 4) Listar: devolve `faltando` por contrato (o front desabilita e mostra a lista) ─────────────
DROP FUNCTION IF EXISTS public.fn_agency_contrato_listar(uuid);
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_listar(p_company_id uuid)
 RETURNS TABLE(contrato_id uuid, cliente_nome text, erp_cliente_id uuid, proposta_id uuid, tipo text,
               fee_mensal numeric, ge_valor_mensal numeric, erp_contrato_id uuid, tem_contrato_ge boolean,
               status text, data_inicio date, itens_total integer, itens_a_mais integer, escopo_status text,
               faltando text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  RETURN QUERY
  SELECT c.id,
    COALESCE(ac.nome_fantasia, ac.nome, ec.nome_fantasia, ec.razao_social, '—'),
    c.erp_cliente_id, c.proposta_id, c.tipo,
    c.fee_mensal, gc.valor_atual, c.erp_contrato_id, (c.erp_contrato_id IS NOT NULL),
    c.status, c.data_inicio,
    (SELECT count(*)::int FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id) AS itens_total,
    (SELECT count(*)::int FROM agency_contrato_itens ci
       CROSS JOIN LATERAL fn_agency_item_janela(ci.periodicidade, CURRENT_DATE) jn
       WHERE ci.contrato_id = c.id AND ci.quantidade_contratada IS NOT NULL
         AND (SELECT count(*) FROM agency_jobs j
              WHERE j.contrato_id = c.id AND j.excluido_em IS NULL
                AND j.status NOT IN ('cancelado','cancelada')
                AND ((ci.servico_id IS NOT NULL AND j.servico_id = ci.servico_id)
                     OR (ci.servico_id IS NULL AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico))))
                AND (jn.ini IS NULL OR (j.created_at::date >= jn.ini AND j.created_at::date < jn.fim))
             ) > ci.quantidade_contratada) AS itens_a_mais,
    CASE WHEN (SELECT count(*) FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id) = 0
         THEN 'sem_escopo' ELSE 'com_escopo' END AS escopo_status,
    fn__agency_contrato_faltando(c.id) AS faltando
  FROM agency_contratos c
  LEFT JOIN agency_clientes ac ON ac.id = c.cliente_id
  LEFT JOIN erp_clientes ec ON ec.id = c.erp_cliente_id
  LEFT JOIN erp_contratos gc ON gc.id = c.erp_contrato_id
  WHERE c.company_id = p_company_id
  ORDER BY c.criado_em DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_contrato_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_listar(uuid) TO authenticated, service_role;

-- ───────────── 5) Aprovar proposta: ao menos 1 serviço SEMPRE + lista `faltando` (mantém a trava fee existente) ─────────────
CREATE OR REPLACE FUNCTION public.fn_agency_proposta_aprovar(p_proposta_id uuid, p_fee_mensal numeric DEFAULT NULL::numeric, p_dia_vencimento integer DEFAULT 10, p_periodicidade text DEFAULT 'mensal'::text, p_data_inicio date DEFAULT NULL::date, p_comissao_percentual numeric DEFAULT 0, p_comissao_tipo text DEFAULT 'unica'::text, p_comissao_base text DEFAULT 'contrato'::text, p_numero_parcelas integer DEFAULT NULL::integer, p_data_fim date DEFAULT NULL::date, p_cliente_email text DEFAULT NULL::text, p_cliente_telefone text DEFAULT NULL::text, p_data_primeiro_vencimento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p agency_propostas%ROWTYPE;
  v_uid uuid := auth.uid();
  v_fee numeric; v_ini date; v_venc1 date; v_contrato uuid; v_num text;
  v_base numeric; v_pct numeric; v_valcom numeric; v_comissao uuid;
  v_cli_fk uuid; v_cli_nome text; v_cli_doc text; v_escopo text; v_objeto text;
  v_cli_email text; v_cli_tel text;
  v_resp uuid; v_n_fin int; v_existente uuid;
  v_falta text[] := '{}'; v_n_itens int;
BEGIN
  SELECT * INTO v_p FROM agency_propostas WHERE id = p_proposta_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta não encontrada'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  -- Idempotência: proposta já aprovada / contrato já existe → não revalida nem recria.
  SELECT id INTO v_existente FROM erp_contratos
   WHERE proposta_id = p_proposta_id AND COALESCE(status,'') NOT IN ('cancelado','excluido')
   ORDER BY created_at LIMIT 1;
  IF v_p.status = 'aprovada' OR v_existente IS NOT NULL THEN
    SELECT id INTO v_comissao FROM agency_comissao WHERE proposta_id = p_proposta_id ORDER BY criado_em LIMIT 1;
    IF v_p.status <> 'aprovada' OR v_p.contrato_id IS DISTINCT FROM v_existente THEN
      UPDATE agency_propostas
         SET status = 'aprovada', data_aprovacao = COALESCE(data_aprovacao, now()),
             contrato_id = COALESCE(contrato_id, v_existente), updated_at = now()
       WHERE id = p_proposta_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'ja_aprovada', true,
      'contrato_id', COALESCE(v_p.contrato_id, v_existente), 'comissao_id', v_comissao);
  END IF;

  SELECT count(*) INTO v_n_fin FROM user_companies WHERE company_id = v_p.company_id AND role = 'financeiro';
  IF v_n_fin = 1 THEN SELECT user_id INTO v_resp FROM user_companies WHERE company_id = v_p.company_id AND role = 'financeiro'; END IF;

  v_cli_fk := v_p.erp_cliente_id;
  v_cli_nome := COALESCE((SELECT COALESCE(nome_fantasia, razao_social) FROM erp_clientes WHERE id = v_p.erp_cliente_id),
                         (SELECT COALESCE(nome_fantasia, nome) FROM agency_clientes WHERE id = v_p.cliente_id), 'Cliente');
  v_cli_doc  := COALESCE((SELECT NULLIF(btrim(cnpj_cpf),'') FROM erp_clientes WHERE id = v_p.erp_cliente_id),
                         (SELECT NULLIF(btrim(cnpj_cpf),'') FROM agency_clientes WHERE id = v_p.cliente_id));
  -- CONTATO (gap 1): do param (editado no front) ou do cadastro do cliente (erp_clientes) da MESMA empresa.
  v_cli_email := COALESCE(NULLIF(btrim(p_cliente_email),''), (SELECT NULLIF(btrim(email),'') FROM erp_clientes WHERE id = v_p.erp_cliente_id));
  v_cli_tel   := COALESCE(NULLIF(btrim(p_cliente_telefone),''), (SELECT NULLIF(btrim(COALESCE(celular, whatsapp, telefone)),'') FROM erp_clientes WHERE id = v_p.erp_cliente_id));

  SELECT COALESCE(SUM(valor_total),0) INTO v_fee FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
  IF v_fee = 0 THEN v_fee := COALESCE(v_p.valor_final, v_p.valor_total, 0); END IF;
  v_fee := COALESCE(p_fee_mensal, v_fee);
  SELECT string_agg(format('• %s (%s x R$ %s)', descricao, quantidade, to_char(valor_unitario,'FM999999990.00')), E'\n' ORDER BY ordem)
    INTO v_escopo FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
  v_objeto := NULLIF(btrim(v_p.descricao),'');
  v_ini := COALESCE(p_data_inicio, current_date);
  v_venc1 := p_data_primeiro_vencimento;

  -- SPEC Parte B · TRAVA (fail-closed, devolve a lista do que falta):
  --   ao menos 1 serviço/item SEMPRE; e, quando nasce contrato de fee (>0), todos os obrigatórios do financeiro.
  SELECT count(*) INTO v_n_itens FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
  IF v_n_itens = 0 THEN v_falta := v_falta || 'servico'; END IF;

  IF COALESCE(v_fee,0) > 0 THEN
    IF COALESCE(btrim(v_p.titulo),'') = '' THEN v_falta := v_falta || 'titulo_obrigatorio'; END IF;
    IF COALESCE(btrim(v_cli_doc),'') = '' THEN v_falta := v_falta || 'cnpj_cliente_obrigatorio'; END IF;
    IF v_cli_email IS NULL AND v_cli_tel IS NULL THEN v_falta := v_falta || 'contato_obrigatorio'; END IF;
    IF p_dia_vencimento IS NULL THEN v_falta := v_falta || 'dia_vencimento_obrigatorio';
    ELSIF p_dia_vencimento < 1 OR p_dia_vencimento > 28 THEN v_falta := v_falta || 'dia_vencimento_invalido'; END IF;
    IF p_numero_parcelas IS NULL THEN v_falta := v_falta || 'numero_parcelas_obrigatorio';
    ELSIF p_numero_parcelas < 1 THEN v_falta := v_falta || 'numero_parcelas_invalido'; END IF;
    IF p_data_fim IS NULL THEN v_falta := v_falta || 'vigencia_fim_obrigatoria';
    ELSIF p_data_fim < v_ini THEN v_falta := v_falta || 'vigencia_invalida'; END IF;
    IF v_venc1 IS NULL THEN v_falta := v_falta || 'primeiro_vencimento_obrigatorio'; END IF;
  END IF;

  IF COALESCE(array_length(v_falta,1),0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', v_falta[1], 'faltando', to_jsonb(v_falta));
  END IF;

  v_num := next_contrato_numero(v_p.company_id);

  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone, tipo, nome, objeto, escopo,
      valor_mensal, valor_atual, data_inicio, data_fim, data_primeiro_vencimento, dia_vencimento, periodicidade, numero_parcelas, forma_pagamento, condicao_pagamento,
      status, origem, proposta_id, solicitante_id, responsavel_id, natureza, created_by, observacoes)
  VALUES (v_p.company_id, v_num, v_cli_fk, v_cli_nome, v_cli_doc, v_cli_email, v_cli_tel, 'servico', v_p.titulo, v_objeto, v_escopo,
      v_fee, v_fee, v_ini, p_data_fim, v_venc1, COALESCE(p_dia_vencimento,10), COALESCE(p_periodicidade,'mensal'), p_numero_parcelas, 'boleto', NULLIF(btrim(v_p.condicao_pagamento),''),
      'solicitado', 'proposta', p_proposta_id, v_uid, v_resp, 'receita', v_uid,
      'Pedido de contrato gerado na aprovação da proposta ' || COALESCE(v_p.numero, v_p.id::text))
  RETURNING id INTO v_contrato;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (v_contrato, v_p.company_id, 'solicitado',
    format('Pedido de contrato gerado na aprovação da proposta%s', CASE WHEN v_resp IS NULL THEN ' — sem responsável financeiro definido' ELSE '' END),
    jsonb_build_object('proposta_id', p_proposta_id, 'responsavel_id', v_resp, 'n_financeiro', v_n_fin, 'origem', 'aprovacao'), v_uid, now());

  v_pct  := COALESCE(p_comissao_percentual, 0);
  v_base := CASE WHEN p_comissao_base = 'fee' THEN v_fee ELSE COALESCE(v_p.valor_final, 0) END;
  v_valcom := round(v_base * v_pct / 100.0, 2);
  INSERT INTO agency_comissao (company_id, proposta_id, vendedor_id, base_valor, percentual, valor_comissao, competencia, status, tipo)
  VALUES (v_p.company_id, p_proposta_id, v_p.responsavel_id, v_base, v_pct, v_valcom, date_trunc('month', v_ini)::date, 'prevista', COALESCE(p_comissao_tipo,'unica'))
  RETURNING id INTO v_comissao;

  UPDATE agency_propostas SET status = 'aprovada', data_aprovacao = now(), contrato_id = v_contrato, updated_at = now()
   WHERE id = p_proposta_id;

  IF v_resp IS NOT NULL THEN
    INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    VALUES (v_p.company_id, v_resp, 'contrato_solicitado', 'Contrato solicitado ' || v_num,
      format('%s — %s', COALESCE(v_cli_nome,'cliente'), COALESCE(v_p.titulo,'proposta aprovada')),
      '/dashboard/contratos?tab=fee&c=' || v_contrato, 'erp_contratos', v_contrato, v_uid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'contrato_id', v_contrato, 'contrato_numero', v_num,
    'comissao_id', v_comissao, 'valor_comissao', v_valcom, 'fee_mensal', v_fee,
    'aviso', CASE WHEN v_resp IS NULL THEN 'sem responsável financeiro único (0 ou >1) — defina manualmente' ELSE NULL END);
END $function$;

REVOKE ALL ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, integer, text, date, numeric, text, text, integer, date, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_aprovar(uuid, numeric, integer, text, date, numeric, text, text, integer, date, text, text, date) TO authenticated, service_role;
