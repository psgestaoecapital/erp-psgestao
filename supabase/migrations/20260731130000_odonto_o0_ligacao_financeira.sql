-- ============================================================
-- ODONTO · Onda 0 — LIGAÇÃO FINANCEIRA (o coração). Piloto Felicita.
-- Conecta o clínico ao financeiro REAL da PS: plano aprovado → contas a receber
-- (erp_receber), que já flui pra DRE/conciliação/CNAB/NFS-e. Reuso total do motor
-- financeiro (RD-26); nada recriado. Aplicada via MCP · RD-41.
--
-- Rastreabilidade/idempotência (RD-54): os títulos do plano usam
--   ref_externa_sistema='odonto_plano', ref_externa_id='<plano_id>-<parcela>'
-- (a constraint uq_erp_receber_ref_externa é por ref_externa_id, então cada
--  parcela tem o seu; o plano inteiro é rastreável por LIKE '<plano_id>-%').
-- ============================================================

-- ── BLOCO 1 · Paciente ↔ Cliente ──────────────────────────────────────────────
-- Resolve (ou cria) o erp_clientes de um paciente e grava cliente_id. Idempotente:
-- mesmo CPF → mesmo cliente; sem CPF, dedup por nome+telefone. SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.fn_odonto_cliente_do_paciente(p_paciente_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_pac RECORD; v_cli uuid; v_cpf text; v_fone text;
BEGIN
  SELECT * INTO v_pac FROM erp_odonto_paciente WHERE id = p_paciente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF NOT public.is_admin() AND v_pac.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  IF v_pac.cliente_id IS NOT NULL THEN RETURN v_pac.cliente_id; END IF;

  v_cpf  := regexp_replace(COALESCE(v_pac.cpf,''), '\D', '', 'g');
  v_fone := regexp_replace(COALESCE(NULLIF(v_pac.celular,''), v_pac.telefone, ''), '\D', '', 'g');

  -- 1) por CPF
  IF length(v_cpf) >= 11 THEN
    SELECT id INTO v_cli FROM erp_clientes
      WHERE company_id = v_pac.company_id AND regexp_replace(COALESCE(cpf_cnpj, cnpj_cpf, ''), '\D', '', 'g') = v_cpf
      LIMIT 1;
  END IF;
  -- 2) fallback: nome + telefone
  IF v_cli IS NULL AND v_fone <> '' THEN
    SELECT id INTO v_cli FROM erp_clientes
      WHERE company_id = v_pac.company_id AND lower(btrim(nome_fantasia)) = lower(btrim(v_pac.nome))
        AND regexp_replace(COALESCE(NULLIF(celular,''), telefone, ''), '\D', '', 'g') = v_fone
      LIMIT 1;
  END IF;
  -- 3) cria
  IF v_cli IS NULL THEN
    INSERT INTO erp_clientes (company_id, nome_fantasia, razao_social, cpf_cnpj, cnpj_cpf, tipo_pessoa,
                             telefone, celular, ativo, ref_externa_sistema, ref_externa_id)
    VALUES (v_pac.company_id, v_pac.nome, v_pac.nome, NULLIF(v_cpf,''), NULLIF(v_cpf,''), 'PF',
            v_pac.telefone, v_pac.celular, true, 'odonto_paciente', p_paciente_id::text)
    RETURNING id INTO v_cli;
  END IF;

  UPDATE erp_odonto_paciente SET cliente_id = v_cli WHERE id = p_paciente_id;
  RETURN v_cli;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_cliente_do_paciente(uuid) TO authenticated;

