-- RD-98 p3 · origem do dado (auditor): a Central de Conectores (/dashboard/conectores) estava com
--   views_consumidas = NULL e rpcs_chamadas = NULL em system_screens. Registra a origem do dado
--   (provada no código + banco).
--
-- Fontes reais da tela (prova no código, RD-38) -> src/app/dashboard/conectores/page.tsx:
--     * LEITURA: tabelas companies (empresa atual), erp_credencial (credenciais de integração
--                salvas) e omie_imports (status da última importação).
--     * AÇÃO:    RPCs fn_credencial_salvar, fn_credencial_inativar (gerir credenciais) e
--                fn_ponto_provider_conectar (conectar provedor de ponto).
--   (As chamadas a /api/* de sync/estado das integrações externas são AÇÕES sobre serviços de
--    terceiros, não leitura de dado próprio da tela — não entram em views_consumidas.)
--
-- As 3 tabelas e 3 RPCs foram conferidas existentes em produção (pg_tables / pg_proc).
--
-- Correção corretiva e idempotente: só metadado de registro da tela (origem do dado). NÃO toca RLS,
-- grants, dado de cliente, nem comportamento. UPDATE determinístico (guardado por origem vazia),
-- 2x = mesmo resultado.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['companies','erp_credencial','omie_imports']::text[],
       rpcs_chamadas    = ARRAY['fn_credencial_salvar','fn_credencial_inativar','fn_ponto_provider_conectar']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/conectores'
   AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
