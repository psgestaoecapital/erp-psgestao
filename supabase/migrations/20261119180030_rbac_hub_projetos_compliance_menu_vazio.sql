-- RBAC — destrava o menu vazio da FC PISOS no Hub de Projetos e no Compliance (gate fn_menu_vazio_auditar).
-- Família do #5363 (que já corrigiu o slug financeiro ge_financeiro->financeiro). Aqui fechamos os outros
-- dois buracos do mesmo caso: Hub e Compliance.
--
-- CAUSA (provada no dado, RD-38): os 5 papéis do Hub (hub_socio, hub_gerente_obras, hub_engenheiro,
-- hub_financeiro, hub_compras) só liberam subgrupos hub_* MORTOS — o Hub foi renomeado para projetos_*
-- (projetos_raiz/obras/comercial/engenharia/configuracao) e o Compliance (compliance_legal/controle_epis/
-- docs_regulatorios) nunca foi liberado a esses papéis. O menu sai de rbac_papel_acesso ∩ módulo pago
-- (fn_modulos_sidebar_por_area: GATE RBAC PAPEL + tenant_subscriptions). Camada de assinatura NÃO é o gap:
-- a FC Pisos JÁ paga TODOS os módulos desses subgrupos (projetos_* 24/24, compliance_legal 2/2,
-- controle_epis 7/7, docs_regulatorios 16/16). O único bloqueio é o papel.
--
-- SINTOMA (fn_menu_vazio_auditar, antes): FC PISOS área 'hub' itens=0/1 e área 'compliance' itens=0 para
-- TODOS os 8 usuários (todos enxergam as duas áreas via fn_listar_areas_visiveis). "< 3 itens = achado."
-- PROVA (BEGIN..ROLLBACK, antes do PR): aplicando exatamente o grant abaixo, a gate zera os achados da FC
-- Pisos (hub e compliance saem da lista); sobra só FRIOESTE/gestao_empresarial, que é outro caso (não tocado).
--
-- ESCOPO (RD-25, sem over-grant): cada papel recebe só as seções que PRECISA para as áreas que já enxerga —
-- os 4 projetos_* operacionais (raiz/obras/comercial/engenharia) + os 3 de compliance; projetos_configuracao
-- fica só no sócio. Níveis espelham a autoridade do papel (o GATE de menu só checa presença; o nível é rótulo
-- de visibilidade de seção). compras/cadastros/estoque NÃO entram: não há achado dessas áreas para a FC Pisos.
-- Aditivo e idempotente: ON CONFLICT (papel_slug, subgrupo) DO NOTHING (constraint rbac_papel_acesso_unq).

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
  -- Sócio: vê e aprova tudo do Hub + Compliance (inclui configuração).
  ('hub_socio','projetos_raiz','aprovar'),
  ('hub_socio','projetos_obras','aprovar'),
  ('hub_socio','projetos_comercial','aprovar'),
  ('hub_socio','projetos_engenharia','aprovar'),
  ('hub_socio','projetos_configuracao','aprovar'),
  ('hub_socio','compliance_legal','aprovar'),
  ('hub_socio','controle_epis','aprovar'),
  ('hub_socio','docs_regulatorios','aprovar'),
  -- Gerente de obras: opera o Hub ponta a ponta + Compliance (sem configuração).
  ('hub_gerente_obras','projetos_raiz','aprovar'),
  ('hub_gerente_obras','projetos_obras','aprovar'),
  ('hub_gerente_obras','projetos_comercial','aprovar'),
  ('hub_gerente_obras','projetos_engenharia','aprovar'),
  ('hub_gerente_obras','compliance_legal','aprovar'),
  ('hub_gerente_obras','controle_epis','aprovar'),
  ('hub_gerente_obras','docs_regulatorios','aprovar'),
  -- Engenheiro: edita obra/engenharia/orçamento + Compliance.
  ('hub_engenheiro','projetos_raiz','editar'),
  ('hub_engenheiro','projetos_obras','editar'),
  ('hub_engenheiro','projetos_comercial','editar'),
  ('hub_engenheiro','projetos_engenharia','editar'),
  ('hub_engenheiro','compliance_legal','editar'),
  ('hub_engenheiro','controle_epis','editar'),
  ('hub_engenheiro','docs_regulatorios','editar'),
  -- Financeiro: visão (ver) do Hub + Compliance (já tem 'financeiro' do #5363).
  ('hub_financeiro','projetos_raiz','ver'),
  ('hub_financeiro','projetos_obras','ver'),
  ('hub_financeiro','projetos_comercial','ver'),
  ('hub_financeiro','projetos_engenharia','ver'),
  ('hub_financeiro','compliance_legal','ver'),
  ('hub_financeiro','controle_epis','ver'),
  ('hub_financeiro','docs_regulatorios','ver'),
  -- Compras: visão (ver) do Hub + Compliance.
  ('hub_compras','projetos_raiz','ver'),
  ('hub_compras','projetos_obras','ver'),
  ('hub_compras','projetos_comercial','ver'),
  ('hub_compras','projetos_engenharia','ver'),
  ('hub_compras','compliance_legal','ver'),
  ('hub_compras','controle_epis','ver'),
  ('hub_compras','docs_regulatorios','ver')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;
