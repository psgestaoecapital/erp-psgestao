-- RAIZ DO MENU (fim das telas órfãs). Causa real (auditada): um módulo só aparece no menu se estiver em
-- plan_modules (a RPC fn_modulos_sidebar_por_area, ramo 1, exige id ∈ plano da empresa). Módulo novo esquecido
-- de plan_modules nasce órfão. NÃO é surface_in_groups (168 módulos têm surface vazio e aparecem normalmente).
--
-- Fix de RAIZ (fail-safe visível SEM vazar tier): o módulo é vinculado aos planos onde os IRMÃOS DO MESMO
-- GRUPO já estão. Assim:
--   • órfão de grupo já vendido (ex.: industrial) → herda os planos do grupo → nasce visível.
--   • vertical inteira ainda não vendida (agro/wealth/custeio) → 0 irmãos em plano → NÃO é vinculada (correto,
--     é premium/futuro). Distingue "esquecido" de "premium" sem precisar de flag.
-- Trigger AFTER INSERT garante que TODA tela nova nasça vinculada (RD-57). Acesso segue no RBAC (estar no
-- plano ≠ poder entrar). RD-33: não toca áreas/planos permanentes, só o vínculo módulo↔plano.

CREATE OR REPLACE FUNCTION public.fn_vincular_modulo_aos_planos(p_module_id text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
  SELECT DISTINCT pm.plan_id, p_module_id, true
  FROM public.plan_modules pm
  JOIN public.module_catalog sib ON sib.id = pm.module_id
  JOIN public.module_catalog m   ON m.id = p_module_id
  WHERE sib.grupo = m.grupo AND sib.id <> m.id
    AND m.ativo AND m.rota IS NOT NULL AND m.grupo IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.fn_vincular_modulo_aos_planos(text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_vincular_modulo_aos_planos(text) TO authenticated;

-- Trigger: toda tela nova (ativo+rota+grupo) nasce vinculada aos planos do seu grupo. Nenhuma órfã por esquecimento.
CREATE OR REPLACE FUNCTION public.fn_trg_modulo_vincular_planos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.ativo AND NEW.rota IS NOT NULL AND NEW.grupo IS NOT NULL THEN
    PERFORM public.fn_vincular_modulo_aos_planos(NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_modulo_vincular_planos ON public.module_catalog;
CREATE TRIGGER trg_modulo_vincular_planos AFTER INSERT ON public.module_catalog
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_modulo_vincular_planos();

-- BACKFILL: vincula os órfãos atuais que têm irmãos-de-grupo em algum plano (deixa as verticais não vendidas fora).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT mc.id FROM public.module_catalog mc
    WHERE mc.ativo AND coalesce(mc.legacy,false)=false AND mc.rota IS NOT NULL AND mc.grupo IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.module_id = mc.id)
  LOOP
    PERFORM public.fn_vincular_modulo_aos_planos(r.id);
  END LOOP;
END $$;
