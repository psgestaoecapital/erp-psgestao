-- RD-98 p3 (origem do dado) — preenche system_screens.views_consumidas / rpcs_chamadas
-- de /dashboard/ehs/pausas-tecnicas (Pausas Técnicas · NR-36), que estava NULL
-- (não-verificada). Code: desenvolvedor_4_g.
--
-- MÉTODO (RD-38): grep de .from/.rpc nas páginas e confirmação em pg_class/pg_proc.
-- A tela consome:
--   - tabela: nr36_ciencia_mensal (leitura do documento de ciência por id);
--   - RPCs: fn_nr36_apurar, fn_nr36_pausas_pendentes_listar, fn_nr36_confirmar_fim_pausa,
--           fn_nr36_confirmar_fim_lote, fn_nr36_desfazer_amarracao_periodo.
-- As chamadas a supabase.storage.from('compliance-pausas') são bucket de STORAGE
-- (anexos de pausa), não tabela de dados — por isso não entram em views_consumidas.
-- Todos os 6 nomes confirmados no catálogo (pg_class / pg_proc) em 2026-11-20.
--
-- Aditiva/idempotente: só preenche onde está NULL (não sobrescreve classificação já feita).
-- Toca apenas metadados de catálogo global (system_screens); NÃO altera NR-36,
-- RLS/permissão nem dado de cliente.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['nr36_ciencia_mensal']::text[],
       rpcs_chamadas    = ARRAY[
         'fn_nr36_apurar',
         'fn_nr36_pausas_pendentes_listar',
         'fn_nr36_confirmar_fim_pausa',
         'fn_nr36_confirmar_fim_lote',
         'fn_nr36_desfazer_amarracao_periodo'
       ]::text[]
 WHERE rota = '/dashboard/ehs/pausas-tecnicas'
   AND views_consumidas IS NULL
   AND rpcs_chamadas IS NULL;