-- Backfill: garante cliente_id p/ todos os pacientes da empresa.
CREATE OR REPLACE FUNCTION public.fn_odonto_backfill_cliente(p_company_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r RECORD; v_n int := 0;
BEGIN
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  FOR r IN SELECT id FROM erp_odonto_paciente WHERE company_id = p_company_id AND cliente_id IS NULL AND COALESCE(ativo,true) LOOP
    PERFORM fn_odonto_cliente_do_paciente(r.id); v_n := v_n + 1;
  END LOOP;
  RETURN json_build_object('ok', true, 'vinculados', v_n);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_backfill_cliente(uuid) TO authenticated;

-- ── BLOCO 2+3 · Plano aprovado → Contas a Receber (parcial + condição) ────────
CREATE OR REPLACE FUNCTION public.fn_odonto_plano_aprovar_financeiro(
  p_id uuid, p_aprovado_por text DEFAULT NULL,
  p_itens_ids uuid[] DEFAULT NULL,           -- NULL = todos os itens
  p_parcelas int DEFAULT 1, p_entrada numeric DEFAULT 0,
  p_primeira_venc date DEFAULT NULL, p_forma text DEFAULT 'boleto'
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_plano RECORD; v_cli uuid; v_nome text; v_total_todos numeric; v_total_aprov numeric;
  v_net numeric; v_entrada numeric; v_resto numeric; v_np int; v_vp numeric; v_acc numeric := 0;
  v_venc0 date := COALESCE(p_primeira_venc, CURRENT_DATE); v_ja int; v_ger int := 0; v_desc text;
  i int; v_valor numeric; v_par int; v_vc date;
BEGIN
  SELECT * INTO v_plano FROM erp_odonto_plano_tratamento WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
  IF NOT public.is_admin() AND v_plano.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  -- aprova o plano + os itens escolhidos (ou todos)
  UPDATE erp_odonto_plano_tratamento
    SET status='aprovado', aprovado_em=now(), aprovado_por=COALESCE(NULLIF(btrim(p_aprovado_por),''),'Paciente')
    WHERE id=p_id AND status IN ('rascunho','orcamento','aprovado');
  UPDATE erp_odonto_plano_item SET status='aprovado'
    WHERE plano_id=p_id AND status IN ('proposto','aprovado')
      AND (p_itens_ids IS NULL OR id = ANY(p_itens_ids));

  -- valor aprovado (itens escolhidos) e desconto prorateado
  SELECT COALESCE(SUM(valor),0) INTO v_total_todos FROM erp_odonto_plano_item WHERE plano_id=p_id;
  SELECT COALESCE(SUM(valor),0) INTO v_total_aprov FROM erp_odonto_plano_item
    WHERE plano_id=p_id AND (p_itens_ids IS NULL OR id = ANY(p_itens_ids));
  v_net := round(v_total_aprov - COALESCE(v_plano.desconto,0) * (CASE WHEN v_total_todos>0 THEN v_total_aprov/v_total_todos ELSE 1 END), 2);

  -- idempotência: se o plano já gerou títulos, não duplica (RD-54)
  SELECT count(*) INTO v_ja FROM erp_receber
    WHERE company_id=v_plano.company_id AND ref_externa_sistema='odonto_plano'
      AND ref_externa_id LIKE p_id::text || '-%';
  IF v_ja > 0 THEN
    RETURN json_build_object('ok', true, 'id', p_id, 'ja_gerado', true, 'titulos', v_ja, 'valor', v_net);
  END IF;

  IF v_net <= 0 THEN
    RETURN json_build_object('ok', true, 'id', p_id, 'titulos', 0, 'valor', 0, 'aviso', 'plano sem valor — nenhum título gerado');
  END IF;

  -- resolve cliente do paciente (Bloco 1) e o nome p/ o título
  v_cli := fn_odonto_cliente_do_paciente(v_plano.paciente_id);
  SELECT nome INTO v_nome FROM erp_odonto_paciente WHERE id = v_plano.paciente_id;
  v_desc := 'Plano odonto #' || left(p_id::text,8) || ' - ' || COALESCE(v_plano.titulo,'tratamento');

  v_entrada := round(least(GREATEST(p_entrada,0), v_net), 2);
  v_resto := v_net - v_entrada;
  v_np := GREATEST(1, COALESCE(p_parcelas,1));
  v_vp := round(v_resto / v_np, 2);

  -- entrada (se houver) = parcela "0" vencendo na 1ª data
  IF v_entrada > 0 THEN
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, categoria, valor,
      data_emissao, data_vencimento, data_competencia, parcela, status, forma_pagamento,
      ref_externa_sistema, ref_externa_id)
    VALUES (v_plano.company_id, v_cli, v_nome, v_desc || ' (entrada)', 'Odontologia', v_entrada,
      CURRENT_DATE, v_venc0, CURRENT_DATE, '0', 'aberto', p_forma, 'odonto_plano', p_id::text || '-0');
    v_ger := v_ger + 1;
  END IF;

  -- parcelas 1..N (a última absorve o resíduo de arredondamento)
  FOR i IN 1..v_np LOOP
    v_par := i; v_acc := v_acc + v_vp;
    v_valor := CASE WHEN i = v_np THEN round(v_resto - (v_vp * (v_np-1)), 2) ELSE v_vp END;
    v_vc := (v_venc0 + ((CASE WHEN v_entrada > 0 THEN i ELSE i-1 END)) * interval '1 month')::date;
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, categoria, valor,
      data_emissao, data_vencimento, data_competencia, parcela, status, forma_pagamento,
      ref_externa_sistema, ref_externa_id)
    VALUES (v_plano.company_id, v_cli, v_nome, v_desc || ' (parcela ' || v_par || '/' || v_np || ')', 'Odontologia', v_valor,
      CURRENT_DATE, v_vc, CURRENT_DATE, v_par::text, 'aberto', p_forma, 'odonto_plano', p_id::text || '-' || v_par);
    v_ger := v_ger + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'id', p_id, 'cliente_id', v_cli, 'titulos', v_ger, 'valor', v_net, 'parcelas', v_np, 'entrada', v_entrada);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_plano_aprovar_financeiro(uuid, text, uuid[], int, numeric, date, text) TO authenticated;

