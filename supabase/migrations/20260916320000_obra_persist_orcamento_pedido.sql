-- #82② · CLUSTER FATURAMENTO DE OBRA · Parte 1 — persistência + detecção.
-- Decisão CEO+Rodrigo: no orçamento/pedido, quando o serviço exige obra (E0370), grava a obra escolhida
-- COMO CAMPOS (o documento fiscal é autossuficiente — congela o que valia, igual cliente_nome × cliente_id;
-- se dependesse de ler projetos_obras na emissão e a obra mudasse depois, o histórico da nota mudaria).
--
-- 🔒 Grava obra_id E os campos SEMPRE que houver obra:
--    opção 1 (apontar obra)      → obra_id + copia CNO/endereço/IBGE/UF da obra
--    opção 2 (informar na hora)   → só os campos, obra_id NULL
--    opção 3 (informar + criar)   → cria a obra no Hub e grava obra_id + campos
--    obra_id serve pra RASTREAR (voltar custo à obra — #82.3); os campos servem pra EMITIR.
-- 🔒 Campos GRANULARES (o payload nacional/Focus usa xLgr/nro/xBairro separados) + obra_uf (o guard
--    fn_nfse_obra_pendente compara IBGE × UF) + obra_codigo_ibge (define onde o ISS incide — nulo = sinaliza,
--    nunca chuta; foi o erro Toledo/PR).
-- 🔒 ADITIVO, tudo nullable — os 26 orçamentos e 16 pedidos existentes não quebram (RD-30).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_orcamentos','erp_pedidos'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS obra_id uuid,
      ADD COLUMN IF NOT EXISTS obra_cno text,
      ADD COLUMN IF NOT EXISTS obra_logradouro text,
      ADD COLUMN IF NOT EXISTS obra_numero text,
      ADD COLUMN IF NOT EXISTS obra_complemento text,
      ADD COLUMN IF NOT EXISTS obra_bairro text,
      ADD COLUMN IF NOT EXISTS obra_cidade text,
      ADD COLUMN IF NOT EXISTS obra_uf text,
      ADD COLUMN IF NOT EXISTS obra_cep text,
      ADD COLUMN IF NOT EXISTS obra_codigo_ibge text', t);
  END LOOP;
END $$;

COMMENT ON COLUMN public.erp_orcamentos.obra_id IS 'Obra apontada (projetos_obras) — rastreio (#82.3). NULL quando "informar na hora" sem obra cadastrada. Os campos obra_* são copiados/congelados para emitir a nota (autossuficiência fiscal).';
COMMENT ON COLUMN public.erp_orcamentos.obra_codigo_ibge IS 'IBGE do município da obra (define onde o ISS incide). NULL = município não identificado → sinalizar antes de faturar, NUNCA chutar.';

-- Detecção do E0370 no orçamento — reusa a MESMA regra da emissão (fn_fiscal_exige_obra, tabela dos 13
-- subitens), casando pelo codigo_servico_municipio (070202), não o LC116 (07.02 não casa).
CREATE OR REPLACE FUNCTION public.fn_orcamento_exige_obra(p_orcamento_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(bool_or(public.fn_fiscal_exige_obra(o.company_id, s.codigo_servico_municipio)), false)
  FROM public.erp_orcamentos o
  JOIN public.erp_orcamentos_itens i ON i.orcamento_id = o.id
  JOIN public.erp_servicos s ON s.id = i.servico_id
  WHERE o.id = p_orcamento_id AND i.servico_id IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_exige_obra(uuid) TO authenticated, service_role;
