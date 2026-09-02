-- Revenda de Veículos · Onda 3A · RPCs de negociação e venda.
-- Dois diferenciais no comportamento (não só no schema):
--  §1 troca supervalorizada: o veículo recebido entra em estoque com valor_aquisicao = valor_AVALIACAO
--     (o que vale), nunca o valor_troca (o que foi dado). A diferença é desconto_embutido na venda.
--     Se fosse pelo valor_troca, a margem do usado e a da venda erravam juntas e ninguém via.
--  §2 financiamento: cada recebimento sabe QUEM deve — 'cliente' (entrada) ou 'banco' (repasse) —
--     e vira erp_receber pelo gancho ref_externa (não recria financeiro). O retorno do banco é receita.
-- Situação do veículo só muda por fn_veic_mudar_situacao (Onda 1), mantendo o evento/autor.

-- helper interno: gera erp_receber pelo gancho e devolve o id (SECURITY DEFINER contexto já validado).
-- p_ref_id é a CHAVE do gancho — precisa ser única por título (há UNIQUE parcial em
-- erp_receber(company_id, ref_externa_sistema, ref_externa_id)). Por isso ligamos ao id do RECEBIMENTO,
-- não ao id da venda: uma venda tem N recebimentos, e todos com o mesmo ref colidiriam.
CREATE OR REPLACE FUNCTION public.fn_veic__receber(
  p_company_id uuid, p_ref_id uuid, p_descricao text, p_valor numeric, p_vencimento date,
  p_cliente_id uuid, p_cliente_nome text, p_forma text, p_conta uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO erp_receber (company_id, valor, descricao, data_vencimento, data_emissao, status,
      cliente_id, cliente_nome, categoria, forma_pagamento, conta_bancaria_id,
      ref_externa_sistema, ref_externa_id)
  VALUES (p_company_id, p_valor, p_descricao, COALESCE(p_vencimento, CURRENT_DATE), CURRENT_DATE, 'aberto',
      p_cliente_id, p_cliente_nome, 'Revenda de veículos', p_forma, p_conta,
      'revenda_veiculos', p_ref_id::text)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- ---------- PROPOSTA ----------
-- cria proposta (+ troca opcional). A troca guarda os DOIS valores (§1). Não move o veículo ainda.
CREATE OR REPLACE FUNCTION public.fn_veic_proposta_criar(
  p_company_id uuid, p_veiculo_id uuid, p_proposta jsonb, p_troca jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_prop uuid;
BEGIN
  SELECT company_id INTO v_comp FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) OR v_comp <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  INSERT INTO veic_proposta (company_id, veiculo_id, cliente_id, cliente_nome, cliente_doc,
      valor_pedido, valor_negociado, desconto, validade_ate, vendedor_nome, observacao, situacao, created_by)
  VALUES (p_company_id, p_veiculo_id, NULLIF(p_proposta->>'cliente_id','')::uuid, p_proposta->>'cliente_nome',
      p_proposta->>'cliente_doc', (p_proposta->>'valor_pedido')::numeric, (p_proposta->>'valor_negociado')::numeric,
      (p_proposta->>'desconto')::numeric, NULLIF(p_proposta->>'validade_ate','')::date,
      p_proposta->>'vendedor_nome', p_proposta->>'observacao',
      COALESCE(NULLIF(p_proposta->>'situacao',''), 'aberta'), p_user)
  RETURNING id INTO v_prop;

  IF p_troca IS NOT NULL AND jsonb_typeof(p_troca) = 'object' AND p_troca <> '{}'::jsonb THEN
    INSERT INTO veic_proposta_troca (company_id, proposta_id, chassi, placa, marca, modelo,
        ano_fabricacao, ano_modelo, km, valor_troca, valor_avaliacao)
    VALUES (p_company_id, v_prop, NULLIF(p_troca->>'chassi',''), NULLIF(p_troca->>'placa',''),
        p_troca->>'marca', p_troca->>'modelo', (p_troca->>'ano_fabricacao')::int,
        (p_troca->>'ano_modelo')::int, (p_troca->>'km')::numeric,
        (p_troca->>'valor_troca')::numeric, (p_troca->>'valor_avaliacao')::numeric);
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_prop);
END $function$;

