-- CEO 27/11 — Pedido de contrato tem de passar pelo financeiro (controle interno de aprovação / segregação de função).
--
-- Tela: /dashboard/contratos (aba Contratos de fee). Relato do financeiro do piloto P&M (company 36b69d77-...):
-- quem pede o contrato (papel 'socio') criava como 'solicitado' e ELE MESMO ativava minutos depois, gerando parcelas
-- e contas a receber sem o financeiro ver. Provado no dado: contrato 6d8b5842 solicitado 25/11 10:28:54 → ativado
-- 10:29:24 pelo PRÓPRIO solicitante (usuario_id = solicitante_id); 11 casos assim em nov/26.
--
-- Esta migration (crítica — mexe em contas a receber via ativação; revisao-eng-chefe):
--  1) erp_contratos_config.ativacao_pelo_financeiro (DEFAULT false — NÃO liga em ninguém; o cliente liga pela tela).
--  2) fn_contrato_mudar_status: com a opção LIGADA, em_elaboracao/ativo só pelo financeiro/master (ou PS); o SOLICITANTE
--     nunca move o próprio pedido (segregação). Opção DESLIGADA = comportamento IDÊNTICO ao de hoje. Em toda mudança de
--     status grava usuario_id (auth.uid()) E usuario_nome.
--  3) trg_erp_contrato_avisos: aviso no sino para financeiro/master a cada pedido 'solicitado' (mecanismo existente).
--  4) fn_contrato_solicitar: tira o aviso duplicado (o trigger passa a ser a única fonte).
--  5) fn_contratos_fila_financeiro: leitura p/ a tela (pedidos aguardando + ativados sem passar pelo financeiro).
--
-- NÃO altera geração de parcelas/fee além do que já ocorre na ativação. Dado de referência (config/catálogo de ajuda) +
-- funções; não apaga nem altera contrato de cliente. REVOKE anon / GRANT authenticated,service_role (check:fn-guards).

-- ── 1) CONFIG: opção por empresa (aditiva, não liga em ninguém) ──────────────────────────────────────────────────
ALTER TABLE public.erp_contratos_config
  ADD COLUMN IF NOT EXISTS ativacao_pelo_financeiro boolean NOT NULL DEFAULT false;

