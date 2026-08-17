-- Fiscal · cadastra "NF-e Recebidas" no menu (a tela JÁ existe; faltava só o cadastro) · RD-41
--
-- AUDITADO (RD-38): a tela de entrada de notas JÁ existe e funciona em /dashboard/compras/documentos-recebidos
-- — lista via fn_nfe_recebidas_listar, filtra por status, tem "Buscar agora" (edge nfe-distribuicao = o ciclo
-- NSU da SEFAZ), habilitar/pausar distribuição, set_auto_ciencia, fn_nfe_recebida_lancar (gera pagar + entrada
-- de estoque) e o vínculo item→OS da Part 4 (fn_nfe_item_vincular_os). O ÚNICO gap era o cadastro no
-- module_catalog: a sidebar lê module_catalog (RD-35), então sem a linha a tela não aparece no menu.
--
-- Aqui: registra a entrada no grupo Notas Fiscais (ao lado de NFes/NFSes Emitidas) apontando pra a tela real,
-- e desativa o placeholder "previsto" da mesma feature (ge_prev_nfe_compra) pra não duplicar. [→GE] fiscal/estoque.
-- Reativar a distribuição (cron NSU) e avaliar auto_ciencia ficam como decisão de operação/contador — o botão
-- "Buscar agora" na tela já dispara a consulta manual assim que o menu ficar acessível.

INSERT INTO public.module_catalog (id, nome, rota, ativo, grupo, subgrupo, icone, ordem, legacy, is_shared, surface_in_groups, dependencies, diferencial)
VALUES ('fiscal_nfe_recebidas', 'NF-e Recebidas', '/dashboard/compras/documentos-recebidos', true,
        'gestao_empresarial', 'notas_fiscais', 'FileInput', 5, false, true,
        ARRAY['gestao_empresarial'], ARRAY[]::text[], false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true, grupo = EXCLUDED.grupo,
  subgrupo = EXCLUDED.subgrupo, icone = EXCLUDED.icone, ordem = EXCLUDED.ordem,
  is_shared = EXCLUDED.is_shared, surface_in_groups = EXCLUDED.surface_in_groups;

-- placeholder "previsto" da mesma feature → desativa pra não aparecer duplicado ao lado do real
UPDATE public.module_catalog SET ativo = false WHERE id = 'ge_prev_nfe_compra';
