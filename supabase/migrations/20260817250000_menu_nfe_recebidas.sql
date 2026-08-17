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
VALUES ('fiscal_nfe_recebidas', 'NF-e Recebidas', '/dashboard/fiscal/nfe-recebidas', true,
        'gestao_empresarial', 'notas_fiscais', 'FileInput', 5, false, true,
        ARRAY['gestao_empresarial'], ARRAY[]::text[], false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true, grupo = EXCLUDED.grupo,
  subgrupo = EXCLUDED.subgrupo, icone = EXCLUDED.icone, ordem = EXCLUDED.ordem,
  is_shared = EXCLUDED.is_shared, surface_in_groups = EXCLUDED.surface_in_groups;

-- placeholder "previsto" da mesma feature → desativa pra não aparecer duplicado ao lado do real
UPDATE public.module_catalog SET ativo = false WHERE id = 'ge_prev_nfe_compra';

-- Registro de monitoramento (system_screens) — documentacao da tela (nao gate do menu, mas o SPEC pede)
INSERT INTO public.system_screens (id, rota, area, titulo, modulo, estado_real, descricao_funcional, rpcs_chamadas)
VALUES ('fiscal_nfe_recebidas', '/dashboard/fiscal/nfe-recebidas', 'fiscal', 'NF-e Recebidas', 'fiscal', 'pronto',
        'Entrada de NF-e recebidas: lista/filtra, busca SEFAZ (NSU), aplica XML, gera pagar, da entrada no estoque e vincula item->OS.',
        ARRAY['fn_nfe_recebidas_listar','fn_nfe_recebida_lancar','fn_nfe_recebida_dar_entrada_estoque','fn_nfe_recebida_gerar_pagar','fn_nfe_item_vincular','fn_nfe_item_vincular_os','fn_nfe_distribuicao_habilitar','fn_nfe_distribuicao_set_auto_ciencia'])
ON CONFLICT (id) DO UPDATE SET rota = EXCLUDED.rota, area = EXCLUDED.area, titulo = EXCLUDED.titulo,
  modulo = EXCLUDED.modulo, estado_real = EXCLUDED.estado_real, descricao_funcional = EXCLUDED.descricao_funcional,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas;