-- ── 2) fn_contrato_mudar_status: segregação de função + usuario_nome ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_contrato_mudar_status(p_contrato_id uuid, p_status text, p_mensagem text DEFAULT NULL::text, p_gerar_receber boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_uid uuid := auth.uid(); v_n_arq int; v_soma numeric; v_ger jsonb;
  v_exige_anexo boolean; v_nome text;
  v_validos text[] := ARRAY['solicitado','em_elaboracao','aguardando_info','em_revisao','aguardando_aprovacao','ativo','cancelado','suspenso','encerrado'];
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF NOT (p_status = ANY(v_validos)) THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF p_status = 'aguardando_info' AND COALESCE(btrim(p_mensagem),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'erro','mensagem_obrigatoria'); END IF;

  -- SEGREGAÇÃO DE FUNÇÃO (CEO 27/11): só quando a empresa LIGA ativacao_pelo_financeiro. O pedido só vira
  -- em_elaboração/ativo pelas mãos do FINANCEIRO/master (ou PS); o próprio solicitante NUNCA ativa o seu pedido.
  -- Interno/service_role/PS seguem (migrations, rotinas, suporte). Opção desligada → nada muda.
  IF p_status IN ('em_elaboracao','ativo')
     AND NOT (v_interno OR auth.role()='service_role' OR is_admin())
     AND COALESCE((SELECT ativacao_pelo_financeiro FROM erp_contratos_config WHERE company_id = v_c.company_id), false) THEN
    IF v_c.solicitante_id IS NOT NULL AND v_c.solicitante_id = v_uid THEN
      RAISE EXCEPTION 'Pedido enviado ao financeiro — ele elabora e ativa o contrato.' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_companies uc
                   WHERE uc.user_id = v_uid AND uc.company_id = v_c.company_id AND uc.role IN ('financeiro','master')) THEN
      RAISE EXCEPTION 'Pedido enviado ao financeiro — ele elabora e ativa o contrato.' USING ERRCODE='42501';
    END IF;
  END IF;

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

  -- nome do usuário para auditoria do evento (nunca de parâmetro — sempre do auth.uid())
  SELECT COALESCE(NULLIF(btrim(u.full_name),''), u.email) INTO v_nome FROM public.users u WHERE u.id = v_uid;

  UPDATE erp_contratos
     SET status = p_status, updated_at = now(),
         -- 3.4: "já gerado" prevalece — se há conta a receber viva do contrato, nunca marcar sem_contas_receber=true.
         sem_contas_receber = CASE
           WHEN EXISTS (SELECT 1 FROM erp_receber WHERE contrato_id = p_contrato_id AND ref_externa_sistema = 'contrato_parcela' AND deleted_at IS NULL) THEN false
           WHEN p_status = 'ativo' THEN NOT p_gerar_receber
           ELSE sem_contas_receber END
   WHERE id = p_contrato_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, usuario_nome, created_at)
  VALUES (p_contrato_id, v_c.company_id, 'status_'||p_status,
    COALESCE(NULLIF(btrim(p_mensagem),''), format('Status alterado de %s para %s', v_c.status, p_status)),
    jsonb_build_object('de', v_c.status, 'para', p_status), v_uid, v_nome, now());

  IF p_status = 'ativo' THEN
    IF p_gerar_receber THEN
      v_ger := fn_contrato_gerar_parcelas(p_contrato_id);
    ELSE
      -- ativado sem gerar: fica no histórico (quem/quando) para o selo e a auditoria
      INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, usuario_nome, created_at)
      VALUES (p_contrato_id, v_c.company_id, 'ativado_sem_contas_receber',
        'Contrato ativado sem gerar contas a receber (cobrança externa, permuta ou lançamento manual).',
        jsonb_build_object('por', v_uid), v_uid, v_nome, now());
      v_ger := jsonb_build_object('gerados', 0, 'total', 0, 'sem_contas_receber', true);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'gerador', v_ger,
    'sem_contas_receber', CASE WHEN p_status = 'ativo' THEN NOT p_gerar_receber ELSE NULL END);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text, boolean) TO authenticated, service_role;

-- ── 3) trg_erp_contrato_avisos: aviso a financeiro/master no pedido novo (mecanismo existente, texto do CEO) ──────
CREATE OR REPLACE FUNCTION public.trg_erp_contrato_avisos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ci-sem-guarda: trg_erp_contrato_avisos — gatilho do próprio contrato gravado; só grava avisos da empresa DESTE contrato
DECLARE
  v_link text := '/dashboard/contratos?tab=fee&c=' || NEW.id; v_rot text; v_quem text;
  v_roles text[]; v_n int;
