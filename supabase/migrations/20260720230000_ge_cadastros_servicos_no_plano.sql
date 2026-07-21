-- MENU · devolver "Serviços" ao GestãoEmpresarial > Cadastros. Causa raiz (RD-38): o módulo
-- ge_cadastros_servicos existe (ativo, grupo=gestao_empresarial, subgrupo=cadastros, ordem 25) mas estava
-- em ZERO planos (qtd_planos=0), enquanto TODOS os irmãos (Clientes, Fornecedores, Contas, Plano de Contas…)
-- estão em v15_gestao_empresarial_pro. Por isso o filtro de plano da RPC fn_modulos_sidebar_por_area o
-- descartava — NÃO era "sidebar hardcoded" (o fallback sidebar-config.ts já tinha o item). Fix = adicionar ao
-- mesmo plano dos irmãos (aditivo) + badge PRONTO. Provado: agora surge na RPC (seção CADASTROS, ordem 25).
-- Reverter: DELETE do plan_modules + feature_catalog abaixo.

INSERT INTO plan_modules (plan_id, module_id)
SELECT 'v15_gestao_empresarial_pro', 'ge_cadastros_servicos'
WHERE NOT EXISTS (SELECT 1 FROM plan_modules WHERE plan_id='v15_gestao_empresarial_pro' AND module_id='ge_cadastros_servicos');

INSERT INTO feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
SELECT gen_random_uuid(), 'ge_cadastros_servicos', 'gestao_empresarial', 'Serviços',
       'Cadastro de serviços (código LC116, ISS, tributação) para NFS-e.', 'pronto', 100
WHERE NOT EXISTS (SELECT 1 FROM feature_catalog WHERE module_id='ge_cadastros_servicos');
UPDATE feature_catalog SET status='pronto', percentual_pronto=100, atualizado_em=now()
  WHERE module_id='ge_cadastros_servicos';
