-- Odonto · Onda 0 — Bloco 4 + 6 (fecha a O0): Procedimento→Receita, NFS-e e Régua.
-- Continua o #820 (paciente↔cliente + plano aprovado→erp_receber). Aqui:
--   B4) fn_odonto_item_concluir: ao concluir um procedimento do plano, reconhece a
--       RECEITA na competência certa (Pilar 1) e, opcionalmente, dá baixa (recebido
--       no ato) reusando fn_receber_baixar_pagamento (RD-26).
--   B6.1) fn_odonto_plano_financeiro: feed dos títulos do plano + estado da NFS-e
--         (para o botão "Emitir NFS-e" — a emissão em si reusa a rota fiscal/Focus).
--         Também estende fn_odonto_debitos_paciente com o estado da NFS-e (a ficha
--         só EXIBE — fronteira: financeiro vive na Gestão Empresarial).
--   B6.2) v_odonto_receber_vencidos: fonte HONESTA da régua de cobrança (O3). NÃO
--         dispara nada — só o feed de títulos odonto vencidos + telefone do paciente.
-- Guardas: RD-26 (reusa baixa/fiscal), RD-54/55 (idempotente; nunca apaga pago),
-- Pilar 1 (competência), RD-58 (estado NFS-e honesto). Guard de escopo em toda RPC.

-- ── BLOCO 4 · Procedimento realizado → receita reconhecida ───────────────────
-- Modelo (por parcela, decisão do SPEC): os títulos são o cronograma de caixa
-- (parcelas). No #820 nasceram com data_competencia = data_emissao (placeholder
-- da aprovação). Ao concluir o 1º procedimento, a receita passa a ser reconhecida:
-- os títulos do plano ainda em aberto que carregam esse placeholder recebem
-- competência = data da conclusão. Reconcluir é no-op (idempotente); pago/cancelado
-- nunca é tocado (RD-55).
CREATE OR REPLACE FUNCTION public.fn_odonto_item_concluir(
  p_item_id uuid,
  p_baixar boolean DEFAULT false,
  p_data date DEFAULT NULL,
  p_conta_bancaria_id uuid DEFAULT NULL,
  p_forma text DEFAULT 'PIX'
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD; v_data date; v_ja boolean;
  v_comp int := 0; v_tit RECORD; v_baixa jsonb := NULL;
BEGIN
  SELECT * INTO v_item FROM erp_odonto_plano_item WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  IF NOT public.is_admin() AND v_item.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  v_data := COALESCE(p_data, CURRENT_DATE);
  v_ja := (v_item.status = 'concluido');

  -- 1) marca o item concluído (mantém concluido_em da 1ª vez — idempotente)
  UPDATE erp_odonto_plano_item
     SET status = 'concluido',
         concluido_em = COALESCE(concluido_em, v_data::timestamptz),
         updated_at = now()
   WHERE id = p_item_id;

  -- 2) COMPETÊNCIA (Pilar 1): reconhece na data da entrega os títulos do plano
  -- ainda em aberto e no placeholder (data_competencia = data_emissao).
  UPDATE erp_receber r
     SET data_competencia = v_data, updated_at = now()
   WHERE r.company_id = v_item.company_id
     AND r.ref_externa_sistema = 'odonto_plano'
     AND r.ref_externa_id LIKE v_item.plano_id::text || '-%'
     AND r.status NOT IN ('pago','recebido','cancelado','parcial')
     AND r.data_competencia = r.data_emissao;
  GET DIAGNOSTICS v_comp = ROW_COUNT;

  -- 3) baixa opcional (recebido no ato) — reusa fn_receber_baixar_pagamento (RD-26).
  -- Quita a parcela em aberto mais antiga do plano (valor cheio). Só na 1ª conclusão
  -- (v_ja=false) pra reconcluir não gerar baixa nova.
  IF p_baixar AND NOT v_ja THEN
    SELECT r.id, r.valor INTO v_tit FROM erp_receber r
      WHERE r.company_id = v_item.company_id
        AND r.ref_externa_sistema = 'odonto_plano'
        AND r.ref_externa_id LIKE v_item.plano_id::text || '-%'
        AND r.status IN ('aberto','vencido','parcial')
      ORDER BY r.data_vencimento, NULLIF(r.parcela,'')::int NULLS FIRST
      LIMIT 1;
    IF FOUND THEN
      v_baixa := fn_receber_baixar_pagamento(v_tit.id, v_data, p_conta_bancaria_id, p_forma, NULL);
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'id', p_item_id, 'status', 'concluido',
    'ja_concluido', v_ja, 'competencia', to_char(v_data,'YYYY-MM-DD'),
    'titulos_reconhecidos', v_comp, 'baixa', v_baixa);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_item_concluir(uuid, boolean, date, uuid, text) TO authenticated;

