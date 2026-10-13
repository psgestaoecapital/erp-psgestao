-- ============================================================
-- RBAC industrial · Fase 2 — catálogo de PAPÉIS + mapa papel→subgrupo→nível
-- SPEC "RBAC Industrial — as 5 fases" (Eng. Chefe). Piloto: Frioeste 975365cc. Genérico da vertical
-- Industria (RD-51). Risco baixo: tabelas novas + coluna aditiva + seed idempotente.
-- Decisão I1 (CEO): semear SÓ os 18 papéis que têm tela. Os 6 subgrupos novos (manutencao,
-- qualidade_sif, engenharia, expedicao, portaria, compras) estão VAZIOS — papel sem tela não protege
-- nada e poluiria a lista de escolha da Fase 5. Os outros 20 papéis ficam no SPEC e entram quando a
-- tela existir.
-- ============================================================

-- === TABELAS ===
CREATE TABLE IF NOT EXISTS public.rbac_papel (
  slug             text PRIMARY KEY,
  vertical         text NOT NULL,
  camada           text NOT NULL,
  area             text,
  nome             text NOT NULL,
  descricao        text,
  pode_liberar_ate text,
  exige_registro   boolean NOT NULL DEFAULT false,
  ativo            boolean NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rbac_papel_camada_chk CHECK (camada IN
    ('propriedade','direcao','gerencia','supervisao','especialista','operacao'))
);

CREATE TABLE IF NOT EXISTS public.rbac_papel_acesso (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  papel_slug text NOT NULL REFERENCES public.rbac_papel(slug) ON DELETE CASCADE,
  subgrupo   text NOT NULL,
  nivel      text NOT NULL,
  CONSTRAINT rbac_papel_acesso_nivel_chk CHECK (nivel IN ('ver','filtrar','editar','aprovar')),
  CONSTRAINT rbac_papel_acesso_unq UNIQUE (papel_slug, subgrupo)
);

ALTER TABLE public.user_scope
  ADD COLUMN IF NOT EXISTS papel_slug text REFERENCES public.rbac_papel(slug);

COMMENT ON COLUMN public.user_scope.papel_rotulo IS
  'LEGADO — texto livre. Substituido por papel_slug.';
COMMENT ON COLUMN public.rbac_papel.exige_registro IS
  'true = exige registro profissional (CREA/CRM/CRO). O sistema nao concede o que a
   lei nao concede.';

-- === OS 18 PAPÉIS (só os com tela) ===
-- Subgrupos que TÊM tela: operacao(2) · inteligencia_bi(2) · rh_ponto(2) · abastecimento(1) ·
-- produtividade(1) · docs_regulatorios(14) · controle_epis(6) · compliance_legal(2)
INSERT INTO rbac_papel (slug, vertical, camada, area, nome, pode_liberar_ate, exige_registro) VALUES
 ('ind_dono','industria','propriedade',NULL,'Dono','qualquer',false),
 ('ind_ceo','industria','propriedade',NULL,'CEO','qualquer',false),
 ('ind_dir_producao','industria','direcao','producao','Diretor de Producao','gerencia',false),
 ('ind_dir_rh','industria','direcao','rh','Diretor de RH','gerencia',false),
 ('ind_dir_compliance','industria','direcao','compliance','Diretor de Compliance','gerencia',false),
 ('ind_ger_unidade','industria','gerencia',NULL,'Gerente de Unidade','supervisao',false),
 ('ind_ger_producao','industria','gerencia','producao','Gerente de Producao','supervisao',false),
 ('ind_ger_rh','industria','gerencia','rh','Gerente de RH','supervisao',false),
 ('ind_ger_administrativo','industria','gerencia','administrativo','Gerente Administrativo','supervisao',false),
 ('ind_ger_compliance','industria','gerencia','compliance','Gerente de Compliance','supervisao',false),
 ('ind_sup_abate','industria','supervisao','producao','Supervisor de Abate','operacao',false),
 ('ind_sup_desossa','industria','supervisao','producao','Supervisor de Desossa','operacao',false),
 ('ind_sup_quarteio','industria','supervisao','producao','Supervisor de Quarteio','operacao',false),
 ('ind_sup_congelamento','industria','supervisao','producao','Supervisor de Congelamento','operacao',false),
 ('ind_ana_rh','industria','especialista','rh','Analista de RH',NULL,false),
 ('ind_sst_tecnico','industria','especialista','compliance','Tecnico de Seguranca do Trabalho',NULL,false),
 ('ind_sst_responsavel_tecnico','industria','especialista','compliance','Responsavel Tecnico de SST',NULL,true),
 ('ind_operador_producao','industria','operacao','producao','Operador de Producao',NULL,false)
