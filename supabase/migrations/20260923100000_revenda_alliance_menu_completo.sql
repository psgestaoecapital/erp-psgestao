-- Revenda na Alliance (print CEO 23/09) · Parte 1 — menu lateral completo.
-- O grupo revenda_veiculos só tinha 6 itens (Painel, Pátio, Ficha[legacy], Vendas, Preparação, O que comprar).
-- Faltavam 6 telas JÁ PRONTAS no app: Configuração da garagem, Completar dados, Precificação, Relatórios,
-- Garantia e Perfil fiscal. Aqui elas entram no module_catalog com o MESMO RBAC dos demais itens da revenda:
--   • grupo/subgrupo = 'revenda_veiculos', is_shared, ativo, legacy=false, rbac_isento=false;
--   • plan_modules ESPELHANDO os planos de revenda_patio (nenhum item revenda tem linha em permissoes_nivel,
--     então não há gate por nível a replicar — a visibilidade vem do plano da empresa, RD-51/RBAC).
-- Ordem das 11 entradas visíveis conforme o CEO. Idempotente (ON CONFLICT / WHERE NOT EXISTS).

-- ── 1) as 6 telas novas (upsert por id) ─────────────────────────────────────
INSERT INTO module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, legacy, surface_in_groups, rbac_isento, descricao)
VALUES
  ('revenda_completar',    'Revenda · Completar dados',        'revenda_veiculos', 'revenda_veiculos', 'ClipboardList', '/dashboard/revenda/completar',    188, true, true, false, '{}', false, 'Completar identificação/documentos/dados técnicos dos veículos em lista'),
  ('revenda_precificacao', 'Revenda · Precificação',           'revenda_veiculos', 'revenda_veiculos', 'Tag',           '/dashboard/revenda/precificacao', 189, true, true, false, '{}', false, 'Precificação dos veículos (piso/teto, margem, FIPE)'),
  ('revenda_garantia',     'Revenda · Garantia',               'revenda_veiculos', 'revenda_veiculos', 'ShieldCheck',   '/dashboard/revenda/garantia',     192, true, true, false, '{}', false, 'Garantia por venda (prazo/KM + termo), acionamento e sinistro por modelo'),
  ('revenda_relatorios',   'Revenda · Relatórios',             'revenda_veiculos', 'revenda_veiculos', 'BarChart3',     '/dashboard/revenda/relatorios',   194, true, true, false, '{}', false, 'Lucro real, comissão, sangria, curva de encalhe, ROI por modelo'),
  ('revenda_config',       'Revenda · Configuração da garagem','revenda_veiculos', 'revenda_veiculos', 'Settings',      '/dashboard/revenda/config',       195, true, true, false, '{}', false, 'Configuração da garagem (vagas, custo fixo, marca d''água, entrega, garantia)'),
  ('revenda_fiscal',       'Revenda · Perfil fiscal',          'revenda_veiculos', 'revenda_veiculos', 'Landmark',      '/dashboard/revenda/fiscal',       196, true, true, false, '{}', false, 'Perfil fiscal por empresa (operação, comissão, tributação, convite do contador)')
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo, icone = EXCLUDED.icone,
  rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true, is_shared = true, legacy = false,
  rbac_isento = EXCLUDED.rbac_isento, descricao = EXCLUDED.descricao;

-- ── 2) ordem das 11 entradas visíveis (CEO): Painel · Pátio · Completar · Precificação · Vendas ·
--        Preparação · Garantia · O que comprar · Relatórios · Configuração · Perfil fiscal ───────────
UPDATE module_catalog SET ordem = 186 WHERE id = 'revenda_painel';
UPDATE module_catalog SET ordem = 187 WHERE id = 'revenda_patio';
UPDATE module_catalog SET ordem = 190 WHERE id = 'revenda_vendas';
UPDATE module_catalog SET ordem = 191 WHERE id = 'revenda_preparacao';
UPDATE module_catalog SET ordem = 193 WHERE id = 'revenda_demanda';
-- a Ficha legacy sai da faixa visível (segue legacy=true, já filtrada pela RPC)
UPDATE module_catalog SET ordem = 197 WHERE id = 'revenda_veiculo';

-- ── 3) plan_modules: as 6 novas telas entram nos MESMOS planos de revenda_patio ─────────────────────
INSERT INTO plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT pm.plan_id, novo.module_id, true, 'basic', false
FROM plan_modules pm
CROSS JOIN (VALUES ('revenda_completar'),('revenda_precificacao'),('revenda_garantia'),
                   ('revenda_relatorios'),('revenda_config'),('revenda_fiscal')) AS novo(module_id)
WHERE pm.module_id = 'revenda_patio'
  AND NOT EXISTS (
    SELECT 1 FROM plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = novo.module_id
  );