-- ── BLOCO 6.1 · feed financeiro do plano (títulos + estado NFS-e) ────────────
-- Alimenta a UI do plano aprovado: cada título com seu status e a última NFS-e
-- não-cancelada (autorizada/processando/rejeitada). RD-58: estado honesto.
CREATE OR REPLACE FUNCTION public.fn_odonto_plano_financeiro(p_plano_id uuid)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_plano RECORD; v_out json;
BEGIN
  SELECT * INTO v_plano FROM erp_odonto_plano_tratamento WHERE id = p_plano_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
  IF NOT public.is_admin() AND v_plano.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  SELECT json_build_object(
    'plano_id', p_plano_id,
    'company_id', v_plano.company_id,
    'cliente_id', (SELECT cliente_id FROM erp_odonto_paciente WHERE id = v_plano.paciente_id),
    'total_recebido', COALESCE((SELECT SUM(COALESCE(valor_pago,0)) FROM erp_receber
        WHERE company_id=v_plano.company_id AND ref_externa_sistema='odonto_plano'
          AND ref_externa_id LIKE p_plano_id::text||'-%' AND status <> 'cancelado'),0),
    'total_aberto', COALESCE((SELECT SUM(valor - COALESCE(valor_pago,0)) FROM erp_receber
        WHERE company_id=v_plano.company_id AND ref_externa_sistema='odonto_plano'
          AND ref_externa_id LIKE p_plano_id::text||'-%' AND status IN ('aberto','vencido','parcial')),0),
    'titulos', COALESCE((SELECT json_agg(json_build_object(
        'id', r.id, 'descricao', r.descricao, 'valor', r.valor, 'valor_pago', COALESCE(r.valor_pago,0),
        'data_vencimento', to_char(r.data_vencimento,'YYYY-MM-DD'),
        'data_competencia', to_char(r.data_competencia,'YYYY-MM-DD'),
        'parcela', r.parcela, 'status', r.status,
        'nfse_status', n.status, 'nfse_numero', n.numero)
        ORDER BY NULLIF(r.parcela,'')::int NULLS FIRST, r.data_vencimento)
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT e.status, e.numero FROM erp_nfse_emitidas e
         WHERE e.erp_receber_id = r.id AND e.status <> 'cancelada'
         ORDER BY e.criado_em DESC LIMIT 1) n ON true
      WHERE r.company_id=v_plano.company_id AND r.ref_externa_sistema='odonto_plano'
        AND r.ref_externa_id LIKE p_plano_id::text||'-%' AND r.status <> 'cancelado'), '[]'::json)
  ) INTO v_out;
  RETURN v_out;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_plano_financeiro(uuid) TO authenticated;