ON CONFLICT (slug) DO NOTHING;

-- === O MAPA papel → subgrupo → nível ===
INSERT INTO rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
-- propriedade: tudo, aprovar
 ('ind_dono','operacao','aprovar'),('ind_dono','produtividade','aprovar'),
 ('ind_dono','abastecimento','aprovar'),('ind_dono','inteligencia_bi','aprovar'),
 ('ind_dono','rh_ponto','aprovar'),('ind_dono','docs_regulatorios','aprovar'),
 ('ind_dono','controle_epis','aprovar'),('ind_dono','compliance_legal','aprovar'),
 ('ind_ceo','operacao','aprovar'),('ind_ceo','produtividade','aprovar'),
 ('ind_ceo','abastecimento','aprovar'),('ind_ceo','inteligencia_bi','aprovar'),
 ('ind_ceo','rh_ponto','aprovar'),('ind_ceo','docs_regulatorios','aprovar'),
 ('ind_ceo','controle_epis','aprovar'),('ind_ceo','compliance_legal','aprovar'),
-- direcao producao
 ('ind_dir_producao','operacao','aprovar'),('ind_dir_producao','produtividade','aprovar'),
 ('ind_dir_producao','abastecimento','aprovar'),('ind_dir_producao','inteligencia_bi','ver'),
 ('ind_dir_producao','rh_ponto','filtrar'),('ind_dir_producao','controle_epis','ver'),
-- direcao rh
 ('ind_dir_rh','rh_ponto','aprovar'),('ind_dir_rh','docs_regulatorios','aprovar'),
 ('ind_dir_rh','controle_epis','ver'),('ind_dir_rh','inteligencia_bi','ver'),
-- direcao compliance
 ('ind_dir_compliance','docs_regulatorios','aprovar'),('ind_dir_compliance','controle_epis','aprovar'),
 ('ind_dir_compliance','compliance_legal','aprovar'),('ind_dir_compliance','rh_ponto','ver'),
-- gerente de unidade
 ('ind_ger_unidade','operacao','editar'),('ind_ger_unidade','produtividade','editar'),
 ('ind_ger_unidade','abastecimento','editar'),('ind_ger_unidade','inteligencia_bi','ver'),
 ('ind_ger_unidade','rh_ponto','filtrar'),('ind_ger_unidade','docs_regulatorios','ver'),
 ('ind_ger_unidade','controle_epis','ver'),
-- gerente de producao  ← o Cleverton
 ('ind_ger_producao','operacao','aprovar'),('ind_ger_producao','produtividade','aprovar'),
 ('ind_ger_producao','abastecimento','editar'),('ind_ger_producao','inteligencia_bi','ver'),
 ('ind_ger_producao','rh_ponto','filtrar'),('ind_ger_producao','controle_epis','ver'),
 ('ind_ger_producao','docs_regulatorios','ver'),
-- gerente rh
 ('ind_ger_rh','rh_ponto','aprovar'),('ind_ger_rh','docs_regulatorios','editar'),
 ('ind_ger_rh','controle_epis','ver'),
-- gerente administrativo  ← a Fabiane
 ('ind_ger_administrativo','rh_ponto','filtrar'),('ind_ger_administrativo','docs_regulatorios','editar'),
 ('ind_ger_administrativo','controle_epis','ver'),('ind_ger_administrativo','inteligencia_bi','ver'),
-- gerente compliance
 ('ind_ger_compliance','docs_regulatorios','aprovar'),('ind_ger_compliance','controle_epis','aprovar'),
 ('ind_ger_compliance','compliance_legal','editar'),
