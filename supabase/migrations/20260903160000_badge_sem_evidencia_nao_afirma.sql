-- Badge do menu: não afirmar "Previsto" sem evidência (RD-58 em escala).
--
-- Achado: 91 de 270 módulos ativos têm ZERO features em feature_catalog e por isso mostravam
-- "Previsto" no menu — mesmo funcionando (63 dos 91 têm page.tsx construída). O badge não
-- distinguia "não catalogado" de "não existe": afirmava um estado que o dado não sustenta.
--
-- Regra (aprovada pelo CEO, registrada como convenção abaixo):
--   feature cadastrada e pronta   → "Pronto"
--   feature cadastrada, não pronta → "Previsto"/"Parcial"
--   ZERO features                 → SEM badge (NULL), nunca "Previsto"
--
-- A mudança é no fn_modulos_sidebar_por_area, onde a regra do badge aparece repetida 6× (status,
-- badge_label, badge_color × 2 ramos UNION). Em vez de recolar a função inteira e arriscar
-- divergência entre as cópias, transformamos o corpo vigente de forma cirúrgica e idempotente:
-- só o ramo count(*)=0 muda de 'previsto' para NULL, e o COALESCE deixa de reinjetar 'previsto'.
-- (Rodar de novo é no-op: o padrão antigo já não existe.) O front já trata badge ausente —
-- SidebarSubItem faz {item.badge && ...} e statusFromRpc mapeia 'previsto'→'pronto', então
-- nenhum item fica com buraco ou some do menu.
DO $patch$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_modulos_sidebar_por_area'::regproc);
  v_def := replace(v_def, 'WHEN count(*)=0 THEN ''previsto''', 'WHEN count(*)=0 THEN NULL');
  v_def := replace(v_def, 'fc.module_id = mc.id), ''previsto'')', 'fc.module_id = mc.id), NULL)');
  EXECUTE v_def;
END $patch$;

-- Convenção (mesma família de catalogo[0], COALESCE(entra_estoque,false), selo NFS-e): o sistema
-- não afirma o que não sabe. Ausência de dado é ausência de badge, não uma afirmação falsa.
INSERT INTO public.erp_contexto_projeto (projeto, categoria, status, prioridade, titulo, descricao, tags)
SELECT 'erp_psgestao', 'convencao', 'ativo', 'alta',
  'Badge/estado não afirma o que não sabe (ausência de dado ≠ afirmação)',
  'Menu e estados derivados: quando não há evidência (ex.: módulo sem feature em feature_catalog), '
  || 'NÃO exibir "Previsto"/estado inventado — exibir SEM badge/estado. "Previsto" só com feature '
  || 'cadastrada e não pronta; "Pronto" só com todas prontas. Mesma família de: catalogo[0] (assumir '
  || 'o primeiro), COALESCE(entra_estoque,false) (assumir falso), selo de adesão NFS-e (afirmar sem '
  || 'confirmar). Regra: ausência de dado = ausência de afirmação. Não catalogar em massa para "consertar" '
  || 'o badge — é feature a feature, com evidência.',
  ARRAY['badge','menu','rd-58','veracidade','feature_catalog']::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_contexto_projeto
  WHERE categoria='convencao' AND titulo='Badge/estado não afirma o que não sabe (ausência de dado ≠ afirmação)'
);
