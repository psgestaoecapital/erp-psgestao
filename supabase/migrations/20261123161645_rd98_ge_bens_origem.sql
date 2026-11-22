-- RD-98 p3 (origem do dado): completa as fontes de /dashboard/gestao-empresarial/bens.
-- A tela ja tinha views/rpcs registrados, mas seguia estado_real='desconhecida' e faltavam
-- 3 rpcs realmente chamados no codigo. So metadado de registro da tela — NAO altera
-- comportamento, dado de cliente, RLS nem grants.
--
-- Fontes provadas no codigo (RD-38), src/app/dashboard/gestao-empresarial/bens/page.tsx:
--   views (from): business_lines (L90), erp_bem (L128/129), erp_bem_natureza_padrao (L91)
--   rpcs        : fn_bem_listar (L89), fn_bem_indicadores (L92), fn_bem_excluir (L148),
--                 fn_bem_baixar (L165), fn_bem_calcular_depreciacao (L179)
--   componente AjudaCampo (RD-95, varios usos L313+): fn_ajuda_campo_listar, fn_ajuda_campo_uso
-- FALTAVAM no registro: fn_bem_excluir, fn_ajuda_campo_listar, fn_ajuda_campo_uso.
-- Objetos de rpc conferidos em pg_proc.
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): completa sem remover nada ja
-- presente; classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao altera nada.
UPDATE public.system_screens s
   SET rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_bem_excluir','fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/gestao-empresarial/bens'
   AND NOT (
         COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_bem_excluir','fn_ajuda_campo_listar','fn_ajuda_campo_uso']
       );

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/gestao-empresarial/bens'
   AND estado_real = 'desconhecida';
