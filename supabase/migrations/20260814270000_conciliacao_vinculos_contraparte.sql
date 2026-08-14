-- Conciliação agrupada · itens dos vínculos passam a trazer o NOME da contraparte (Jordana item 1).
-- fn_conciliacao_vinculos já lista os títulos de um movimento, mas cada item só trazia `descricao`
-- (descrição do lançamento — nem sempre o nome legível). Adiciona `contraparte` por item
-- (COALESCE fornecedor/cliente/descrição) para o expandível mostrar "nome + valor de cada título".
-- Aditivo (RD-30): mantém todas as chaves existentes (descricao/valor/vencimento/…); só ACRESCENTA
-- `contraparte`. Nada muda de dado — é leitura. Outros chamadores (VincularVariosModal) seguem válidos.

CREATE OR REPLACE FUNCTION public.fn_conciliacao_vinculos(p_movimento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov RECORD;
  v_itens jsonb;
  v_soma numeric;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado');
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'vinculo_id', v.id,
      'tabela', v.lancamento_tabela,
      'lancamento_id', v.lancamento_id,
      'valor', v.valor_vinculado,
      'contraparte', COALESCE(p.fornecedor_nome, r.cliente_nome, p.descricao, r.descricao),
      'descricao', COALESCE(p.descricao, r.descricao),
      'vencimento', COALESCE(p.data_vencimento, r.data_vencimento)
    ) ORDER BY v.criado_em), '[]'::jsonb),
    COALESCE(sum(v.valor_vinculado), 0)
    INTO v_itens, v_soma
  FROM conciliacao_vinculo v
  LEFT JOIN erp_pagar   p ON v.lancamento_tabela = 'erp_pagar'   AND p.id = v.lancamento_id
  LEFT JOIN erp_receber r ON v.lancamento_tabela = 'erp_receber' AND r.id = v.lancamento_id
  WHERE v.movimento_id = p_movimento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'valor_movimento', v_mov.valor,
    'soma_vinculada', v_soma,
    'saldo', round(abs(v_mov.valor) - v_soma, 2),
    'fecha', (abs(abs(v_mov.valor) - v_soma) <= 0.05),
    'itens', v_itens
  );
END;
$function$;
