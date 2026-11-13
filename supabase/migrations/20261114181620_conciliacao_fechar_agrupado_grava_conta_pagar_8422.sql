-- #8422 — CONCILIAÇÃO AGRUPADA: gravar a conta bancária no ramo erp_pagar (mesma causa do #4826,
--   outro ponto de entrada). Critério de pronto do chamado: "conciliação NOVA de pagamento, em qualquer
--   empresa, grava a conta do extrato automaticamente" — vale também para a baixa AGRUPADA.
--
-- CAUSA (RD-38, corpo vivo lido com pg_get_functiondef em 2026-11-12):
--   fn_conciliacao_fechar_agrupado grava a conta só no ramo erp_receber
--     (conta_bancaria_id = coalesce(conta_bancaria_id, v_conta)); o ramo erp_pagar dá a baixa SEM gravar a
--     conta (igual ao bug corrigido em fn_conciliacao_aplicar_match pelo #4826). Resultado: pagamento
--     conciliado em lote fica com conta_bancaria vazia e sai do saldo gerencial da conta.
--   OBS. de esquema: erp_pagar.conta_bancaria é VARCHAR com o NOME da conta; erp_receber.conta_bancaria_id
--     é uuid. fn_saldo_gerencial_contas atribui o pagar por lower(btrim(conta_bancaria))=lower(btrim(nome)).
--     Por isso aqui gravamos o NOME da conta do lote.
--
-- CORREÇÃO (aditiva, só no ramo erp_pagar): resolve o NOME da conta do lote (erp_banco_contas.nome pelo
--   conciliacao_lote.conta_bancaria_id, já lido em v_conta) e grava em erp_pagar.conta_bancaria quando
--   estiver vazia (coalesce — nunca sobrescreve conta já informada). fn_pagar_conciliacao_sync (chamada
--   depois) NÃO toca conta_bancaria, então o valor gravado aqui permanece. Receber: intacto (#3866).
--   Nada mais do corpo muda (SECURITY DEFINER, search_path, guarda de empresa e demais passos preservados).
--
-- Corpo rescrito a partir da definição VIVA (RD-94.1: CREATE OR REPLACE de função SECURITY DEFINER = sensível).
--
-- Code: jordana-code

CREATE OR REPLACE FUNCTION public.fn_conciliacao_fechar_agrupado(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid, p_tolerancia numeric DEFAULT 0.05, p_juros numeric DEFAULT 0, p_multa numeric DEFAULT 0, p_desconto numeric DEFAULT 0, p_ajuste_lancamento_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mov record; v_soma numeric; v_vin record; v_qtd int := 0;
  v_acr numeric := round(coalesce(p_juros,0) + coalesce(p_multa,0), 2);
  v_desc numeric := round(coalesce(p_desconto,0), 2);
  v_efetivo numeric; v_anchor uuid; v_anchor_tab text;
  v_receber uuid[] := '{}';
  v_pagar uuid[] := '{}';
  v_conta uuid;
  v_conta_nome text;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
begin
  select * into v_mov from conciliacao_movimento where id = p_movimento_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado'); end if;
  if not (v_interno or auth.role()='service_role' or v_mov.company_id in (select get_user_company_ids()) or is_admin()) then
    raise exception 'Sem acesso a esta empresa' using errcode='42501';
  end if;
  if v_mov.status = 'conciliado' then
    return jsonb_build_object('ok', true, 'conciliado', true, 'ja', true, 'valor', v_mov.valor);
  end if;
  -- #3866: conta bancária do lote do movimento, para gravar nos títulos a receber
  select conta_bancaria_id into v_conta from conciliacao_lote where id = v_mov.lote_id;
  -- #8422: nome da conta do lote, para gravar no ramo erp_pagar (coluna é o NOME, não uuid)
  select nome into v_conta_nome from erp_banco_contas where id = v_conta;
  select coalesce(sum(valor_vinculado),0) into v_soma from conciliacao_vinculo where movimento_id = p_movimento_id;
  if v_soma = 0 then return jsonb_build_object('ok', false, 'erro', 'nenhuma conta vinculada'); end if;

  v_efetivo := round(v_soma + v_acr - v_desc, 2);
  if abs(abs(v_mov.valor) - v_efetivo) > p_tolerancia then
    return jsonb_build_object('ok', false, 'erro', 'soma nao fecha com a fatura',
      'valor_movimento', v_mov.valor, 'soma_vinculada', v_soma, 'acrescimo', v_acr, 'desconto', v_desc,
      'saldo', round(abs(v_mov.valor) - v_efetivo, 2));
  end if;

  if p_ajuste_lancamento_id is not null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id and lancamento_id = p_ajuste_lancamento_id limit 1;
  end if;
  if v_anchor is null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id order by valor_vinculado desc limit 1;
  end if;

  if (v_acr <> 0 or v_desc <> 0) and v_anchor is not null then
    perform fn_conciliacao_ajustar_valores(
      v_anchor, case when v_anchor_tab = 'erp_pagar' then 'pagar' else 'receber' end,
      v_acr, v_desc, coalesce(nullif(btrim(p_observacao),''), 'conciliação: diferença banco × título'), null);
    -- o acréscimo/desconto entra no valor vinculado do título-âncora (a baixa daquele movimento passa a ter
    -- o valor efetivamente pago/recebido; a soma dos vínculos fecha com o extrato) — receber e pagar
    update conciliacao_vinculo set valor_vinculado = round(valor_vinculado + v_acr - v_desc, 2)
     where movimento_id = p_movimento_id and lancamento_tabela = v_anchor_tab and lancamento_id = v_anchor;
  end if;

  for v_vin in select * from conciliacao_vinculo where movimento_id = p_movimento_id loop
    if v_vin.lancamento_tabela = 'erp_pagar' then
      -- pagar não grava mais valor_pago aqui; a baixa nasce (ou é reaproveitada) no sync abaixo
      -- #8422: grava o NOME da conta do lote quando o título ainda está sem conta (nunca sobrescreve)
      update erp_pagar set conciliado = true, movimento_banco_id = p_movimento_id,
             conta_bancaria = coalesce(nullif(btrim(conta_bancaria),''), v_conta_nome),
             forma_pagamento = coalesce(nullif(forma_pagamento,''), 'cartao_credito'), updated_at = now()
        where id = v_vin.lancamento_id;
      v_pagar := array_append(v_pagar, v_vin.lancamento_id);
    else
      update erp_receber set conciliado = true, movimento_banco_id = p_movimento_id,
             conta_bancaria_id = coalesce(conta_bancaria_id, v_conta), updated_at = now()
        where id = v_vin.lancamento_id;
      v_receber := array_append(v_receber, v_vin.lancamento_id);
    end if;
    v_qtd := v_qtd + 1;
  end loop;

  update conciliacao_movimento set status='conciliado', match_origem='agrupado',
    match_aplicado_em=now(), match_aplicado_por=COALESCE(auth.uid(), p_operador_id) where id = p_movimento_id;

  perform public.fn_receber_conciliacao_sync(x) from unnest(v_receber) x;
  perform public.fn_pagar_conciliacao_sync(x) from unnest(v_pagar) x;

  return jsonb_build_object('ok', true, 'conciliado', true, 'qtd_baixados', v_qtd,
    'valor', v_mov.valor, 'acrescimo', v_acr, 'desconto', v_desc, 'ajuste_lancamento', v_anchor);
end;
$function$;

-- Guarda da régua check-fn-guards (regra 1): SECURITY DEFINER nunca exposta a quem não está logado.
-- Idempotente — a ACL viva (RD-38, 13/11) já tem só authenticated/postgres/service_role; CREATE OR REPLACE
-- preserva esses grants, o REVOKE só reforça que PUBLIC/anon não têm EXECUTE.
REVOKE ALL ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text) FROM PUBLIC, anon;
