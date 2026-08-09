-- SPEC · Custeio Camada 1 — Ficha técnica de material por procedimento. RD-56/RD-41/RD-26/RD-51/RD-52.
-- Quanto custa de MATERIAL cada procedimento = Σ (quantidade × preço de custo do insumo). O preço vem
-- SEMPRE do estoque GE (erp_produtos.preco_custo_medio, fallback preco_custo) — fonte única (RD-52).
-- Fronteira GE (RD-26): os insumos vivem no estoque da GE; a odonto só REFERENCIA (produto_id) + qtd.
--
-- Reuso vs. novo: erp_servicos_produtos usa servico_id (serviços da GE, com produto_codigo/nome
-- desnormalizados) — usar odonto procedimento ali conflataria dois domínios e poluiria uma tabela da GE.
-- Então criamos uma tabela FINA própria (mesmo padrão: item → produto × quantidade). RD-26 honesto.

CREATE TABLE IF NOT EXISTS public.erp_odonto_procedimento_insumo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  procedimento_id uuid NOT NULL REFERENCES public.erp_odonto_procedimento(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL,                 -- [→GE] erp_produtos.id
  quantidade numeric NOT NULL DEFAULT 1,    -- aceita fração/rateio (ex.: 1 broca ÷ 20 usos = 0,05)
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (procedimento_id, produto_id)
);
CREATE INDEX IF NOT EXISTS ix_odonto_proc_insumo ON public.erp_odonto_procedimento_insumo (company_id, procedimento_id);
ALTER TABLE public.erp_odonto_procedimento_insumo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sel_odonto_proc_insumo ON public.erp_odonto_procedimento_insumo;
CREATE POLICY sel_odonto_proc_insumo ON public.erp_odonto_procedimento_insumo FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- helper de preço (fonte única): médio > custo; NULL/0 = sem preço (RD-51: não assume zero, sinaliza)
-- custo de material de UM procedimento (detalhado + flag incompleto)
CREATE OR REPLACE FUNCTION public.fn_odonto_procedimento_custo_material(p_procedimento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid; v_itens jsonb; v_total numeric; v_incompleto boolean;
BEGIN
  SELECT company_id INTO v_co FROM erp_odonto_procedimento WHERE id = p_procedimento_id;
  IF v_co IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'procedimento não encontrado'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.nome), '[]'::jsonb),
         coalesce(sum(x.subtotal), 0), bool_or(x.sem_preco)
    INTO v_itens, v_total, v_incompleto
  FROM (
    SELECT fi.id, fi.produto_id, coalesce(pr.nome, 'Insumo') AS nome, pr.unidade,
           fi.quantidade, nullif(coalesce(nullif(pr.preco_custo_medio,0), nullif(pr.preco_custo,0)), 0) AS preco_unit,
           round(fi.quantidade * coalesce(nullif(pr.preco_custo_medio,0), nullif(pr.preco_custo,0), 0), 4) AS subtotal,
           (coalesce(nullif(pr.preco_custo_medio,0), nullif(pr.preco_custo,0)) IS NULL) AS sem_preco
    FROM erp_odonto_procedimento_insumo fi
    LEFT JOIN erp_produtos pr ON pr.id = fi.produto_id
    WHERE fi.procedimento_id = p_procedimento_id
  ) x;

  RETURN jsonb_build_object('ok', true, 'procedimento_id', p_procedimento_id,
    'custo_material', round(v_total, 2), 'incompleto', coalesce(v_incompleto, false), 'itens', v_itens);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_procedimento_custo_material(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_procedimento_custo_material(uuid) TO authenticated;

-- adicionar/atualizar um insumo na ficha técnica (upsert)
CREATE OR REPLACE FUNCTION public.fn_odonto_ficha_insumo_salvar(p_company_id uuid, p_procedimento_id uuid, p_produto_id uuid, p_quantidade numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_procedimento WHERE id = p_procedimento_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'procedimento não pertence à empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_produtos WHERE id = p_produto_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'insumo não encontrado no estoque desta empresa'); END IF;
  INSERT INTO erp_odonto_procedimento_insumo (company_id, procedimento_id, produto_id, quantidade)
  VALUES (p_company_id, p_procedimento_id, p_produto_id, greatest(0, coalesce(p_quantidade, 1)))
  ON CONFLICT (procedimento_id, produto_id) DO UPDATE SET quantidade = greatest(0, coalesce(EXCLUDED.quantidade, 1)), updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_ficha_insumo_salvar(uuid,uuid,uuid,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_ficha_insumo_salvar(uuid,uuid,uuid,numeric) TO authenticated;

-- remover um insumo da ficha
CREATE OR REPLACE FUNCTION public.fn_odonto_ficha_insumo_remover(p_company_id uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  DELETE FROM erp_odonto_procedimento_insumo WHERE id = p_id AND company_id = p_company_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_ficha_insumo_remover(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_ficha_insumo_remover(uuid,uuid) TO authenticated;

-- lista geral: todos os procedimentos com custo de material + preço + margem (sobre material)
CREATE OR REPLACE FUNCTION public.fn_odonto_procedimentos_custo(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.nome) FROM (
      SELECT p.id, p.nome, coalesce(p.valor, 0) AS valor, p.duracao_min,
        coalesce((SELECT sum(fi.quantidade * coalesce(nullif(pr.preco_custo_medio,0), nullif(pr.preco_custo,0), 0))
                  FROM erp_odonto_procedimento_insumo fi LEFT JOIN erp_produtos pr ON pr.id = fi.produto_id
                  WHERE fi.procedimento_id = p.id), 0) AS custo_material,
        coalesce((SELECT bool_or(coalesce(nullif(pr.preco_custo_medio,0), nullif(pr.preco_custo,0)) IS NULL)
                  FROM erp_odonto_procedimento_insumo fi LEFT JOIN erp_produtos pr ON pr.id = fi.produto_id
                  WHERE fi.procedimento_id = p.id), false) AS incompleto,
        (SELECT count(*) FROM erp_odonto_procedimento_insumo fi WHERE fi.procedimento_id = p.id) AS n_insumos
      FROM erp_odonto_procedimento p
      WHERE p.company_id = p_company_id AND coalesce(p.ativo, true)
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_procedimentos_custo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_procedimentos_custo(uuid) TO authenticated;
