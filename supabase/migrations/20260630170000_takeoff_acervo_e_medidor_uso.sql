-- PARTE A.1 — Ficha do projeto em erp_obra_planta (acervo)
-- PARTE C.7 — Medidor generico de uso (base p/ billing variavel SaaS)
-- PARTE C.8 — Trigger registra uso quando planta vira 'processada'
-- PARTE C.9 — View v_uso_mensal_por_empresa (security_invoker=on)
-- Aplicada via MCP em 2026-06-30.

ALTER TABLE public.erp_obra_planta
  ADD COLUMN IF NOT EXISTS projeto_nome text,
  ADD COLUMN IF NOT EXISTS cliente_nome text,
  ADD COLUMN IF NOT EXISTS cliente_id uuid,
  ADD COLUMN IF NOT EXISTS engenheiro_responsavel text,
  ADD COLUMN IF NOT EXISTS obra_endereco text,
  ADD COLUMN IF NOT EXISTS obra_cidade text,
  ADD COLUMN IF NOT EXISTS obra_uf text,
  ADD COLUMN IF NOT EXISTS data_projeto date,
  ADD COLUMN IF NOT EXISTS observacoes text;
CREATE INDEX IF NOT EXISTS idx_erp_obra_planta_company_status
  ON public.erp_obra_planta (company_id, status);

CREATE TABLE IF NOT EXISTS public.erp_uso_medicao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  recurso text NOT NULL,           -- 'takeoff_planta', 'boleto_emitido', 'nfe_emitida', ...
  referencia_id uuid,
  quantidade numeric NOT NULL DEFAULT 1,
  custo_provedor numeric,          -- custo de API externa (ex: Autodesk APS). NULL hoje.
  moeda text NOT NULL DEFAULT 'BRL',
  metadados jsonb,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_uso_medicao_unico UNIQUE (company_id, recurso, referencia_id)
);
CREATE INDEX IF NOT EXISTS idx_erp_uso_medicao_company_recurso_ocorrido
  ON public.erp_uso_medicao (company_id, recurso, ocorrido_em);
ALTER TABLE public.erp_uso_medicao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_uso_medicao_select_company ON public.erp_uso_medicao;
CREATE POLICY erp_uso_medicao_select_company ON public.erp_uso_medicao
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));

CREATE OR REPLACE FUNCTION public.tg_erp_obra_planta_registrar_uso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- conta APENAS na transicao -> 'processada' (sucesso). NAO conta
  -- 'enviada'/'erro'/'processando' — cliente nao paga por erro do sistema.
  IF NEW.status = 'processada' AND (OLD.status IS DISTINCT FROM 'processada') THEN
    INSERT INTO public.erp_uso_medicao
      (company_id, recurso, referencia_id, quantidade, metadados, ocorrido_em)
    VALUES
      (NEW.company_id, 'takeoff_planta', NEW.id, 1,
       jsonb_build_object('arquivo_tipo', NEW.arquivo_tipo, 'area_total_m2', NEW.area_total_m2),
       now())
    ON CONFLICT ON CONSTRAINT erp_uso_medicao_unico DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_erp_obra_planta_registrar_uso ON public.erp_obra_planta;
CREATE TRIGGER tg_erp_obra_planta_registrar_uso
  AFTER UPDATE OF status ON public.erp_obra_planta
  FOR EACH ROW EXECUTE FUNCTION public.tg_erp_obra_planta_registrar_uso();

INSERT INTO public.erp_uso_medicao (company_id, recurso, referencia_id, quantidade, metadados, ocorrido_em)
SELECT company_id, 'takeoff_planta', id, 1,
       jsonb_build_object('arquivo_tipo', arquivo_tipo, 'area_total_m2', area_total_m2),
       COALESCE(updated_at, created_at, now())
FROM public.erp_obra_planta
WHERE status = 'processada'
ON CONFLICT ON CONSTRAINT erp_uso_medicao_unico DO NOTHING;

CREATE OR REPLACE VIEW public.v_uso_mensal_por_empresa
WITH (security_invoker = on) AS
SELECT
  company_id,
  date_trunc('month', ocorrido_em)::date AS mes,
  recurso,
  COUNT(*) AS qtd_eventos,
  COALESCE(SUM(quantidade), 0) AS soma_quantidade,
  COALESCE(SUM(custo_provedor), 0) AS soma_custo_provedor,
  moeda
FROM public.erp_uso_medicao
GROUP BY company_id, mes, recurso, moeda;
