-- Área "Abastecimento de Dados" (hub de uploads) + Folha no menu.
-- Registra na área Industrial, seção ABASTECIMENTO (subgrupo). Aparece pra empresas
-- com o plano industrial (plan_modules). Padrão RPC fn_modulos_sidebar_por_area.
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, descricao)
VALUES
  ('abastecimento_dados', 'Abastecimento de Dados', 'industrial', 'abastecimento', '/dashboard/abastecimento', 'Upload', 10, true, false, 'Hub de uploads de planilha p/ sistemas sem API (folha, abate, legados).'),
  ('industrial_folha_pagamento', 'Folha de Pagamento', 'industrial', 'abastecimento', '/dashboard/industrial/folha', 'FileSpreadsheet', 11, true, false, 'Importa a folha (Dominio .xls) e apura custo por verba/competencia.')
ON CONFLICT (id) DO UPDATE
  SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
      rota = EXCLUDED.rota, icone = EXCLUDED.icone, ativo = true, legacy = false, descricao = EXCLUDED.descricao;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT 'v15_industrial_grande', m FROM (VALUES ('abastecimento_dados'), ('industrial_folha_pagamento')) AS x(m)
ON CONFLICT DO NOTHING;
