-- NÚCLEO FINANCEIRO · conciliação agrupada · ajuste POR TÍTULO (chamado #10136)
-- CAUSA-RAIZ (RD-38, provada na def VIVA): fn_conciliacao_fechar_agrupado aplicava
-- acréscimo/desconto a UM SÓ título (o âncora: p_ajuste_lancamento_id ou o vínculo de
-- maior valor). Os demais títulos do grupo conciliavam SEM o juros/multa deles →
-- ficavam "parcial". A sócia Jordana ficou travada por isso.
--
-- FIX ESTRUTURAL (parte 1 — writer): novo parâmetro p_ajustes jsonb DEFAULT NULL, no
-- FIM da assinatura (backward-compat: p_ajustes NULL ⇒ comportamento atual, âncora único).
--   p_ajustes = [{lancamento_id, lancamento_tabela, juros, multa, desconto}, ...]
-- Quando p_ajustes != NULL:
--   • a validação "soma fecha com a fatura" usa Σ(acr)-Σ(desc) de TODOS os ajustes;
--   • para CADA entrada (que tenha vínculo no movimento), aplica
--     fn_conciliacao_ajustar_valores naquele título e soma (acr-desc) no valor_vinculado
--     DAQUELE título. Vale para erp_receber E erp_pagar.
-- A regra do parcial continua no sync (fn_receber/pagar_conciliacao_sync, parte 2 de #5624):
-- título liquida por INTEIRO quando valor_pago >= valor original; juros/multa vão nas
-- colunas juros/multa (receita financeira), sem mexer no valor original.
--
-- SECURITY DEFINER, search_path=public e ACL mantidos (só CREATE OR REPLACE, aditivo,
-- não altera dado de cliente — a correção dos 3 títulos reais vai em migration própria).
-- Assinatura antiga (8 args) continua existindo; esta cria a sobrecarga de 9 args. Para
-- evitar ambiguidade/órfã, a antiga é removida e recriada só como wrapper desta.

-- Remove a assinatura antiga (8 args) para a chamada por nome não ficar ambígua.
DROP FUNCTION IF EXISTS public.fn_conciliacao_fechar_agrupado(uuid,uuid,numeric,numeric,numeric,numeric,uuid,text);

CREATE OR REPLACE FUNCTION public.fn_conciliacao_fechar_agrupado(
  p_movimento_id uuid,
  p_operador_id uuid DEFAULT NULL::uuid,
  p_tolerancia numeric DEFAULT 0.05,
  p_juros numeric DEFAULT 0,
  p_multa numeric DEFAULT 0,
  p_desconto numeric DEFAULT 0,
  p_ajuste_lancamento_id uuid DEFAULT NULL::uuid,
  p_observacao text DEFAULT NULL::text,
  p_ajustes jsonb DEFAULT NULL::jsonb)
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
  -- ajuste por título (p_ajustes)
  v_aj jsonb; v_aj_id uuid; v_aj_tab text; v_aj_acr numeric; v_aj_desc numeric;
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

  -- #10136: com ajuste POR TÍTULO, a validação usa Σ(acréscimo)-Σ(desconto) de todos os
  -- ajustes (só os que têm vínculo no movimento, defensivo contra payload inválido).
  if p_ajustes is not null then
    select coalesce(sum(round(coalesce((e->>'juros')::numeric,0) + coalesce((e->>'multa')::numeric,0), 2)), 0),
           coalesce(sum(round(coalesce((e->>'desconto')::numeric,0), 2)), 0)
      into v_acr, v_desc
    from jsonb_array_elements(p_ajustes) e
    where exists (select 1 from conciliacao_vinculo v
                   where v.movimento_id = p_movimento_id
                     and v.lancamento_id = (e->>'lancamento_id')::uuid);
  end if;

  v_efetivo := round(v_soma + v_acr - v_desc, 2);
  if abs(abs(v_mov.valor) - v_efetivo) > p_tolerancia then
    return jsonb_build_object('ok', false, 'erro', 'soma nao fecha com a fatura',
      'valor_movimento', v_mov.valor, 'soma_vinculada', v_soma, 'acrescimo', v_acr, 'desconto', v_desc,
      'saldo', round(abs(v_mov.valor) - v_efetivo, 2));
  end if;

  -- âncora (compat): usado quando p_ajustes é NULL
  if p_ajuste_lancamento_id is not null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id and lancamento_id = p_ajuste_lancamento_id limit 1;
  end if;
  if v_anchor is null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id order by valor_vinculado desc limit 1;
  end if;

  if p_ajustes is not null then
    -- #10136: ajuste POR TÍTULO — cada título recebe o SEU juros/multa/desconto
    for v_aj in select jsonb_array_elements(p_ajustes) loop
      v_aj_id  := (v_aj->>'lancamento_id')::uuid;
      v_aj_tab := case when (v_aj->>'lancamento_tabela') = 'erp_pagar' then 'erp_pagar' else 'erp_receber' end;
      -- só ajusta título que está vinculado a ESTE movimento (defensivo)
      if not exists (select 1 from conciliacao_vinculo v
                      where v.movimento_id = p_movimento_id and v.lancamento_id = v_aj_id) then
        continue;
      end if;
      v_aj_acr  := round(coalesce((v_aj->>'juros')::numeric,0) + coalesce((v_aj->>'multa')::numeric,0), 2);
      v_aj_desc := round(coalesce((v_aj->>'desconto')::numeric,0), 2);
      if v_aj_acr <> 0 or v_aj_desc <> 0 then
        perform fn_conciliacao_ajustar_valores(
          v_aj_id, case when v_aj_tab = 'erp_pagar' then 'pagar' else 'receber' end,
          v_aj_acr, v_aj_desc,
          coalesce(nullif(btrim(p_observacao),''), 'conciliação: diferença banco × título'), null);
        update conciliacao_vinculo set valor_vinculado = round(valor_vinculado + v_aj_acr - v_aj_desc, 2)
         where movimento_id = p_movimento_id and lancamento_tabela = v_aj_tab and lancamento_id = v_aj_id;
      end if;
    end loop;
  elsif (v_acr <> 0 or v_desc <> 0) and v_anchor is not null then
    -- compat: âncora único (comportamento anterior)
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
    'valor', v_mov.valor, 'acrescimo', v_acr, 'desconto', v_desc, 'ajuste_lancamento', v_anchor,
    'ajuste_por_titulo', (p_ajustes is not null));
end;
$function$;

-- Guarda de acesso (check_fn_guards): reafirma a ACL VIVA. fn chamada pela UI logada
-- (SECURITY DEFINER) — grant a authenticated + service_role, REVOKE anon/public.
REVOKE ALL ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid,uuid,numeric,numeric,numeric,numeric,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid,uuid,numeric,numeric,numeric,numeric,uuid,text,jsonb) TO authenticated, service_role;
