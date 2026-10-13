-- Orçamento · numeração sequencial e configurável por empresa. Fronteira GE (comercial).
--
-- Diagnóstico (RD-38): next_orcamento_numero gera ORC-<ANO>-<NNNN>, mas havia número órfão
-- "ORC-346035" — vindo do fluxo OTC (otc/page.tsx: ORC-${Date.now().slice(-6)}), que NÃO chama a
-- RPC. Fix: (1) config por empresa (prefixo, incluir ano, próximo número); (2) a RPC lê a config;
-- (3) trigger BEFORE INSERT preenche o número se vier nulo — nenhum caminho escapa.
--
-- RD-54: NÃO renumera o órfão (pode ter ido ao cliente). Como o órfão tem prefixo diferente
-- (sem ano), ele nem entra na contagem do formato novo — a R.R começa limpo em ORC-2026-0001.

-- 1) Config por empresa (o "campo pra sequência").
CREATE TABLE IF NOT EXISTS public.erp_orcamento_numeracao (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  prefixo        text NOT NULL DEFAULT 'ORC',
  incluir_ano    boolean NOT NULL DEFAULT true,
  proximo_numero int NOT NULL DEFAULT 1,     -- piso: o próximo sai >= este número (não pode colidir c/ existente)
  padding        int NOT NULL DEFAULT 4,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_orcamento_numeracao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orc_num_rw ON public.erp_orcamento_numeracao;
CREATE POLICY orc_num_rw ON public.erp_orcamento_numeracao FOR ALL
  USING (company_id IN (SELECT public.get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.erp_orcamento_numeracao FROM anon;

-- 2) A RPC passa a ler a config (RD-52: formato vem da config, não hardcoded).
--    Número = GREATEST(max_existente_no_formato + 1, proximo_numero) → sequencial, piso configurável,
--    e nunca colide com um número já usado (RD-54).
CREATE OR REPLACE FUNCTION public.next_orcamento_numero(p_company_id uuid)
 RETURNS character varying
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefixo text; v_incluir_ano boolean; v_proximo int; v_pad int;
  v_ano text := to_char(current_date, 'YYYY');
  v_prefix text; v_max int; v_n int;
BEGIN
  SELECT prefixo, incluir_ano, proximo_numero, padding
    INTO v_prefixo, v_incluir_ano, v_proximo, v_pad
  FROM public.erp_orcamento_numeracao WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    v_prefixo := 'ORC'; v_incluir_ano := true; v_proximo := 1; v_pad := 4;
  END IF;

  v_prefix := v_prefixo || CASE WHEN v_incluir_ano THEN '-' || v_ano ELSE '' END || '-';

  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM '\d+$') AS INT)), 0)
    INTO v_max
  FROM public.erp_orcamentos
  WHERE company_id = p_company_id AND numero LIKE v_prefix || '%';

  v_n := GREATEST(v_max + 1, COALESCE(v_proximo, 1));
  RETURN v_prefix || LPAD(v_n::text, GREATEST(COALESCE(v_pad, 4), 1), '0');
END; $function$;

-- 3) Trigger BEFORE INSERT: garante que nenhum caminho escape (preenche número nulo/vazio).
CREATE OR REPLACE FUNCTION public.tg_orcamento_set_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero IS NULL OR btrim(NEW.numero) = '' THEN
    NEW.numero := public.next_orcamento_numero(NEW.company_id);
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_orcamento_set_numero ON public.erp_orcamentos;
CREATE TRIGGER trg_orcamento_set_numero
  BEFORE INSERT ON public.erp_orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_set_numero();