-- supervisores de setor (os 4, mesmo pacote)
 ('ind_sup_abate','operacao','editar'),('ind_sup_abate','produtividade','filtrar'),
 ('ind_sup_abate','rh_ponto','filtrar'),('ind_sup_abate','controle_epis','ver'),
 ('ind_sup_desossa','operacao','editar'),('ind_sup_desossa','produtividade','filtrar'),
 ('ind_sup_desossa','rh_ponto','filtrar'),('ind_sup_desossa','controle_epis','ver'),
 ('ind_sup_quarteio','operacao','editar'),('ind_sup_quarteio','produtividade','filtrar'),
 ('ind_sup_quarteio','rh_ponto','filtrar'),('ind_sup_quarteio','controle_epis','ver'),
 ('ind_sup_congelamento','operacao','editar'),('ind_sup_congelamento','produtividade','filtrar'),
 ('ind_sup_congelamento','rh_ponto','filtrar'),('ind_sup_congelamento','controle_epis','ver'),
-- analista rh  ← Adriane e Gizeli
 ('ind_ana_rh','rh_ponto','editar'),('ind_ana_rh','docs_regulatorios','editar'),
-- tecnico SST  ← Karoline · executa e registra, NAO assina
 ('ind_sst_tecnico','docs_regulatorios','editar'),('ind_sst_tecnico','controle_epis','editar'),
 ('ind_sst_tecnico','compliance_legal','ver'),
-- responsavel tecnico SST  ← o unico que aprova, exige CREA
 ('ind_sst_responsavel_tecnico','docs_regulatorios','aprovar'),
 ('ind_sst_responsavel_tecnico','controle_epis','ver'),
 ('ind_sst_responsavel_tecnico','compliance_legal','aprovar'),
-- operacao
 ('ind_operador_producao','operacao','editar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

-- 🔴 VERIFICAÇÃO OBRIGATÓRIA (a linha do dinheiro) — vira TRAVA de deploy: nenhum papel de
-- gerencia/supervisao/operacao pode alcançar financeiro/vendas/notas. Se violar, a migration ABORTA.
DO $chk$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v
    FROM rbac_papel p JOIN rbac_papel_acesso a ON a.papel_slug = p.slug
   WHERE a.subgrupo IN ('financeiro','contratos_vendas','vendas','notas_fiscais')
     AND p.camada IN ('gerencia','supervisao','operacao');
  IF v > 0 THEN
    RAISE EXCEPTION 'RBAC linha do dinheiro VIOLADA: % papel(is) de gerencia/supervisao/operacao com subgrupo financeiro/vendas/notas', v;
  END IF;
END $chk$;

-- ============================================================
-- Correções de scope da Frioeste (auditoria) + migração dos 5 para papel_slug (I2 · continuam em 'ver').
-- Fonte da permissão passa a ser o papel (module_catalog.subgrupo via rbac_papel_acesso); dominios[] é
-- LEGADO (RD-52) e deixa de ser consultado na Fase 3 — por isso não é tocado aqui.
-- ============================================================
-- Fabiane: papel_rotulo dizia "Socio" (errado). É Gerente Administrativo.
UPDATE public.user_scope us SET papel_slug = 'ind_ger_administrativo', papel_rotulo = 'Gerente Administrativo'
  FROM users u WHERE u.id = us.user_id AND us.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
   AND u.email = 'supervisoradm@frioeste.com.br';
-- Cleverton: Gerente de Produção (o pacote do papel define o que ele vê; NÃO alcança financeiro).
UPDATE public.user_scope us SET papel_slug = 'ind_ger_producao'
  FROM users u WHERE u.id = us.user_id AND us.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
   AND u.email = 'gerencia@frioeste.com.br';
-- RH (Adriane e Gizeli): Analista de RH.
UPDATE public.user_scope us SET papel_slug = 'ind_ana_rh'
  FROM users u WHERE u.id = us.user_id AND us.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
   AND u.email IN ('rh@frioeste.com.br','rh2@frioeste.com.br');
-- Karoline: Técnico de Segurança do Trabalho (executa e registra, não assina).
UPDATE public.user_scope us SET papel_slug = 'ind_sst_tecnico'
  FROM users u WHERE u.id = us.user_id AND us.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
   AND u.email = 'segurancadotrabalho@frioeste.com.br';
-- Pessoa da PS não recebe papel de cliente na Frioeste — o acesso vem do PS_ADMIN_CVM. Remover a linha.
DELETE FROM public.user_scope WHERE id = '23cf1a9c-96b5-4e70-b259-eecd1810cb43';
