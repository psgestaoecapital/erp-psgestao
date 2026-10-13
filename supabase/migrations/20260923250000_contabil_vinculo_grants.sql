-- Adendo ao Relatório Gerencial × Contábil · fecha os grants das 3 funções SECURITY DEFINER
-- de vínculo/de-para (estavam abertas). Nunca anon/PUBLIC; só authenticated e service_role.
-- RD-52. Grant-only (não recria função) — as funções já existem em produção.

REVOKE ALL ON FUNCTION public.fn_conta_contabil_vincular(uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vincular(uuid,uuid,uuid,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_conta_contabil_vinculos_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conta_contabil_vinculos_listar(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_contabil_depara_importar(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contabil_depara_importar(uuid,uuid,jsonb) TO authenticated, service_role;
