-- Pendência Jordana #1 · Conciliação: fechar a diferença banco × título (juros/multa/desconto).
-- Ex.: PIX R$ 1.177,62 vs títulos R$ 1.150,00 → "faltam R$ 27,62". Agora o operador indica
-- acréscimo (juros/multa recebido) ou desconto (concedido) em TODAS as opções (individual + fatura).
--
-- fn_conciliacao_fechar_agrupado ganha p_juros/p_multa/p_desconto (default 0) + âncora opcional:
--  - checa fechamento contra (Σ vinculado + acréscimo − desconto);
--  - registra o ajuste num título âncora (o de maior valor, ou informado) reusando
--    fn_conciliacao_ajustar_valores (trilha auditável nos campos juros/desconto + observação);
--  - baixa com valor_pago = valor_vinculado (+ ajuste só no âncora) → Σ bate com o extrato.
-- Compatível: os 3 primeiros params são os de antes → sem ajuste, comporta-se igual.
-- Idempotente (RD-55): movimento já conciliado não reprocessa. Serve erp_receber e erp_pagar.
create or replace function public.fn_conciliacao_fechar_agrupado(
  p_movimento_id uuid,
  p_operador_id uuid default null,
  p_tolerancia numeric default 0.05,
  p_juros numeric default 0,
  p_multa numeric default 0,
  p_desconto numeric default 0,
  p_ajuste_lancamento_id uuid default null,
  p_observacao text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_mov record; v_soma numeric; v_vin record; v_qtd int := 0;
  v_acr numeric := round(coalesce(p_juros,0) + coalesce(p_multa,0), 2);
  v_desc numeric := round(coalesce(p_desconto,0), 2);
  v_efetivo numeric; v_anchor uuid; v_anchor_tab text;
begin
  select * into v_mov from conciliacao_movimento where id = p_movimento_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado'); end if;

  if v_mov.status = 'conciliado' then
    return jsonb_build_object('ok', true, 'conciliado', true, 'ja', true, 'valor', v_mov.valor);
  end if;

  select coalesce(sum(valor_vinculado),0) into v_soma
    from conciliacao_vinculo where movimento_id = p_movimento_id;
  if v_soma = 0 then return jsonb_build_object('ok', false, 'erro', 'nenhuma conta vinculada'); end if;

  v_efetivo := round(v_soma + v_acr - v_desc, 2);
  if abs(abs(v_mov.valor) - v_efetivo) > p_tolerancia then
    return jsonb_build_object('ok', false, 'erro', 'soma nao fecha com a fatura',
      'valor_movimento', v_mov.valor, 'soma_vinculada', v_soma,
      'acrescimo', v_acr, 'desconto', v_desc,
      'saldo', round(abs(v_mov.valor) - v_efetivo, 2));
  end if;

  if p_ajuste_lancamento_id is not null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo
     where movimento_id = p_movimento_id and lancamento_id = p_ajuste_lancamento_id limit 1;
  end if;
  if v_anchor is null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo
     where movimento_id = p_movimento_id order by valor_vinculado desc limit 1;
  end if;

  if (v_acr <> 0 or v_desc <> 0) and v_anchor is not null then
    perform fn_conciliacao_ajustar_valores(
      v_anchor,
      case when v_anchor_tab = 'erp_pagar' then 'pagar' else 'receber' end,
      v_acr, v_desc,
      coalesce(nullif(btrim(p_observacao),''), 'conciliação: diferença banco × título'),
      null);
  end if;

  for v_vin in select * from conciliacao_vinculo where movimento_id = p_movimento_id loop
    if v_vin.lancamento_tabela = 'erp_pagar' then
      update erp_pagar set status='pago',
        valor_pago = round(v_vin.valor_vinculado + case when v_vin.lancamento_id = v_anchor then v_acr - v_desc else 0 end, 2),
        data_pagamento = v_mov.data_transacao,
        forma_pagamento = coalesce(forma_pagamento, 'cartao_credito')
       where id = v_vin.lancamento_id;
    else
      update erp_receber set status='pago',
        valor_pago = round(v_vin.valor_vinculado + case when v_vin.lancamento_id = v_anchor then v_acr - v_desc else 0 end, 2),
        data_pagamento = v_mov.data_transacao
       where id = v_vin.lancamento_id;
    end if;
    v_qtd := v_qtd + 1;
  end loop;

  update conciliacao_movimento set status='conciliado', match_origem='agrupado',
    match_aplicado_em=now(), match_aplicado_por=p_operador_id
   where id = p_movimento_id;

  return jsonb_build_object('ok', true, 'conciliado', true, 'qtd_baixados', v_qtd,
    'valor', v_mov.valor, 'acrescimo', v_acr, 'desconto', v_desc, 'ajuste_lancamento', v_anchor);
end;
$function$;