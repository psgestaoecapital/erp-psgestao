-- DF-e Onda 2.1 fix · alinhar status ao check constraint canonico
-- O check original aceita: resumo, completa, lancada, ignorada.
-- A Onda 2.1 acrescenta o estado intermediario 'aguardando_xml'.
-- A migration 20260620120000 escreveu 'completo' (masculino) na RPC,
-- quebrando o INSERT. Vocabulario canonico (do banco): feminino.
--   resumo -> aguardando_xml -> completa -> lancada

ALTER TABLE public.erp_nfe_recebidas
  DROP CONSTRAINT IF EXISTS erp_nfe_recebidas_status_check;

ALTER TABLE public.erp_nfe_recebidas
  ADD CONSTRAINT erp_nfe_recebidas_status_check
  CHECK (status IN ('resumo', 'aguardando_xml', 'completa', 'lancada', 'ignorada'));

-- Recria a RPC com 'completa' (e nao 'completo')
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_aplicar_xml(
  p_id uuid,
  p_xml text,
  p_dados jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v erp_nfe_recebidas%ROWTYPE;
  it jsonb;
  dup jsonb;
  v_itens int := 0;
  v_dups  int := 0;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nfe nao encontrada');
  END IF;

  UPDATE erp_nfe_recebidas SET
    emitente_cnpj       = COALESCE(p_dados->'emitente'->>'cnpj',  emitente_cnpj),
    emitente_razao      = COALESCE(p_dados->'emitente'->>'razao', emitente_razao),
    emitente_ie         = COALESCE(p_dados->'emitente'->>'ie',    emitente_ie),
    numero              = COALESCE(p_dados->'ide'->>'numero',     numero),
    serie               = COALESCE(p_dados->'ide'->>'serie',      serie),
    modelo              = COALESCE(p_dados->'ide'->>'modelo',     modelo),
    natureza_operacao   = COALESCE(p_dados->'ide'->>'natureza_operacao', natureza_operacao),
    valor_total         = COALESCE((p_dados->'totais'->>'valor_total')::numeric,    valor_total),
    valor_produtos      = COALESCE((p_dados->'totais'->>'valor_produtos')::numeric, valor_produtos),
    status              = 'completa',
    status_manifestacao = COALESCE(p_dados->>'manifestacao', 'ciencia'),
    xml_raw             = COALESCE(p_xml, xml_raw),
    updated_at          = now()
  WHERE id = p_id;

  DELETE FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id = p_id;
  FOR it IN SELECT jsonb_array_elements(COALESCE(p_dados->'itens', '[]'::jsonb)) LOOP
    INSERT INTO erp_nfe_recebidas_itens (
      nfe_recebida_id, company_id, numero_item, codigo_produto, descricao,
      ncm, cfop, unidade, quantidade, valor_unitario, valor_total
    ) VALUES (
      p_id, v.company_id,
      NULLIF(it->>'numero_item','')::int,
      it->>'codigo_produto',
      it->>'descricao',
      it->>'ncm',
      it->>'cfop',
      it->>'unidade',
      NULLIF(it->>'quantidade','')::numeric,
      NULLIF(it->>'valor_unitario','')::numeric,
      NULLIF(it->>'valor_total','')::numeric
    );
    v_itens := v_itens + 1;
  END LOOP;

  DELETE FROM erp_nfe_recebidas_duplicatas WHERE nfe_recebida_id = p_id;
  FOR dup IN SELECT jsonb_array_elements(COALESCE(p_dados->'duplicatas', '[]'::jsonb)) LOOP
    INSERT INTO erp_nfe_recebidas_duplicatas (
      nfe_recebida_id, company_id, numero_dup, data_vencimento, valor
    ) VALUES (
      p_id, v.company_id,
      dup->>'numero_dup',
      NULLIF(dup->>'data_vencimento','')::date,
      NULLIF(dup->>'valor','')::numeric
    );
    v_dups := v_dups + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'itens', v_itens, 'duplicatas', v_dups);
END;
$function$;

-- Backfill defensivo: se alguma linha ja escapou com status='completo'
-- (improvavel · INSERT teria sido bloqueado pelo CHECK antigo, mas
-- garantia extra), normaliza pra 'completa'.
UPDATE public.erp_nfe_recebidas SET status = 'completa' WHERE status = 'completo';

COMMENT ON CONSTRAINT erp_nfe_recebidas_status_check ON public.erp_nfe_recebidas IS
  'DF-e Onda 2.1 · canonico: resumo -> aguardando_xml -> completa -> lancada (+ ignorada).';
