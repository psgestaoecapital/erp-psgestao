-- RD-95 (CEO 08/10) — ajuda "?" da tela de Custos da obra (/dashboard/projetos/obras/[id]/custos).
--
-- A tela é rota dinâmica e agora fixa rota={ROTA}='/dashboard/projetos/obras/[id]/custos' nos AjudaCampo
-- (front-end). 10 das 11 chaves projetos.obra_custos.* já vivem nessa rota; só a chave
-- 'projetos.obra_custos.editar' estava gravada numa rota antiga sem o padrão [id]
-- ('/dashboard/projetos/obras/custos'), então o "?" do botão Editar abriria vazio.
--
-- CONSERTO: alinha a rota da linha 'editar' ao padrão [id] das demais. ADITIVA (só UPDATE de config de
-- ajuda; não toca dado de cliente, RLS, função nem estrutura) e IDEMPOTENTE (o WHERE casa só a rota antiga).
--
-- PROVA (RD-38, BEGIN..ROLLBACK, statement_timeout curto, produção):
--   antes: obra_custos.* publicadas em '/dashboard/projetos/obras/[id]/custos' => 10
--   após:                                                                        => 11 (entra 'editar')

UPDATE public.erp_ajuda_campo
   SET rota = '/dashboard/projetos/obras/[id]/custos',
       atualizado_em = now()
 WHERE chave = 'projetos.obra_custos.editar'
   AND rota = '/dashboard/projetos/obras/custos';
