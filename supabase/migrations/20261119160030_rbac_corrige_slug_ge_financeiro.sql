-- Financeiro sumido no menu por papel (emergência FC Pisos/Willian 17/11, RD-25). Os módulos do Financeiro da
-- GE têm module_catalog.subgrupo='financeiro' (26 módulos), mas 5 papéis liberavam a seção com o slug ERRADO
-- 'ge_financeiro' (0 módulos). O gate de menu (fn_modulos_sidebar_por_area) compara rbac_papel_acesso.subgrupo
-- com o subgrupo do módulo -> o grupo Financeiro inteiro sumia para hub_financeiro (Willian), hub_socio,
-- pm_financeiro, pm_gestor_contas, pm_socio. Renomeia para o slug real. Aditivo/idempotente; nenhum outro grupo
-- muda; não toca dado de cliente. Nenhum papel tem AMBOS os slugs (conferido), então o DELETE é no-op aqui.
UPDATE public.rbac_papel_acesso a SET subgrupo = 'financeiro'
 WHERE a.subgrupo = 'ge_financeiro'
   AND NOT EXISTS (SELECT 1 FROM public.rbac_papel_acesso b
                   WHERE b.papel_slug = a.papel_slug AND b.subgrupo = 'financeiro');
DELETE FROM public.rbac_papel_acesso WHERE subgrupo = 'ge_financeiro';
-- Reversível: não há volta útil (o slug 'ge_financeiro' era inválido); para reverter, re-inserir as linhas
-- afetadas com subgrupo='ge_financeiro' a partir do backup do dia.
