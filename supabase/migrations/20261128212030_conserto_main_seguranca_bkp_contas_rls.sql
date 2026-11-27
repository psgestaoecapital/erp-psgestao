-- 20261125094530 · gilberto-esteira · conserto-main (SEGURANÇA / @pos vermelho)
--
-- RD-38 (provado no dado 23/11, produção): o @pos-migration da main ficou VERMELHO no spec de segurança
-- e2e/jornadas/aceitacao/seguranca-search-path-prb.spec.ts:36 — fn_seguranca_rls_auditar() devolveu ok=false,
-- total_achados=3, TODOS na MESMA tabela: erp_banco_contas_bkp_pdca1123
--   • tabela_sem_rls_com_anon        → [erp_banco_contas_bkp_pdca1123]
--   • sem_rls_com_company_id         → [erp_banco_contas_bkp_pdca1123]
--   • anon_com_escrita_em_tabela_de_empresa → [erp_banco_contas_bkp_pdca1123]
--
-- CAUSA: a migration 20261125050135_demo_ge_limpar_contas_aceite_parcial.sql criou o backup com
--   CREATE TABLE ... AS SELECT (linhas 61-65), que NÃO liga RLS e herda os GRANTs padrão do schema public
--   (anon/authenticated ganham SELECT/INSERT/UPDATE/DELETE). Resultado: tabela com company_id, sem RLS e
--   com escrita por anon. A auditoria de segurança do briefing acusa — corretamente — os 3 achados.
--
-- CONTEÚDO: backup one-time de 1797 linhas da DEMO GE (b0700000-...-0004), contas de teste 'ACEITE PARCIAL %'
--   (RD-69: dado 100% FICTÍCIO da empresa demo). NÃO é tabela de cliente. service_role/postgres mantêm acesso
--   (o backup segue recuperável). Não movo dinheiro, não toco política de RLS de cliente, não decido dado real.
--
-- FIX (a regra da própria auditoria: "tabela nasce com RLS e sem GRANT ao anon"): liga RLS e revoga anon/
--   authenticated no backup órfão. Ligar RLS já zera os 3 achados (cada um exige NOT rls); o REVOKE reafirma
--   a doutrina e deixa a tabela fora da API. Idempotente e guardado por to_regclass (seguro reaplicar / em
--   ambiente de teste). Sem policy: service_role ignora RLS; nenhum papel de API lê um backup.
--
-- Observação ao Eng. Chefe: a CAUSA RAIZ é CREATE TABLE AS herdando GRANT a anon via default privileges do
--   public. Backups de limpeza (bkp_*) deveriam nascer com RLS + REVOKE anon/authenticated. Vale um padrão/
--   gate para backups futuros; aqui conserto só o órfão que trava a main.

DO $$
BEGIN
  IF to_regclass('public.erp_banco_contas_bkp_pdca1123') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.erp_banco_contas_bkp_pdca1123 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.erp_banco_contas_bkp_pdca1123 FROM anon, authenticated';
  END IF;
END $$;
