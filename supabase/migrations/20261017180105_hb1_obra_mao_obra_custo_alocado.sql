-- HB1 (fatia 2): custo ALOCADO por obra — mão de obra apontada por obra + rateio de custo fixo.
-- Só objetos NOVOS (tabela, 2 funções, 1 view); a v_obra_resultado existente não é alterada.
-- RLS por empresa, REVOKE anon, gravação só pelas funções com guarda de empresa, exclusão lógica (RD-30).
CREATE TABLE IF NOT EXISTS public.projetos_obra_mao_obra_apontamento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id       uuid NOT NULL REFERENCES public.projetos_obras(id),
  data          date NOT NULL,
  funcao_id     uuid REFERENCES public.erp_funcao_mao_obra(id) ON DELETE SET NULL,
  descricao     text,
  horas         numeric(8,2) NOT NULL CHECK (horas > 0),
  custo_hora    numeric(12,2) NOT NULL CHECK (custo_hora >= 0),
  valor         numeric(14,2) GENERATED ALWAYS AS (round(horas * custo_hora, 2)) STORED,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  excluido_em   timestamptz,
  excluido_por  uuid
);
CREATE INDEX IF NOT EXISTS projetos_obra_mo_apont_idx
  ON public.projetos_obra_mao_obra_apontamento (company_id, obra_id) WHERE excluido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.projetos_obra_rateio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id       uuid NOT NULL REFERENCES public.projetos_obras(id),
  competencia   date NOT NULL,
  descricao     text NOT NULL CHECK (length(btrim(descricao)) > 0),
  valor         numeric(14,2) NOT NULL CHECK (valor > 0),
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  excluido_em   timestamptz
);
CREATE INDEX IF NOT EXISTS projetos_obra_rateio_idx
  ON public.projetos_obra_rateio (company_id, obra_id) WHERE excluido_em IS NULL;

ALTER TABLE public.projetos_obra_mao_obra_apontamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos_obra_rateio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_obra_mao_obra_apontamento, public.projetos_obra_rateio FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_obra_mo_apont_ler ON public.projetos_obra_mao_obra_apontamento;
CREATE POLICY projetos_obra_mo_apont_ler ON public.projetos_obra_mao_obra_apontamento FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS projetos_obra_rateio_ler ON public.projetos_obra_rateio;
CREATE POLICY projetos_obra_rateio_ler ON public.projetos_obra_rateio FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_obra_mao_obra_apontamento, public.projetos_obra_rateio TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_obra_mao_obra_apontar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  INSERT INTO public.projetos_obra_mao_obra_apontamento
    (company_id, obra_id, data, funcao_id, descricao, horas, custo_hora, criado_por)
  VALUES (v_company, p_obra_id, COALESCE((p_dados->>'data')::date, current_date),
    NULLIF(p_dados->>'funcao_id','')::uuid, p_dados->>'descricao',
    (p_dados->>'horas')::numeric, (p_dados->>'custo_hora')::numeric, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_mao_obra_apontar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_mao_obra_apontar(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_obra_mao_obra_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_mao_obra_apontamento WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Apontamento não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_mao_obra_apontamento SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_mao_obra_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_mao_obra_excluir(uuid) TO authenticated, service_role;

-- Resultado com custo ALOCADO: v_obra_resultado + mão de obra + rateio → margem após custo total.
CREATE OR REPLACE VIEW public.v_obra_resultado_alocado
WITH (security_invoker = true) AS
SELECT r.*,
  COALESCE(mo.valor, 0)::numeric(15,2) AS custo_mao_obra,
  COALESCE(rt.valor, 0)::numeric(15,2) AS custo_rateio,
  (r.margem_realizada - COALESCE(mo.valor,0) - COALESCE(rt.valor,0))::numeric(15,2) AS margem_alocada
FROM public.v_obra_resultado r
LEFT JOIN (SELECT obra_id, SUM(valor) AS valor FROM public.projetos_obra_mao_obra_apontamento
           WHERE excluido_em IS NULL GROUP BY obra_id) mo ON mo.obra_id = r.obra_id
LEFT JOIN (SELECT obra_id, SUM(valor) AS valor FROM public.projetos_obra_rateio
           WHERE excluido_em IS NULL GROUP BY obra_id) rt ON rt.obra_id = r.obra_id;
REVOKE ALL ON public.v_obra_resultado_alocado FROM anon, PUBLIC;
GRANT SELECT ON public.v_obra_resultado_alocado TO authenticated;