-- Estende o feed da FICHA (aba Débitos) com o estado da NFS-e — a ficha só EXIBE.
CREATE OR REPLACE FUNCTION public.fn_odonto_debitos_paciente(p_paciente_id uuid, p_incluir_recebidos boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pac RECORD; v_out json;
BEGIN
  SELECT * INTO v_pac FROM erp_odonto_paciente WHERE id=p_paciente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF NOT public.is_admin() AND v_pac.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  SELECT json_build_object(
    'paciente_id', p_paciente_id, 'cliente_id', v_pac.cliente_id,
    'total_recebido', COALESCE((SELECT SUM(valor) FROM erp_receber WHERE company_id=v_pac.company_id AND cliente_id=v_pac.cliente_id AND status IN ('pago','recebido')),0),
    'total_aberto',   COALESCE((SELECT SUM(valor) FROM erp_receber WHERE company_id=v_pac.company_id AND cliente_id=v_pac.cliente_id AND status IN ('aberto','vencido')),0),
    'titulos', COALESCE((SELECT json_agg(json_build_object(
        'id', r.id, 'descricao', r.descricao, 'valor', r.valor,
        'data_vencimento', to_char(r.data_vencimento,'YYYY-MM-DD'), 'data_competencia', to_char(r.data_competencia,'YYYY-MM-DD'),
        'status', r.status, 'parcela', r.parcela, 'do_plano', (r.ref_externa_sistema='odonto_plano'),
        'nfse_status', n.status, 'nfse_numero', n.numero) ORDER BY r.data_vencimento)
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT e.status, e.numero FROM erp_nfse_emitidas e
         WHERE e.erp_receber_id = r.id AND e.status <> 'cancelada'
         ORDER BY e.criado_em DESC LIMIT 1) n ON true
      WHERE r.company_id=v_pac.company_id AND r.cliente_id=v_pac.cliente_id
        AND (p_incluir_recebidos OR r.status IN ('aberto','vencido')) AND r.status <> 'cancelado'), '[]'::json)
  ) INTO v_out;
  RETURN v_out;
END $function$;

-- ── BLOCO 6.2 · fonte da régua de cobrança (O3, sem disparar) ────────────────
-- Feed HONESTO: títulos odonto vencidos com o telefone do paciente (via plano).
-- A régua (Bot WhatsApp PS) consome isto na O3. Aqui NÃO dispara mensagem.
-- security_invoker: respeita RLS/escopo do usuário. Filtra odonto ANTES do cast do
-- plano_id (subquery) pra nunca castar ref_externa_id de outros sistemas.
CREATE OR REPLACE VIEW public.v_odonto_receber_vencidos
WITH (security_invoker = true) AS
WITH odo AS (
  SELECT r.id, r.company_id, r.cliente_id, r.cliente_nome, r.descricao, r.valor,
         COALESCE(r.valor_pago,0) AS valor_pago, r.data_vencimento, r.parcela,
         left(r.ref_externa_id, 36)::uuid AS plano_id
    FROM erp_receber r
   WHERE r.ref_externa_sistema = 'odonto_plano'
     AND r.status IN ('aberto','vencido','parcial')
     AND r.data_vencimento < CURRENT_DATE
)
SELECT
  o.id                AS receber_id,
  o.company_id,
  o.plano_id,
  pl.paciente_id,
  pa.nome             AS paciente_nome,
  regexp_replace(COALESCE(NULLIF(pa.celular,''), pa.telefone, ''), '\D', '', 'g') AS telefone,
  o.cliente_id,
  o.cliente_nome,
  o.descricao,
  o.parcela,
  o.valor,
  o.valor_pago,
  round(o.valor - o.valor_pago, 2) AS saldo,
  o.data_vencimento,
  (CURRENT_DATE - o.data_vencimento) AS dias_atraso
FROM odo o
JOIN erp_odonto_plano_tratamento pl ON pl.id = o.plano_id
JOIN erp_odonto_paciente pa ON pa.id = pl.paciente_id;
GRANT SELECT ON public.v_odonto_receber_vencidos TO authenticated;
COMMENT ON VIEW public.v_odonto_receber_vencidos IS
  'Fonte da régua de cobrança WhatsApp (Onda 3). NÃO dispara mensagem — só o feed honesto de títulos odonto vencidos com telefone do paciente. Consumido pelo Bot WhatsApp PS na O3.';