-- Cancelamento: cancela o plano e os títulos AINDA NÃO PAGOS (nunca apaga pago · RD-55).
CREATE OR REPLACE FUNCTION public.fn_odonto_plano_cancelar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_plano RECORD; v_canc int; v_pagos int;
BEGIN
  SELECT * INTO v_plano FROM erp_odonto_plano_tratamento WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado'; END IF;
  IF NOT public.is_admin() AND v_plano.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  UPDATE erp_odonto_plano_tratamento SET status='cancelado',
    observacao = COALESCE(observacao,'') || CASE WHEN p_motivo IS NOT NULL THEN ' · cancelado: '||p_motivo ELSE '' END
    WHERE id=p_id;
  UPDATE erp_receber SET status='cancelado'
    WHERE company_id=v_plano.company_id AND ref_externa_sistema='odonto_plano'
      AND ref_externa_id LIKE p_id::text || '-%'
      AND status NOT IN ('pago','recebido','cancelado');
  GET DIAGNOSTICS v_canc = ROW_COUNT;
  SELECT count(*) INTO v_pagos FROM erp_receber
    WHERE company_id=v_plano.company_id AND ref_externa_sistema='odonto_plano'
      AND ref_externa_id LIKE p_id::text || '-%' AND status IN ('pago','recebido');
  RETURN json_build_object('ok', true, 'id', p_id, 'titulos_cancelados', v_canc, 'titulos_pagos_mantidos', v_pagos);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_plano_cancelar(uuid, text) TO authenticated;

-- ── BLOCO 5 · Débitos do paciente (view + detalhe) ───────────────────────────
-- Fronteira: o financeiro é da GE; a ficha odonto só LÊ. security_invoker → RLS.
DROP VIEW IF EXISTS public.v_odonto_debitos_paciente;
CREATE VIEW public.v_odonto_debitos_paciente WITH (security_invoker=on) AS
SELECT p.id AS paciente_id, p.company_id, p.cliente_id,
       COALESCE(SUM(r.valor) FILTER (WHERE r.status IN ('pago','recebido')),0)              AS total_recebido,
       COALESCE(SUM(r.valor) FILTER (WHERE r.status IN ('aberto','vencido')),0)             AS total_aberto,
       COALESCE(SUM(r.valor) FILTER (WHERE r.status IN ('aberto','vencido')),0)
       - COALESCE(SUM(r.valor) FILTER (WHERE r.status IN ('pago','recebido')),0)            AS saldo
FROM erp_odonto_paciente p
LEFT JOIN erp_receber r ON r.company_id = p.company_id AND r.cliente_id = p.cliente_id
GROUP BY p.id, p.company_id, p.cliente_id;
GRANT SELECT ON public.v_odonto_debitos_paciente TO authenticated;

-- Detalhe p/ a aba Débitos (totais + lista de títulos).
CREATE OR REPLACE FUNCTION public.fn_odonto_debitos_paciente(p_paciente_id uuid, p_incluir_recebidos boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_pac RECORD; v_out json;
BEGIN
  SELECT * INTO v_pac FROM erp_odonto_paciente WHERE id=p_paciente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paciente não encontrado'; END IF;
  IF NOT public.is_admin() AND v_pac.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  SELECT json_build_object(
    'paciente_id', p_paciente_id, 'cliente_id', v_pac.cliente_id,
    'total_recebido', COALESCE((SELECT SUM(valor) FROM erp_receber WHERE company_id=v_pac.company_id AND cliente_id=v_pac.cliente_id AND status IN ('pago','recebido')),0),
    'total_aberto',   COALESCE((SELECT SUM(valor) FROM erp_receber WHERE company_id=v_pac.company_id AND cliente_id=v_pac.cliente_id AND status IN ('aberto','vencido')),0),
    'titulos', COALESCE((SELECT json_agg(json_build_object(
        'id', r.id, 'descricao', r.descricao, 'valor', r.valor,
        'data_vencimento', to_char(r.data_vencimento,'YYYY-MM-DD'),
        'data_competencia', to_char(r.data_competencia,'YYYY-MM-DD'),
        'status', r.status, 'parcela', r.parcela,
        'do_plano', (r.ref_externa_sistema='odonto_plano')) ORDER BY r.data_vencimento)
      FROM erp_receber r WHERE r.company_id=v_pac.company_id AND r.cliente_id=v_pac.cliente_id
        AND (p_incluir_recebidos OR r.status IN ('aberto','vencido'))
        AND r.status <> 'cancelado'), '[]'::json)
  ) INTO v_out;
  RETURN v_out;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_odonto_debitos_paciente(uuid, boolean) TO authenticated;
