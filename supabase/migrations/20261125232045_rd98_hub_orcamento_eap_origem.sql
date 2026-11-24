-- RD-98 p3 (origem do dado): completa /dashboard/projetos/obras/[id]/orcamento (Hub · tela 315, Orçamento por EAP).
-- A tela usa o componente AjudaCampo (RD-95, 17 usos), mas os RPCs de ajuda NÃO estavam registrados em
-- system_screens.rpcs_chamadas. Só metadado de registro da tela — NÃO altera comportamento, dado de cliente,
-- RLS nem grants.
--
-- Fontes provadas no código (RD-38), src/app/dashboard/projetos/obras/[id]/orcamento/page.tsx:
--   rpcs já registrados: fn_projetos_orcamento_eap_arvore, fn_projetos_orcamento_item_eap_listar/salvar/excluir,
--                        fn_projetos_orcamento_garantir
--   componente AjudaCampo (src/components/ajuda/AjudaCampo.tsx): fn_ajuda_campo_listar, fn_ajuda_campo_uso (FALTAVAM)
-- Objetos de RPC conferidos (as funções de ajuda são usadas por todas as telas RD-95).
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): completa sem remover nada. Reaplicar não altera nada.
-- Code: desenvolvedor_4_g

UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/projetos/obras/[id]/orcamento'
   AND NOT (COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']);
