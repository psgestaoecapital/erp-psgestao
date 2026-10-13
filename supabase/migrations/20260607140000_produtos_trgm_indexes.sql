-- =============================================================
-- FIX-PRODUTOS-BUSCA-SERVERSIDE-v1
-- =============================================================
-- Saneamento V1 Fase 1 · habilita busca server-side em erp_produtos
-- com ILIKE performante (gin trigram) pra escalar 10K+ produtos.
--
-- KGF: 1725 produtos ativos · OLEO codigo 576 (pos 1074) ficava
-- invisivel com teto de 500 linhas no front. Fix elimina o teto +
-- adiciona indices pra ILIKE nao fazer full scan na producao.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_erp_produtos_nome_trgm
  ON public.erp_produtos USING gin (nome gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_erp_produtos_codigo_trgm
  ON public.erp_produtos USING gin (codigo gin_trgm_ops);