BEGIN
  IF COALESCE(NEW.natureza, 'receita') <> 'receita' THEN RETURN NULL; END IF;

  -- (a) pedido novo → financeiro/master da empresa (CEO 27/11). Sem financeiro/master → sócio/acesso_total (não perder o pedido).
  IF TG_OP = 'INSERT' AND NEW.status = 'solicitado' THEN
    SELECT COALESCE(NULLIF(btrim(u.full_name),''), u.email, 'alguém') INTO v_quem
      FROM public.users u WHERE u.id = COALESCE(NEW.solicitante_id, auth.uid());
    SELECT count(*) INTO v_n FROM user_companies WHERE company_id = NEW.company_id AND role IN ('financeiro','master');
    v_roles := CASE WHEN v_n > 0 THEN ARRAY['financeiro','master'] ELSE ARRAY['socio','acesso_total'] END;
    INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    SELECT NEW.company_id, uc.user_id, 'contrato_solicitado', 'Novo pedido de contrato',
           format('Novo pedido de contrato: %s · %s · pedido por %s',
                  COALESCE(NULLIF(btrim(NEW.cliente_nome), ''), 'cliente'),
                  'R$ ' || replace(to_char(COALESCE(NEW.valor_atual, NEW.valor_mensal, 0), 'FM999999990D00'), '.', ','),
                  COALESCE(v_quem, 'alguém')),
           v_link, 'erp_contratos', NEW.id, auth.uid()
      FROM user_companies uc
     WHERE uc.company_id = NEW.company_id
       AND uc.role = ANY (v_roles)
       AND uc.user_id IS DISTINCT FROM auth.uid();
  END IF;

  -- (b) mudança de status → quem pediu (comercial)
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.solicitante_id IS NOT NULL
     AND NEW.solicitante_id IS DISTINCT FROM auth.uid() THEN
    v_rot := CASE NEW.status
      WHEN 'em_elaboracao' THEN 'em elaboração' WHEN 'aguardando_info' THEN 'aguardando informação sua'
      WHEN 'em_revisao' THEN 'em revisão' WHEN 'aguardando_aprovacao' THEN 'aguardando aprovação'
      WHEN 'ativo' THEN 'ativo — o fee já está na P&M' ELSE NEW.status END;
    INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    VALUES (NEW.company_id, NEW.solicitante_id, 'contrato_status',
            format('Contrato %s: %s', COALESCE(NEW.numero, ''), v_rot),
            format('%s — %s', COALESCE(NEW.cliente_nome, 'cliente'), COALESCE(NEW.nome, '')),
            v_link, 'erp_contratos', NEW.id, auth.uid());
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.trg_erp_contrato_avisos() FROM anon;
GRANT EXECUTE ON FUNCTION public.trg_erp_contrato_avisos() TO authenticated, service_role;

