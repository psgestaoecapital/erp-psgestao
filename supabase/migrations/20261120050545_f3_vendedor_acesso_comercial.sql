-- 20261119140145_f3_vendedor_acesso_comercial.sql
-- Emergência LGPD/acesso — msg eng_chefe 14fdc862 (complemento da c910e458), fatia F3 · DADOS.
--
-- Contexto: o papel "Vendedor" da indústria (rbac_papel.slug = 'industria_comercial',
-- nome "Vendedor Comercial") JÁ existe, mas NÃO tinha nenhuma linha em rbac_papel_acesso.
-- Sob a regra fail-closed da F1 (#5211, fn_modulos_sidebar_por_area): usuário com papel
-- ativo só enxerga as seções liberadas em rbac_papel_acesso (+ itens em rbac_papel_modulo)
-- + INÍCIO. Sem nenhuma linha, o Vendedor via SÓ o INÍCIO — a própria seção Comercial
-- ficava bloqueada.
--
-- Esta migration é ADITIVA e idempotente: libera ao Vendedor APENAS a seção COMERCIAL
-- (subgrupo 'comercial' do menu industrial = "Painel comercial (vendas)" + "App de vendas
-- (celular)"), mantendo Financeiro, RH, Administração e tudo o mais BLOQUEADOS. O INÍCIO é
-- liberado pela própria F1 (hardcoded), não precisa de linha.
--
-- RD-71 (uma fonte de verdade): a visibilidade do menu/rota por PAPEL é decidida só por
-- rbac_papel_acesso (por seção) + rbac_papel_modulo (por item). O nível (users.role →
-- permissoes_nivel) e o papel de gestão (tenant_user_roles) continuam valendo em paralelo
-- como hoje; este arquivo NÃO os altera.
--
-- Segurança: nada de DROP/UPDATE/DELETE; sem dado de cliente; não toca as 11 funções de
-- guarda (RD-91). Numerada acima do ledger (último na main: 20261119133045) e dentro da
-- janela não-futura do gate check:migrations (<= now+2d). Renumerada de 20261119150045
-- a pedido do revisor (AJUSTES #5329): só o nome muda, o conteúdo e o patch-id estável
-- permanecem idênticos.
--
-- Prova RD-38 (BEGIN/ROLLBACK, sem escrita persistida, Frioeste industrial, usuário real
-- simulado como papel industria_comercial):
--   A) papel ind_ana_rh (atual)        -> {INÍCIO, RECURSOS HUMANOS}
--   B) Vendedor SEM este grant         -> {INÍCIO}                  (fail-closed)
--   C) Vendedor COM este grant         -> {COMERCIAL, INÍCIO}       (só Comercial + Início)
-- Nenhuma seção de Financeiro/Administração/RH aparece para o Vendedor.

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel)
VALUES ('industria_comercial', 'comercial', 'editar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;
