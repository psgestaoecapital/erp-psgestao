-- ============================================================
-- Oficina · Wave B.3 (frontend) · registra a tela "Usuarios da Oficina" em system_screens
-- Para nao virar tela ORFA no auditor de drift (fn_detectar_drift) — mesma convencao de
-- /dashboard/admin/acessos e /dashboard/commerce/compras (atalhos por papel tambem registrados).
--
-- A tela e um ATALHO por papel no sidebar (OFICINA_DONO), nao um module_catalog. auditavel_robo=false
-- com motivo: o screen-watcher nao tem o papel OFICINA_DONO (papel por empresa), entao nao alcanca.
-- ============================================================

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, rpcs_chamadas, estado_real, prioridade_monitoramento, auditavel_robo, motivo_nao_auditavel, observacoes)
VALUES (
  'oficina_usuarios', '/dashboard/oficina/usuarios', 'oficina', 'Usuários da Oficina',
  'B.3: o OFICINA_DONO convida e desativa MECANICO. Lista via fn_acessos_empresa_contexto; convida com papel FIXO OFICINA_MECANICO (o form nao oferece outro papel); desativa via fn_acessos_remover_pessoa (inativar). Atalho por papel no sidebar (nao e module_catalog).',
  ARRAY['fn_acessos_empresa_contexto','fn_acessos_convidar_pessoa','fn_acessos_remover_pessoa']::text[],
  'pronto', 'media', false,
  'Tela gated por OFICINA_DONO (papel por empresa) — o screen-watcher nao tem esse papel.',
  'Registrada com B.3 para nao virar orfa no auditor de drift (mesma convencao de admin/acessos).'
)
ON CONFLICT (id) DO NOTHING;