-- ── 4) fn_contrato_solicitar: remove o aviso duplicado (o trigger acima é a única fonte) + usuario_nome no evento ──
CREATE OR REPLACE FUNCTION public.fn_contrato_solicitar(p_company_id uuid, p_proposta_id uuid DEFAULT NULL::uuid, p_dados jsonb DEFAULT '{}'::jsonb, p_prazo_desejado date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_numero varchar; v_id uuid; v_prop record; v_resp uuid; v_n_fin int;
  v_cli_id uuid; v_cli_nome text; v_cli_doc text; v_valor numeric; v_escopo text; v_titulo text; v_origem text;
  v_cli_email text; v_cli_tel text; v_nome text;
  v_d jsonb := COALESCE(p_dados, '{}'::jsonb);
  v_cond text; v_inicio date; v_fim date; v_venc1 date; v_dia int; v_nparc int; v_reaj_pct numeric;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','company_id_ausente'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  v_inicio   := NULLIF(v_d->>'data_inicio','')::date;
  v_fim      := NULLIF(v_d->>'data_fim','')::date;
  v_venc1    := NULLIF(v_d->>'data_primeiro_vencimento','')::date;
  v_dia      := NULLIF(v_d->>'dia_vencimento','')::int;
  v_nparc    := NULLIF(v_d->>'numero_parcelas','')::int;
  v_reaj_pct := NULLIF(v_d->>'reajuste_percentual','')::numeric;
  IF v_dia IS NOT NULL AND (v_dia < 1 OR v_dia > 28) THEN RETURN jsonb_build_object('ok',false,'erro','dia_vencimento_invalido'); END IF;
  IF v_nparc IS NOT NULL AND v_nparc < 1 THEN RETURN jsonb_build_object('ok',false,'erro','numero_parcelas_invalido'); END IF;
  IF v_inicio IS NOT NULL AND v_fim IS NOT NULL AND v_fim < v_inicio THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_invalida'); END IF;

  IF COALESCE(btrim(v_d->>'titulo'),'') = '' THEN RETURN jsonb_build_object('ok',false,'erro','titulo_obrigatorio'); END IF;
  IF v_inicio IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_inicio_obrigatoria'); END IF;
  IF v_fim IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','vigencia_fim_obrigatoria'); END IF;
  IF v_nparc IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','numero_parcelas_obrigatorio'); END IF;
  IF v_dia IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','dia_vencimento_obrigatorio'); END IF;
  IF v_venc1 IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','primeiro_vencimento_obrigatorio'); END IF;

  SELECT count(*) INTO v_n_fin FROM user_companies WHERE company_id = p_company_id AND role = 'financeiro';
  IF v_n_fin = 1 THEN SELECT user_id INTO v_resp FROM user_companies WHERE company_id = p_company_id AND role = 'financeiro'; END IF;

  v_cond := NULLIF(btrim(v_d->>'condicao_pagamento'),'');
  IF p_proposta_id IS NOT NULL THEN
    SELECT * INTO v_prop FROM agency_propostas WHERE id = p_proposta_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','proposta_nao_encontrada'); END IF;
    v_origem := 'proposta';
    v_cli_id := COALESCE(v_prop.erp_cliente_id, v_prop.cliente_id);
    v_titulo := COALESCE(NULLIF(btrim(v_d->>'titulo'),''), NULLIF(btrim(v_prop.titulo),''), 'Contrato da proposta '||v_prop.numero);
    SELECT COALESCE(SUM(valor_total),0) INTO v_valor FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
    IF v_valor = 0 THEN v_valor := COALESCE(v_prop.valor_final, v_prop.valor_total, 0); END IF;
    v_valor := COALESCE(NULLIF(v_d->>'valor_mensal','')::numeric, v_valor);
    SELECT string_agg(format('• %s (%s x R$ %s)', descricao, quantidade, to_char(valor_unitario,'FM999999990.00')), E'\n' ORDER BY ordem)
      INTO v_escopo FROM agency_proposta_itens WHERE proposta_id = p_proposta_id AND excluido_em IS NULL;
    v_escopo := COALESCE(NULLIF(btrim(v_d->>'escopo'),''), v_escopo);
    v_cond := COALESCE(v_cond, NULLIF(btrim(v_prop.condicao_pagamento),''));
  ELSE
    v_origem := 'manual';
    v_cli_id := NULLIF(v_d->>'cliente_id','')::uuid;
    v_titulo := COALESCE(NULLIF(btrim(v_d->>'titulo'),''), NULLIF(btrim(v_d->>'nome'),''), 'Contrato');
    v_valor := COALESCE(NULLIF(v_d->>'valor_mensal','')::numeric, 0);
    v_escopo := NULLIF(btrim(v_d->>'escopo'),'');
    IF v_cli_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = v_cli_id AND company_id = p_company_id) THEN
      RETURN jsonb_build_object('ok',false,'erro','cliente_de_outra_empresa'); END IF;
  END IF;
  v_cli_nome := COALESCE(NULLIF(btrim(v_d->>'cliente_nome'),''), (SELECT COALESCE(nome_fantasia, razao_social) FROM erp_clientes WHERE id = v_cli_id));
  v_cli_doc  := COALESCE(NULLIF(btrim(v_d->>'cliente_cnpj'),''), (SELECT NULLIF(btrim(cnpj_cpf),'') FROM erp_clientes WHERE id = v_cli_id));
  -- CONTATO (gap 1): do payload (editado no front) ou do cadastro do cliente da MESMA empresa.
  v_cli_email := COALESCE(NULLIF(btrim(v_d->>'cliente_email'),''), (SELECT NULLIF(btrim(email),'') FROM erp_clientes WHERE id = v_cli_id));
  v_cli_tel   := COALESCE(NULLIF(btrim(v_d->>'cliente_telefone'),''), (SELECT NULLIF(btrim(COALESCE(celular, whatsapp, telefone)),'') FROM erp_clientes WHERE id = v_cli_id));
  SELECT COALESCE(NULLIF(btrim(u.full_name),''), u.email) INTO v_nome FROM public.users u WHERE u.id = v_uid;

  v_numero := next_contrato_numero(p_company_id);
  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone, tipo, nome, objeto, escopo,
    valor_mensal, valor_atual, data_inicio, data_fim, data_primeiro_vencimento, dia_vencimento, periodicidade,
    forma_pagamento, condicao_pagamento, numero_parcelas, tipo_reajuste, reajuste_percentual,
    responsavel, condicoes_especificas,
    status, origem, proposta_id, solicitante_id, responsavel_id,
    prazo_desejado, observacoes, codigo_identificador, natureza, created_by)
  VALUES (p_company_id, v_numero, v_cli_id, v_cli_nome, v_cli_doc, v_cli_email, v_cli_tel,
    COALESCE(NULLIF(btrim(v_d->>'tipo'),''),'servico'), v_titulo, NULLIF(btrim(v_d->>'objeto'),''), v_escopo,
    v_valor, v_valor, COALESCE(v_inicio, CURRENT_DATE), v_fim, v_venc1, COALESCE(v_dia, 10),
    COALESCE(NULLIF(btrim(v_d->>'periodicidade'),''), 'mensal'),
    COALESCE(NULLIF(btrim(v_d->>'forma_pagamento'),''), 'boleto'), v_cond, v_nparc,
    COALESCE(NULLIF(btrim(v_d->>'tipo_reajuste'),''), 'nenhum'), COALESCE(v_reaj_pct, 0),
    NULLIF(btrim(v_d->>'responsavel'),''), NULLIF(btrim(v_d->>'condicoes_especificas'),''),
    'solicitado', v_origem, p_proposta_id, v_uid, v_resp,
    p_prazo_desejado, p_observacoes, NULLIF(btrim(v_d->>'codigo_identificador'),''), 'receita', v_uid)
  RETURNING id INTO v_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, usuario_nome, created_at)
  VALUES (v_id, p_company_id, 'solicitado',
    format('Contrato solicitado (%s)%s', v_origem, CASE WHEN v_resp IS NULL THEN ' — sem responsável financeiro definido' ELSE '' END),
    jsonb_build_object('proposta_id', p_proposta_id, 'responsavel_id', v_resp, 'n_financeiro', v_n_fin), v_uid, v_nome, now());

  -- Aviso ao financeiro/master sai pelo trg_erp_contrato_avisos (fonte única — CEO 27/11). Não notificar aqui (evita duplicar).

  RETURN jsonb_build_object('ok', true, 'contrato_id', v_id, 'numero', v_numero, 'responsavel_id', v_resp,
    'aviso', CASE WHEN v_resp IS NULL THEN 'sem responsável financeiro único (0 ou >1) — defina manualmente' ELSE NULL END);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contrato_solicitar(uuid, uuid, jsonb, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_solicitar(uuid, uuid, jsonb, date, text) TO authenticated, service_role;

-- ── 5) fn_contratos_fila_financeiro: leitura para a tela (aguardando financeiro + ativados sem passar pelo financeiro) ─
CREATE OR REPLACE FUNCTION public.fn_contratos_fila_financeiro(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_aguardando jsonb; v_sem_fin jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','company_id_ausente'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  -- Pedidos aguardando o financeiro (status 'solicitado')
  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at), '[]'::jsonb) INTO v_aguardando FROM (
    SELECT c.id, c.numero, c.nome, c.cliente_nome,
           COALESCE(c.valor_atual, c.valor_mensal, 0) AS valor, c.created_at,
           GREATEST(0, (CURRENT_DATE - c.created_at::date)) AS dias_parado,
           c.solicitante_id,
           COALESCE(NULLIF(btrim(u.full_name),''), u.email, '—') AS solicitante_nome
      FROM erp_contratos c
      LEFT JOIN public.users u ON u.id = c.solicitante_id
     WHERE c.company_id = p_company_id AND c.status = 'solicitado' AND COALESCE(c.natureza,'receita') = 'receita'
  ) x;

  -- Ativados sem passar pelo financeiro:
  --  confirmado: o evento 'status_ativo' foi feito pelo PRÓPRIO solicitante (usuario_id = solicitante_id);
  --  provável (antigos sem usuario no evento): origem manual e solicitado→ativo em menos de 30 min.
  SELECT COALESCE(jsonb_agg(y ORDER BY y.ativado_em DESC), '[]'::jsonb) INTO v_sem_fin FROM (
    SELECT c.id, c.numero, c.nome, c.cliente_nome,
           COALESCE(c.valor_atual, c.valor_mensal, 0) AS valor,
           ev.created_at AS ativado_em, ev.usuario_id AS ativado_por_id,
           COALESCE(NULLIF(btrim(uu.full_name),''), uu.email) AS ativado_por_nome,
           CASE WHEN ev.usuario_id IS NOT NULL AND ev.usuario_id = c.solicitante_id THEN 'confirmado' ELSE 'provavel' END AS confianca
      FROM erp_contratos c
      JOIN LATERAL (SELECT e.usuario_id, e.created_at FROM erp_contratos_eventos e
                     WHERE e.contrato_id = c.id AND e.evento = 'status_ativo' ORDER BY e.created_at LIMIT 1) ev ON true
      LEFT JOIN public.users uu ON uu.id = ev.usuario_id
      LEFT JOIN LATERAL (SELECT e2.created_at FROM erp_contratos_eventos e2
                          WHERE e2.contrato_id = c.id AND e2.evento IN ('solicitado','status_solicitado') ORDER BY e2.created_at LIMIT 1) sol ON true
     WHERE c.company_id = p_company_id AND c.status = 'ativo' AND COALESCE(c.natureza,'receita') = 'receita'
       AND c.solicitante_id IS NOT NULL
       AND (
         (ev.usuario_id IS NOT NULL AND ev.usuario_id = c.solicitante_id)
         OR (ev.usuario_id IS NULL AND c.origem = 'manual' AND sol.created_at IS NOT NULL AND ev.created_at - sol.created_at < interval '30 min')
       )
  ) y;

  RETURN jsonb_build_object('ok', true, 'aguardando', v_aguardando, 'sem_financeiro', v_sem_fin);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_contratos_fila_financeiro(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contratos_fila_financeiro(uuid) TO authenticated, service_role;

-- ── Ajuda RD-95 do toggle (idempotente) ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical)
SELECT 'ge.contratos.ativacao_financeiro', '/dashboard/contratos', 'contratos', 'Ativação só pelo financeiro',
       'Ligue para que só o financeiro (ou master) elabore e ative o contrato.',
       'Quando ligado, quem pede o contrato não consegue ativá-lo; o financeiro (ou master) elabora e ativa. Evita contrato ativo e cobrança gerada sem passar pelo financeiro.',
       'Vendedor pede o contrato → o financeiro confere, elabora e ativa.',
       'Deixar desligado e o próprio vendedor ativar o contrato, gerando contas a receber sem conferência.',
       'ge'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'ge.contratos.ativacao_financeiro' AND rota = '/dashboard/contratos');

