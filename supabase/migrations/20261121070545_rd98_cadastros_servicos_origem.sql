-- RD-98 p3 (origem do dado): completa /dashboard/cadastros/servicos.
-- A tela seguia estado_real='desconhecida' e faltavam fontes realmente usadas no codigo
-- (pagina + componente ServicoForm + AjudaCampo). So metadado de registro da tela — NAO altera
-- comportamento, dado de cliente, RLS nem grants.
--
-- Fontes provadas no codigo (RD-38):
--   src/app/dashboard/cadastros/servicos/page.tsx: from erp_servicos ; rpc fn_erp_servico_excluir,
--     fn_erp_servico_reativar ; componente AjudaCampo (RD-95, 11 usos): fn_ajuda_campo_listar, fn_ajuda_campo_uso
--   src/components/cadastros/ServicoForm.tsx: from companies, erp_fiscal_provider_config, erp_servicos,
--     erp_servicos_produtos ; rpc fn_next_servico_codigo, fn_reforma_correlacao_servico, fn_reforma_parametro_ano
--   FALTAVAM no registro: view companies ; rpcs fn_erp_servico_excluir, fn_erp_servico_reativar,
--     fn_ajuda_campo_listar, fn_ajuda_campo_uso.
-- Objetos conferidos em pg_proc/pg_class.
--
-- Migration ADITIVA e IDEMPOTENTE via array_agg(DISTINCT ...): completa sem remover nada;
-- classifica estado_real='parcial' SO enquanto ainda 'desconhecida'. Reaplicar nao altera nada.
UPDATE public.system_screens s
   SET views_consumidas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.views_consumidas, ARRAY[]::text[]) || ARRAY['companies']) AS x
       ),
       rpcs_chamadas = (
         SELECT array_agg(DISTINCT x)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_erp_servico_excluir','fn_erp_servico_reativar','fn_ajuda_campo_listar','fn_ajuda_campo_uso']) AS x
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/cadastros/servicos'
   AND NOT (
         COALESCE(s.views_consumidas, ARRAY[]::text[]) @> ARRAY['companies']
         AND COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) @> ARRAY['fn_erp_servico_excluir','fn_erp_servico_reativar','fn_ajuda_campo_listar','fn_ajuda_campo_uso']
       );

UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/cadastros/servicos'
   AND estado_real = 'desconhecida';
