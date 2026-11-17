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
-- controle_epis 7/7, docs_regulatorios 16/16). O único bloqueio era o papel.
--
-- SINTOMA (fn_menu_vazio_auditar, antes): FC PISOS área 'hub' itens=0/1 e área 'compliance' itens=0 para
-- TODOS os 8 usuários (todos enxergam as duas áreas via fn_listar_areas_visiveis). "< 3 itens = achado."
-- PROVA (BEGIN..ROLLBACK, antes do PR): aplicando exatamente o grant abaixo e re-rodando a gate, os achados
-- da FC Pisos (hub e compliance) SOMEM da lista; sobra só FRIOESTE/gestao_empresarial (total_achados=1), que
-- é outro caso e NÃO é tocado aqui.
--
-- ESCOPO (RD-25): mapeamento por FUNÇÃO do papel (remapeia hub_* morto -> projetos_* por papel; Compliance
-- sempre em leitura 'ver'). projetos_configuracao só no sócio. hub_compras, além do Hub, recebe os núcleos de
-- compra (compras/cadastros/estoque) que a função exige. NÃO concede 'administracao' (Cofre/Credenciais).
-- Aditivo e idempotente: ON CONFLICT (papel_slug, subgrupo) DO NOTHING (constraint rbac_papel_acesso_unq).
-- Blast radius contido: os papéis hub_* são exclusivos da FC Pisos.

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
  -- Sócio: aprova o Hub inteiro (inclui configuração); lê o Compliance.
  ('hub_socio','projetos_raiz','aprovar'),
  ('hub_socio','projetos_obras','aprovar'),
  ('hub_socio','projetos_comercial','aprovar'),
  ('hub_socio','projetos_engenharia','aprovar'),
  ('hub_socio','projetos_configuracao','aprovar'),
  ('hub_socio','compliance_legal','ver'),
  ('hub_socio','controle_epis','ver'),
  ('hub_socio','docs_regulatorios','ver'),
  -- Gerente de obras: opera o Hub ponta a ponta (sem configuração); lê o Compliance.
  ('hub_gerente_obras','projetos_raiz','aprovar'),
  ('hub_gerente_obras','projetos_obras','aprovar'),
  ('hub_gerente_obras','projetos_comercial','aprovar'),
  ('hub_gerente_obras','projetos_engenharia','aprovar'),
  ('hub_gerente_obras','compliance_legal','ver'),
  ('hub_gerente_obras','controle_epis','ver'),
  ('hub_gerente_obras','docs_regulatorios','ver'),
  -- Engenheiro: edita obra/engenharia/comercial; lê EPIs e documentos regulatórios.
  ('hub_engenheiro','projetos_raiz','editar'),
  ('hub_engenheiro','projetos_obras','editar'),
  ('hub_engenheiro','projetos_engenharia','editar'),
  ('hub_engenheiro','projetos_comercial','editar'),
  ('hub_engenheiro','controle_epis','ver'),
  ('hub_engenheiro','docs_regulatorios','ver'),
  -- Financeiro: visão (ver) do Hub; lê Compliance legal e documentos (já tem 'financeiro' do #5363).
  ('hub_financeiro','projetos_raiz','ver'),
  ('hub_financeiro','projetos_obras','ver'),
  ('hub_financeiro','projetos_comercial','ver'),
  ('hub_financeiro','compliance_legal','ver'),
  ('hub_financeiro','docs_regulatorios','ver'),
  -- Compras: edita a parte comercial do Hub + os núcleos de compra (compras/cadastros/estoque); lê EPIs e docs.
  ('hub_compras','projetos_raiz','editar'),
  ('hub_compras','projetos_obras','editar'),
  ('hub_compras','projetos_comercial','editar'),
  ('hub_compras','compras','editar'),
  ('hub_compras','cadastros','editar'),
  ('hub_compras','estoque','editar'),
  ('hub_compras','controle_epis','ver'),
  ('hub_compras','docs_regulatorios','ver')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;
