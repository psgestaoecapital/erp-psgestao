-- ============================================================
-- RBAC industrial · Fase 0 (vocabulario) + Fase 1 (alcada)
-- SPEC "RBAC Industrial — completo, as 5 fases" (09/09, Eng. Chefe). Piloto: Frioeste 975365cc.
-- Generico da vertical Industria (RD-51) — Frioeste e so validadora empirica.
--
-- INERTE e narrowing-safe: amplia o CHECK (nao restringe), adiciona colunas e uma tabela de
-- vocabulario. As 31 linhas de user_scope (todas nivel='ver') NAO sao tocadas. Nenhum consumidor
-- de user_scope/fn_acesso_efetivo muda nesta fase (a Fase 3 e que reescreve a decisao).
--
-- NOTA (auditoria 09/09, RD-38): os 8 modulos de module_catalog ainda sem subgrupo sao de
-- PLATAFORMA (admin legado, dev, ancoras de dashboard #drill/#entrada/#fale/#negocios/#precos, bpo)
-- e NAO pertencem aos 6 subgrupos industriais/gestao criados aqui. A meta §19.2 (module_catalog sem
-- subgrupo = 0) depende de decisao a parte sobre esses 8 (subgrupo de plataforma ou isencao) — fora
-- do escopo desta migration.
-- ============================================================

-- 8.1 · o nivel que faltava (Fase 1 · alcada). CHECK amplia de 3 para 4 valores.
--       As 31 linhas atuais sao 'ver' -> passam pelo CHECK novo sem alteracao.
ALTER TABLE public.user_scope DROP CONSTRAINT IF EXISTS user_scope_nivel_check;
ALTER TABLE public.user_scope ADD CONSTRAINT user_scope_nivel_check
  CHECK (nivel = ANY (ARRAY['ver','filtrar','editar','aprovar']));

COMMENT ON COLUMN public.user_scope.nivel IS
  'ver = le · filtrar = le com recorte proprio · editar = escreve · '
  'aprovar = autoriza (alcada). Aprovar SEMPRE inclui editar.';

-- 8.2 · o teto da alcada, por VALOR (decisao do CEO 09/09)
ALTER TABLE public.user_scope
  ADD COLUMN IF NOT EXISTS alcada_teto numeric,
  ADD COLUMN IF NOT EXISTS pode_liberar_ate text;

COMMENT ON COLUMN public.user_scope.alcada_teto IS
  'Valor maximo que este usuario aprova nesta empresa/unidade/dominio. '
  'NULL com nivel=aprovar = SEM TETO (dono, diretor).';
COMMENT ON COLUMN public.user_scope.pode_liberar_ate IS
  'Camada maxima que este usuario pode conceder a outro. REGRA MAE (CEO 09/09): '
  'ninguem cria o proprio nivel nem acima.';

-- 8.3 · vocabulario oficial de subgrupos — FONTE UNICA da permissao (RD-52)
CREATE TABLE IF NOT EXISTS public.rbac_subgrupo_catalogo (
  slug       text PRIMARY KEY,
  grupo      text NOT NULL,
  nome       text NOT NULL,
  descricao  text,
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rbac_subgrupo_catalogo IS
  'Vocabulario oficial de subgrupos. FONTE UNICA da permissao (RD-52). '
  'user_scope.dominios[] e LEGADO e passa a ser derivado (RD-30, nao apagado).';

INSERT INTO public.rbac_subgrupo_catalogo (slug, grupo, nome, descricao) VALUES
 ('manutencao','industrial','Manutencao','Ordem de servico, parada de equipamento, preventiva'),
 ('qualidade_sif','industrial','Qualidade e SIF','Nao conformidade, condenacao, temperatura'),
 ('engenharia','industrial','Engenharia','Projeto, processo, melhoria'),
 ('expedicao','industrial','Expedicao','Carregamento, romaneio, conferencia'),
 ('portaria','industrial','Portaria','Entrada e saida de pessoa e veiculo'),
 ('compras','gestao_empresarial','Compras','Requisicao, cotacao, pedido')
ON CONFLICT (slug) DO NOTHING;
