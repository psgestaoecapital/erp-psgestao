-- RBAC industrial (RD-25) · SEÇÃO 1 (matriz dos 7 níveis novos, 238 linhas) + SEÇÃO 2 (gatear os 5
-- submódulos industriais nos 18 níveis existentes, 90 linhas). Aditivo (upsert). Financeiro = view-only p/ níveis
-- industriais (edição é do GE). Provado (menu antes/depois): zero regressão nos usuários-chave após 1+2.
WITH modulos(id) AS (VALUES
 ('admin_painel'),('anti_fraude'),('assessor'),('bpo'),('consultor_ia'),('contador'),
 ('convidar_usuarios'),('custos_detalhados'),('dados'),('dev'),('drilldown'),('entrada_dados'),
 ('fale_ps'),('ficha_tecnica'),('financeiro'),('importar'),('industrial'),('negocios'),
 ('noc'),('operacional'),('orcamento'),('painel_geral'),('precos'),('rateio'),('relatorio_ps'),
 ('resultado_dre'),('viabilidade'),('visao_diaria'),('wealth'),
 ('abastecimento_dados'),('industrial_folha_pagamento'),('inteligencia'),
 ('industrial_apontamento_mobile'),('industrial_ponto_eletronico')),
fin(id) AS (VALUES ('financeiro'),('resultado_dre'),('custos_detalhados'),('rateio'),('orcamento'),('precos')),
niveis(nivel, ve_ok) AS (VALUES
 ('diretor_area',     ARRAY['painel_geral','visao_diaria','dados','drilldown','negocios','industrial','abastecimento_dados','inteligencia','industrial_apontamento_mobile','industrial_ponto_eletronico','industrial_folha_pagamento','financeiro','resultado_dre','custos_detalhados','rateio','orcamento','precos','operacional','relatorio_ps']),
 ('gerente_planta',   ARRAY['painel_geral','visao_diaria','dados','drilldown','negocios','industrial','abastecimento_dados','inteligencia','industrial_apontamento_mobile','industrial_ponto_eletronico','custos_detalhados','precos','operacional']),
 ('gerente_processo', ARRAY['painel_geral','visao_diaria','industrial','abastecimento_dados','inteligencia','industrial_apontamento_mobile','industrial_ponto_eletronico','operacional']),
 ('supervisor_turno', ARRAY['painel_geral','visao_diaria','industrial','abastecimento_dados','industrial_apontamento_mobile','industrial_ponto_eletronico','operacional']),
 ('operador',         ARRAY['industrial_apontamento_mobile','industrial_ponto_eletronico']),
 ('rh_industrial',    ARRAY['painel_geral','dados','industrial_folha_pagamento','industrial_ponto_eletronico']),
 ('sst',              ARRAY['painel_geral']))
INSERT INTO permissoes_nivel (modulo_id, nivel, pode_ver, pode_editar, pode_excluir, pode_exportar)
SELECT m.id, n.nivel,
  (m.id = ANY(n.ve_ok)),
  (m.id = ANY(n.ve_ok) AND m.id NOT IN (SELECT id FROM fin)),
  (m.id = ANY(n.ve_ok) AND m.id NOT IN (SELECT id FROM fin) AND n.nivel='diretor_area'),
  (m.id = ANY(n.ve_ok) AND n.nivel IN ('diretor_area','gerente_planta','rh_industrial'))
FROM modulos m CROSS JOIN niveis n
ON CONFLICT (modulo_id, nivel) DO UPDATE
  SET pode_ver=EXCLUDED.pode_ver, pode_editar=EXCLUDED.pode_editar, pode_excluir=EXCLUDED.pode_excluir, pode_exportar=EXCLUDED.pode_exportar;

WITH sub(id) AS (VALUES ('abastecimento_dados'),('industrial_folha_pagamento'),('inteligencia'),('industrial_apontamento_mobile'),('industrial_ponto_eletronico')),
niv(nivel) AS (VALUES ('administrador'),('assessor_admin'),('assessor_usuario'),('cliente_bpo'),('cliente_wealth'),('comercial'),('conselheiro'),('consultor'),('contador_admin'),('contador_viewer'),('coordenador'),('diretor'),('financeiro'),('gerente'),('operacional'),('socio'),('supervisor'),('visualizador'))
INSERT INTO permissoes_nivel (modulo_id, nivel, pode_ver, pode_editar, pode_excluir, pode_exportar)
SELECT s.id, n.nivel,
  (n.nivel IN ('administrador','socio','diretor')),
  (n.nivel IN ('administrador','socio','diretor')),
  (n.nivel IN ('administrador','socio')),
  (n.nivel IN ('administrador','socio','diretor'))
FROM sub s CROSS JOIN niv n
ON CONFLICT (modulo_id, nivel) DO UPDATE
  SET pode_ver=EXCLUDED.pode_ver, pode_editar=EXCLUDED.pode_editar, pode_excluir=EXCLUDED.pode_excluir, pode_exportar=EXCLUDED.pode_exportar;