-- ── PROVA RD-38 — falha a migration se o esperado não estiver de pé ──────────────────────────────────────────────
DO $$
DECLARE v_col boolean; v_has_gate boolean; v_has_nome boolean; v_ajuda int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='erp_contratos_config' AND column_name='ativacao_pelo_financeiro') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'RD-38: coluna ativacao_pelo_financeiro ausente'; END IF;

  SELECT pg_get_functiondef('public.fn_contrato_mudar_status'::regproc) LIKE '%Pedido enviado ao financeiro%'
     AND pg_get_functiondef('public.fn_contrato_mudar_status'::regproc) LIKE '%usuario_nome%' INTO v_has_gate;
  IF NOT v_has_gate THEN RAISE EXCEPTION 'RD-38: fn_contrato_mudar_status sem a trava/usuario_nome'; END IF;

  SELECT pg_get_functiondef('public.trg_erp_contrato_avisos'::regproc) LIKE '%Novo pedido de contrato%' INTO v_has_nome;
  IF NOT v_has_nome THEN RAISE EXCEPTION 'RD-38: trigger de aviso sem o texto do CEO'; END IF;

  SELECT count(*) INTO v_ajuda FROM public.erp_ajuda_campo WHERE chave='ge.contratos.ativacao_financeiro';
  IF v_ajuda < 1 THEN RAISE EXCEPTION 'RD-38: ajuda do toggle ausente'; END IF;

  RAISE NOTICE 'RD-38 OK: config + trava de segregação + usuario_nome + aviso financeiro/master + ajuda';
END $$;