-- muda situação da proposta (aceita/recusada/expirada/cancelada). Não move o veículo.
CREATE OR REPLACE FUNCTION public.fn_veic_proposta_situacao(p_proposta_id uuid, p_nova text, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM veic_proposta WHERE id = p_proposta_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_nova NOT IN ('aberta','aceita','recusada','expirada','cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'situacao_invalida'); END IF;
  UPDATE veic_proposta SET situacao = p_nova WHERE id = p_proposta_id;
  RETURN jsonb_build_object('ok', true, 'situacao', p_nova);
END $function$;

-- ---------- RESERVA ----------
-- reserva o veículo (→ situacao reservado). Sinal opcional vira erp_receber pelo gancho (§ sinal).
CREATE OR REPLACE FUNCTION public.fn_veic_reserva_criar(
  p_company_id uuid, p_veiculo_id uuid, p_reserva jsonb, p_gerar_receber boolean, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_sit text; v_res uuid; v_receber uuid; v_sinal numeric := (p_reserva->>'valor_sinal')::numeric;
BEGIN
  SELECT company_id, situacao INTO v_comp, v_sit FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) OR v_comp <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit IN ('vendido','entregue') THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_ja_vendido'); END IF;
  IF EXISTS (SELECT 1 FROM veic_reserva WHERE veiculo_id = p_veiculo_id AND situacao = 'ativa' AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_reservado'); END IF;

  -- cria a reserva primeiro para o título do sinal ancorar no id DELA (gancho único)
  INSERT INTO veic_reserva (company_id, veiculo_id, proposta_id, cliente_id, cliente_nome,
      valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
  VALUES (p_company_id, p_veiculo_id, NULLIF(p_reserva->>'proposta_id','')::uuid,
      NULLIF(p_reserva->>'cliente_id','')::uuid, p_reserva->>'cliente_nome',
      v_sinal, p_reserva->>'forma_sinal', NULLIF(p_reserva->>'reservado_ate','')::date, 'ativa', p_user)
  RETURNING id INTO v_res;

  IF p_gerar_receber AND COALESCE(v_sinal,0) > 0 THEN
    v_receber := fn_veic__receber(p_company_id, v_res,
      'Sinal de reserva — ' || COALESCE(p_reserva->>'cliente_nome',''), v_sinal,
      NULLIF(p_reserva->>'reservado_ate','')::date, NULLIF(p_reserva->>'cliente_id','')::uuid,
      p_reserva->>'cliente_nome', p_reserva->>'forma_sinal', NULL);
    UPDATE veic_reserva SET receber_id = v_receber WHERE id = v_res;
  END IF;

  PERFORM fn_veic_mudar_situacao(p_veiculo_id, 'reservado', p_user, 'Reservado para ' || COALESCE(p_reserva->>'cliente_nome',''));
  RETURN jsonb_build_object('ok', true, 'id', v_res, 'receber_id', v_receber);
END $function$;

-- cancela reserva → veículo volta a disponivel (se ainda reservado). NÃO exclui o título do sinal (avisa).
CREATE OR REPLACE FUNCTION public.fn_veic_reserva_cancelar(p_reserva_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_sit text; v_receber uuid; v_veic_sit text;
BEGIN
  SELECT company_id, veiculo_id, situacao, receber_id INTO v_comp, v_veic, v_sit, v_receber
    FROM veic_reserva WHERE id = p_reserva_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'reserva_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit <> 'ativa' THEN RETURN jsonb_build_object('ok', false, 'erro', 'reserva_nao_ativa'); END IF;

  UPDATE veic_reserva SET situacao = 'cancelada' WHERE id = p_reserva_id;
  SELECT situacao INTO v_veic_sit FROM veic_veiculo WHERE id = v_veic;
  IF v_veic_sit = 'reservado' THEN
    PERFORM fn_veic_mudar_situacao(v_veic, 'disponivel', p_user, 'Reserva cancelada');
  END IF;
  RETURN jsonb_build_object('ok', true, 'tinha_sinal', v_receber IS NOT NULL, 'receber_id', v_receber);
END $function$;

-- ---------- VENDA (o núcleo) ----------
-- Registra a venda: cria veic_venda (aberta), move o veículo para 'vendido', gera cada recebimento
-- em erp_receber com o devedor certo (§2), e — se houver troca — CRIA o veículo recebido em estoque
-- com valor_aquisicao = valor_AVALIACAO (§1) e registra o desconto embutido (valor_troca − avaliacao).
-- Converte a reserva ativa (se houver) e marca a proposta como aceita.
CREATE OR REPLACE FUNCTION public.fn_veic_venda_registrar(
  p_company_id uuid, p_veiculo_id uuid, p_venda jsonb, p_recebimentos jsonb, p_troca jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_sit text; v_modelo text; v_venda uuid; v_prop uuid := NULLIF(p_venda->>'proposta_id','')::uuid;
  v_troca_veic uuid; v_desc numeric := 0; v_troca_val numeric; v_aval numeric; v_troca_chassi text;
  v_rec jsonb; v_rec_id uuid; v_receber uuid; n_titulos int := 0; v_cli_nome text := p_venda->>'cliente_nome';
BEGIN
  SELECT company_id, situacao, modelo INTO v_comp, v_sit, v_modelo FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) OR v_comp <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit IN ('vendido','entregue','devolvido') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_indisponivel', 'situacao', v_sit); END IF;

  -- §1: troca supervalorizada. Fonte da avaliação: p_troca inline (a tela repassa da proposta, se houver).
  IF p_troca IS NOT NULL AND jsonb_typeof(p_troca) = 'object' AND p_troca <> '{}'::jsonb THEN
    v_troca_val := (p_troca->>'valor_troca')::numeric;
    v_aval := (p_troca->>'valor_avaliacao')::numeric;
    v_desc := COALESCE(v_troca_val,0) - COALESCE(v_aval,0);   -- desconto embutido
    v_troca_chassi := NULLIF(p_troca->>'chassi','');
  END IF;

  INSERT INTO veic_venda (company_id, veiculo_id, proposta_id, cliente_id, cliente_nome, cliente_doc,
      data_venda, valor_venda, desconto_embutido_troca, valor_entrada, valor_financiado, banco_nome,
      retorno_banco, vendedor_nome, observacao, situacao, created_by)
  VALUES (p_company_id, p_veiculo_id, v_prop, NULLIF(p_venda->>'cliente_id','')::uuid, v_cli_nome,
      p_venda->>'cliente_doc', COALESCE((p_venda->>'data_venda')::date, CURRENT_DATE),
      (p_venda->>'valor_venda')::numeric, NULLIF(v_desc,0), (p_venda->>'valor_entrada')::numeric,
      (p_venda->>'valor_financiado')::numeric, p_venda->>'banco_nome', (p_venda->>'retorno_banco')::numeric,
      p_venda->>'vendedor_nome', p_venda->>'observacao', 'aberta', p_user)
  RETURNING id INTO v_venda;

  -- §2: recebimentos → erp_receber com o devedor certo. Banco não é o cliente.
  -- Grava o recebimento PRIMEIRO: o título ancora no id DELE (gancho único por título, não por venda).
  IF p_recebimentos IS NOT NULL AND jsonb_typeof(p_recebimentos) = 'array' THEN
    FOR v_rec IN SELECT * FROM jsonb_array_elements(p_recebimentos) LOOP
      INSERT INTO veic_venda_recebimento (company_id, venda_id, tipo, devedor, valor, data_prevista,
          forma_pagamento, conta_bancaria_id)
      VALUES (p_company_id, v_venda, COALESCE(v_rec->>'tipo','parcela'), COALESCE(v_rec->>'devedor','cliente'),
          (v_rec->>'valor')::numeric, NULLIF(v_rec->>'data_prevista','')::date, v_rec->>'forma_pagamento',
          NULLIF(v_rec->>'conta_bancaria_id','')::uuid)
      RETURNING id INTO v_rec_id;
      v_receber := fn_veic__receber(p_company_id, v_rec_id,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco'
             THEN 'Repasse banco — ' || COALESCE(p_venda->>'banco_nome','') || ' — ' || COALESCE(v_modelo,'')
             ELSE (COALESCE(v_rec->>'tipo','parcela') || ' — ' || COALESCE(v_modelo,'') || ' — ' || COALESCE(v_cli_nome,'')) END,
        (v_rec->>'valor')::numeric, NULLIF(v_rec->>'data_prevista','')::date,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco' THEN NULL ELSE NULLIF(p_venda->>'cliente_id','')::uuid END,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco' THEN p_venda->>'banco_nome' ELSE v_cli_nome END,
        v_rec->>'forma_pagamento', NULLIF(v_rec->>'conta_bancaria_id','')::uuid);
      UPDATE veic_venda_recebimento SET receber_id = v_receber WHERE id = v_rec_id;
      n_titulos := n_titulos + 1;
    END LOOP;
  END IF;

  -- §1: veículo recebido em troca entra em estoque pelo valor de AVALIACAO (só se tiver chassi)
  IF v_troca_chassi IS NOT NULL THEN
    INSERT INTO veic_veiculo (company_id, chassi, placa, marca, modelo, ano_fabricacao, ano_modelo,
        km_entrada, km_atual, origem, valor_aquisicao, created_by, updated_by)
    VALUES (p_company_id, v_troca_chassi, NULLIF(p_troca->>'placa',''), p_troca->>'marca', p_troca->>'modelo',
        (p_troca->>'ano_fabricacao')::int, (p_troca->>'ano_modelo')::int, (p_troca->>'km')::numeric,
        (p_troca->>'km')::numeric, 'troca', v_aval, p_user, p_user)
    RETURNING id INTO v_troca_veic;
    INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, usuario_id, payload)
    VALUES (p_company_id, v_troca_veic, 'entrada',
        'Recebido em troca (venda) — avaliado em R$ ' || COALESCE(v_aval,0)::text, p_user,
        jsonb_build_object('origem','troca','valor_troca',v_troca_val,'valor_avaliacao',v_aval,'venda_id',v_venda));
    -- liga a troca da proposta ao veículo criado (single source of truth), se existir
    IF v_prop IS NOT NULL THEN
      UPDATE veic_proposta_troca SET veiculo_id = v_troca_veic
        WHERE proposta_id = v_prop AND veiculo_id IS NULL;
    END IF;
  END IF;

  -- move o veículo vendido e amarra proposta/reserva
  PERFORM fn_veic_mudar_situacao(p_veiculo_id, 'vendido', p_user, 'Venda registrada');
  IF v_prop IS NOT NULL THEN UPDATE veic_proposta SET situacao = 'aceita' WHERE id = v_prop AND situacao NOT IN ('cancelada','recusada'); END IF;
  UPDATE veic_reserva SET situacao = 'convertida' WHERE veiculo_id = p_veiculo_id AND situacao = 'ativa' AND deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'id', v_venda, 'desconto_embutido_troca', NULLIF(v_desc,0),
      'troca_veiculo_id', v_troca_veic, 'n_titulos', n_titulos);
END $function$;

-- entrega: venda faturada/aberta → entregue; veículo → entregue.
CREATE OR REPLACE FUNCTION public.fn_veic_venda_entregar(p_venda_id uuid, p_user uuid, p_obs text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_sit text;
BEGIN
  SELECT company_id, veiculo_id, situacao INTO v_comp, v_veic, v_sit FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_cancelada'); END IF;
  UPDATE veic_venda SET situacao = 'entregue' WHERE id = p_venda_id;
  PERFORM fn_veic_mudar_situacao(v_veic, 'entregue', p_user, COALESCE(p_obs, 'Veículo entregue'));
  RETURN jsonb_build_object('ok', true, 'situacao', 'entregue');
END $function$;

-- cancela venda → veículo volta a disponivel. NÃO exclui os títulos gerados (avisa quantos) — RD-30.
CREATE OR REPLACE FUNCTION public.fn_veic_venda_cancelar(p_venda_id uuid, p_user uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_sit text; v_veic_sit text; n_titulos int; v_troca uuid;
BEGIN
  SELECT company_id, veiculo_id, situacao INTO v_comp, v_veic, v_sit FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_cancelada'); END IF;

  SELECT count(*) INTO n_titulos FROM veic_venda_recebimento WHERE venda_id = p_venda_id AND receber_id IS NOT NULL;
  UPDATE veic_venda SET situacao = 'cancelada', observacao = COALESCE(observacao,'') || ' | CANCELADA: ' || COALESCE(p_motivo,'') WHERE id = p_venda_id;

  SELECT situacao INTO v_veic_sit FROM veic_veiculo WHERE id = v_veic;
  IF v_veic_sit IN ('vendido','entregue') THEN
    PERFORM fn_veic_mudar_situacao(v_veic, 'disponivel', p_user, 'Venda cancelada' || COALESCE(': '||p_motivo,''));
  END IF;
  -- o veículo recebido em troca (se houver) NÃO é excluído — fica no estoque para tratamento manual
  SELECT veiculo_id INTO v_troca FROM veic_proposta_troca t
    JOIN veic_venda vd ON vd.proposta_id = t.proposta_id WHERE vd.id = p_venda_id AND t.veiculo_id IS NOT NULL LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'titulos_nao_excluidos', n_titulos, 'troca_veiculo_id', v_troca);
END $function$;

-- ---------- view de listagem de vendas (derivada, security_invoker) ----------
CREATE OR REPLACE VIEW public.v_veic_venda WITH (security_invoker=on) AS
SELECT vd.id, vd.company_id, vd.veiculo_id, v.chassi, v.modelo, v.placa,
       vd.cliente_nome, vd.data_venda, vd.valor_venda, vd.desconto_embutido_troca,
       vd.valor_entrada, vd.valor_financiado, vd.banco_nome, vd.retorno_banco, vd.situacao,
       (SELECT COALESCE(SUM(r.valor),0) FROM veic_venda_recebimento r WHERE r.venda_id = vd.id AND r.devedor='cliente') AS total_cliente,
       (SELECT COALESCE(SUM(r.valor),0) FROM veic_venda_recebimento r WHERE r.venda_id = vd.id AND r.devedor='banco') AS total_banco,
       vd.vendedor_nome, vd.created_at
FROM public.veic_venda vd
JOIN public.veic_veiculo v ON v.id = vd.veiculo_id
WHERE vd.deleted_at IS NULL;

-- grants
REVOKE ALL ON FUNCTION public.fn_veic__receber(uuid,uuid,text,numeric,date,uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_proposta_criar(uuid,uuid,jsonb,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_proposta_situacao(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_reserva_criar(uuid,uuid,jsonb,boolean,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_reserva_cancelar(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_venda_registrar(uuid,uuid,jsonb,jsonb,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_venda_entregar(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_venda_cancelar(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_veic_proposta_criar(uuid,uuid,jsonb,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_proposta_situacao(uuid,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_reserva_criar(uuid,uuid,jsonb,boolean,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_reserva_cancelar(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_venda_registrar(uuid,uuid,jsonb,jsonb,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_venda_entregar(uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_venda_cancelar(uuid,uuid,text) TO authenticated, service_role;
GRANT SELECT ON public.v_veic_venda TO authenticated, service_role;
-- fn_veic__receber é helper interno: só service_role (chamado por SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION public.fn_veic__receber(uuid,uuid,text,numeric,date,uuid,text,text,uuid) TO service_role;
