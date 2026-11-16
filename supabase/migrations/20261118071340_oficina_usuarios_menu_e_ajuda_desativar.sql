-- PDCA Oficina · /dashboard/oficina/usuarios · reauditoria aud8 16/11 (nota 90 → ≥95).
-- Code: code-desenvolvedor-3
--
-- Dois gaps provados no dado (RD-38):
--  1) FORA DO MENU: não havia linha em module_catalog para /dashboard/oficina/usuarios
--     (as demais rotas de oficina estão). A tela "Usuários da Oficina" (convite de mecânico +
--     lista de acesso) existe, é RBAC-guardada (fn_acessos_*) e tem página real, mas não era
--     descobrível pelo menu. Registramos no grupo 'oficina', subgrupo 'oficina_operacao'
--     (ao lado de Comissão Mecânico), após a última ordem existente.
--  2) RD-95: a ação de linha "Desativar" (desativar mecânico) não tinha "?". Acrescenta a chave
--     oficina.usuarios.desativar em erp_ajuda_campo.
--
-- Aditiva + idempotente: module_catalog é configuração GLOBAL (sem company_id, não é dado de
-- cliente); erp_ajuda_campo é catálogo de ajuda. Sem RLS/grants novos, sem cálculo, sem dado de
-- cliente. A visibilidade real da tela continua controlada pelo RBAC da própria página (useAcesso)
-- e pelas RPCs guardadas (fn_acessos_*): registrar no menu não afrouxa permissão.
--
-- PROVA RD-38 (antes do PR, BEGIN/ROLLBACK, statement_timeout curto):
--  • module_catalog rota '/dashboard/oficina/usuarios': 0 → 1 linha ativa; check-menu-rotas OK
--    (a rota tem page.tsx real).
--  • erp_ajuda_campo chave 'oficina.usuarios.desativar': 0 → 1.

-- 1) item de menu da tela de acesso da oficina
INSERT INTO public.module_catalog
  (id, nome, grupo, rota, ativo, icone, layer, ordem, subgrupo, is_shared, vertical_specific)
VALUES
  ('oficina_usuarios', 'Usuários da Oficina', 'oficina', '/dashboard/oficina/usuarios', true,
   '👥', '2_svc', 23, 'oficina_operacao', false, ARRAY['oficina']::text[])
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo,
  icone = EXCLUDED.icone, layer = EXCLUDED.layer, ordem = EXCLUDED.ordem,
  subgrupo = EXCLUDED.subgrupo, is_shared = EXCLUDED.is_shared,
  vertical_specific = EXCLUDED.vertical_specific;

-- 2) "?" da ação Desativar (RD-95)
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('oficina.usuarios.desativar', '/dashboard/oficina/usuarios', 'Usuários da Oficina', 'Desativar mecânico',
   'Clique em "Desativar" na linha de um mecânico para tirar o acesso dele ao sistema. Pede confirmação; só vale para mecânico, nunca para o Dono.',
   'Tira o acesso de quem saiu da equipe sem apagar nada: o histórico de serviços, apontamentos e comissões do mecânico continua no sistema. É reversível — o mesmo e-mail pode ser convidado de novo depois.',
   'Ex.: um mecânico foi desligado — Desativar bloqueia o login dele hoje, mas as ordens que ele fechou seguem no relatório.',
   'Tentar desativar o Dono: a tela não oferece isso de propósito. Para trocar o Dono, fale com o suporte.',
   'oficina', 12, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
