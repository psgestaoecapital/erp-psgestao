-- ============================================================
-- #82③ · obra vira ESCOLHA — o trigger de criar obra fica CONDICIONAL (não removido)
-- ============================================================
-- Hoje tg_orcamento_gera_obra cria obra quando o orçamento vira aprovado/convertido (se o módulo
-- hub_obras está ativo). O Rodrigo fatura PARTES de obra e os outros CNPJs só faturam serviço —
-- criar obra sempre está errado. Agora é escolha por orçamento (eh_obra), SEM quebrar o que existe:
--   eh_obra IS NULL  → comportamento de HOJE (cria se hub_obras ativo — a fn já gateia internamente)
--   eh_obra = true   → cria
--   eh_obra = false  → NÃO cria (fatura só serviço)
-- 🔒 O trigger NÃO é removido — 4 obras da R.R dependem dele e todas têm pedido real. Só fica condicional.
ALTER TABLE public.erp_orcamentos ADD COLUMN IF NOT EXISTS eh_obra boolean;
COMMENT ON COLUMN public.erp_orcamentos.eh_obra IS
  '#82 · Este orçamento é de obra? NULL = padrão (cria obra se hub_obras ativo, como antes); true = cria; false = não cria (fatura só serviço). Default na TELA: ligado quando a empresa tem o módulo hub_obras.';

CREATE OR REPLACE FUNCTION public.tg_orcamento_gera_obra()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- COALESCE(eh_obra, true): orçamento sem a flag definida mantém EXATAMENTE o comportamento de hoje
  -- (a fn_obra_criar_de_orcamento só cria de fato quando hub_obras está ativo). false = opt-out explícito.
  IF NEW.status IN ('aprovado','convertido')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND COALESCE(NEW.eh_obra, true) THEN
    PERFORM public.fn_obra_criar_de_orcamento(NEW.id);
  END IF;
  RETURN NEW;
END $function$;

-- helper p/ a TELA decidir o default do checkbox (ligado só quando a empresa tem hub_obras)
CREATE OR REPLACE FUNCTION public.fn_empresa_tem_hub_obras(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.fn_get_tenant_modules_active(p_company_id) m WHERE m.module_id = 'hub_obras'
  );
$function$;
GRANT EXECUTE ON FUNCTION public.fn_empresa_tem_hub_obras(uuid) TO authenticated;
