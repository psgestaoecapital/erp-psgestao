-- RD-98 p3 (origem do dado): completa as sub-telas do Orçamento por EAP do Hub (telas 315/334):
--   /dashboard/projetos/obras/[id]/orcamento/importar   (importador xlsx, tela 334)
--   /dashboard/projetos/obras/[id]/orcamento/relatorios (relatórios do orçamento)
-- Ambas usam o componente AjudaCampo (RD-95; 8 e 5 usos), mas os RPCs de ajuda NÃO estavam
-- registrados em system_screens.rpcs_chamadas. Só metadado de registro — NÃO altera comportamento,
-- dado de cliente, RLS nem grants.
--
-- Fontes provadas no código (RD-38):
--   importar/page.tsx  : fn_projetos_orcamento_eap_importar, fn_projetos_orcamento_eap_importar_validar (já)
--   relatorios/page.tsx: fn_projetos_orcamento_eap_arvore, fn_projetos_orcamento_item_eap_listar (já)
--   AjudaCampo (src/components/ajuda/AjudaCampo.tsx): fn_ajuda_campo_listar, fn_ajuda_campo_uso (FALTAVAM nas duas)
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...). Reaplicar não altera nada.
-- Code: desenvolvedor_4_g

UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota IN (
         '/dashboard/projetos/obras/[id]/orcamento/importar',
         '/dashboard/projetos/obras/[id]/orcamento/relatorios'
       )
   AND NOT (COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']);
