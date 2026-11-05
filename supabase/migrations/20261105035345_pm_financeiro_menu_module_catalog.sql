-- VERSIONAR aba Financeiro do P&M em module_catalog (reconciliar banco<->repo).
-- O eng-chefe inseriu, no banco, 12 itens de menu (subgrupo pm_financeiro, grupo pm, vertical {pm})
-- apontando para as telas financeiras do núcleo, para a agência (Pdois) ter o financeiro dentro do P&M.
-- Esta migration APENAS ESPELHA o que já está no banco, para que o schema não divirja do código e
-- uma migration futura NÃO apague esses itens. ADITIVA e IDEMPOTENTE: só INSERT ... ON CONFLICT DO UPDATE
-- em module_catalog. Não cria telas (as rotas já existem) nem mexe no restante do menu. RD-100 (sem nome
-- de terceiro — rotas são caminhos internos do próprio ERP).

INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao, vertical_specific)
VALUES
  ('pm_fin_fornecedores', 'Fornecedores',          'pm', 'pm_financeiro', NULL, 'Building2',       '/dashboard/cadastros/fornecedores',           102, true, false, 'Cadastro de fornecedores da agencia',       ARRAY['pm']),
  ('pm_fin_contas_banco', 'Contas Bancárias',      'pm', 'pm_financeiro', NULL, 'Landmark',        '/dashboard/cadastros/contas-bancarias',       104, true, false, 'Contas bancarias da empresa',               ARRAY['pm']),
  ('pm_fin_receber',      'A Receber',             'pm', 'pm_financeiro', NULL, 'ArrowDownCircle', '/dashboard/financeiro/receber',               106, true, false, 'Contas a receber',                          ARRAY['pm']),
  ('pm_fin_pagar',        'A Pagar',               'pm', 'pm_financeiro', NULL, 'ArrowUpCircle',   '/dashboard/financeiro/pagar',                 108, true, false, 'Contas a pagar',                            ARRAY['pm']),
  ('pm_fin_fluxo_caixa',  'Fluxo de Caixa',        'pm', 'pm_financeiro', NULL, 'TrendingUp',      '/dashboard/financeiro/fluxo-caixa',           112, true, false, 'Fluxo de caixa',                            ARRAY['pm']),
  ('pm_fin_conciliacao',  'Conciliação Bancária',  'pm', 'pm_financeiro', NULL, 'GitMerge',        '/dashboard/financeiro/conciliacao/inbox',     114, true, false, 'Conciliacao bancaria',                      ARRAY['pm']),
  ('pm_fin_inadimplentes','Inadimplentes',         'pm', 'pm_financeiro', NULL, 'AlertCircle',     '/dashboard/financeiro/inadimplentes',         116, true, false, 'Clientes inadimplentes',                    ARRAY['pm']),
  ('pm_fin_renegociacao', 'Renegociação',          'pm', 'pm_financeiro', NULL, 'RefreshCw',       '/dashboard/financeiro/renegociacao',          118, true, false, 'Renegociacao de contas',                    ARRAY['pm']),
  ('pm_fin_nfse',         'NFS-e Emitidas',        'pm', 'pm_financeiro', NULL, 'FileText',        '/dashboard/fiscal/nfse',                      120, true, false, 'Notas de servico emitidas',                 ARRAY['pm']),
  ('pm_fin_nfe_receb',    'NF-e Recebidas',        'pm', 'pm_financeiro', NULL, 'FileInput',       '/dashboard/fiscal/nfe-recebidas',             122, true, false, 'Notas recebidas de fornecedores',           ARRAY['pm']),
  ('pm_fin_nfe_emitir',   'Emitir NF-e',           'pm', 'pm_financeiro', NULL, 'FilePlus',        '/dashboard/fiscal/nfe/remessa',               124, true, false, 'Emitir NF-e avulsa',                        ARRAY['pm']),
  ('pm_fin_dre',          'DRE / Resultado',       'pm', 'pm_financeiro', NULL, 'BarChart3',       '/dashboard/financeiro/dre-consolidado',       126, true, false, 'Resultado da agencia',                      ARRAY['pm'])
ON CONFLICT (id) DO UPDATE SET
  nome              = EXCLUDED.nome,
  grupo             = EXCLUDED.grupo,
  subgrupo          = EXCLUDED.subgrupo,
  layer             = EXCLUDED.layer,
  icone             = EXCLUDED.icone,
  rota              = EXCLUDED.rota,
  ordem             = EXCLUDED.ordem,
  ativo             = true,
  is_shared         = EXCLUDED.is_shared,
  descricao         = EXCLUDED.descricao,
  vertical_specific = EXCLUDED.vertical_specific;
