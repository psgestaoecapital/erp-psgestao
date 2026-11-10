-- Hub · Gestão de Obras · Portal do cliente (H9 · Decisão CEO 30/10) — ETAPA (c): a VISÃO DO CLIENTE.
-- Novas telas (só leitura, autenticadas) onde o cliente convidado vê as obras liberadas para ele:
--   /portal/obras       — lista "Minhas obras" (fn_obra_portal_minhas_obras, já no banco)
--   /portal/obras/[id]  — detalhe: avanço, fotos do diário, medições (fn_obra_portal_avanco/_fotos/_medicoes)
-- Esta migration é ADITIVA e IDEMPOTENTE: cadastra as chaves de ajuda ("?", RD-95) dessas telas e as registra
-- em system_screens (RD-98). NÃO cria/altera RLS, policies, grants ou RPC; NÃO toca dado de cliente.
-- A segurança já está nas RPCs (SECURITY DEFINER, fail-closed por auth.uid() via erp_obra_cliente_acesso).

-- 1) Ajuda "?" (RD-95) — uma chave por indicador das telas novas.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  (
    'portal.obras.lista', '/portal/obras', 'Minhas obras', 'Minhas obras',
    'Esta é a lista das obras que a construtora liberou para você acompanhar. Toque numa obra para ver o avanço, as fotos e as medições.',
    'Reúne num lugar só as obras em que você é o cliente, com o percentual concluído e o prazo de cada uma. Você vê apenas as suas obras — nunca as de outro cliente, nem custo ou margem.',
    'Se você tem duas obras com a construtora, as duas aparecem aqui, cada uma com a sua barra de avanço.',
    'Não encontrar uma obra: ela só aparece depois que a construtora envia o convite de acesso a você.',
    'hub', 10, 'publicado'
  ),
  (
    'portal.obras.avanco', '/portal/obras/[id]', 'Acompanhamento', 'Avanço da obra',
    'Mostra quanto da obra já foi concluído e o andamento de cada etapa do cronograma.',
    'Acompanhar, de leitura, como a obra está evoluindo: o percentual geral, as datas de início e fim previstas e o avanço de cada etapa.',
    '56% concluído, com a etapa "Fundação" em 100% e "Alvenaria" em 40%.',
    'Esperar ver custo ou margem: o portal mostra só o andamento físico, não valores internos da construtora.',
    'hub', 20, 'publicado'
  ),
  (
    'portal.obras.fotos', '/portal/obras/[id]', 'Acompanhamento', 'Fotos do diário',
    'São as fotos que a equipe registra no diário de obra (RDO), por dia, com o clima e as atividades do dia.',
    'Ver o que foi feito na obra sem precisar ir ao local: as fotos do diário aparecem aqui, da mais recente para a mais antiga.',
    'No dia 05/11, "tempo bom", foto da concretagem da laje.',
    'Achar que a tela está vazia por erro: se não há fotos ainda, é porque a equipe ainda não lançou nenhuma no diário.',
    'hub', 30, 'publicado'
  ),
  (
    'portal.obras.medicoes', '/portal/obras/[id]', 'Acompanhamento', 'Medições',
    'Lista as medições da obra — cada uma com o número, a competência (mês), a situação e o valor medido.',
    'Acompanhar o que já foi medido na obra e o valor de cada medição, para você conferir junto com a construtora.',
    'Medição 3, competência 10/2026, aprovada, R$ 45.000,00.',
    'Confundir "medição" com "fatura": a medição é o quanto foi executado no período; a cobrança segue o contrato.',
    'hub', 40, 'publicado'
  )
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status,
  atualizado_em = now();

-- 2) Registro das telas (RD-98 p3). auditavel_robo=false: o portal exige login de CLIENTE convidado
--    (papel "cliente da obra"); a mesma visão, de leitura, é auditável pela "Prévia" da tela da equipe
--    /dashboard/projetos/obras/[id]/portal-cliente.
INSERT INTO system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real, views_consumidas, rpcs_chamadas, auditavel_robo, motivo_nao_auditavel, criado_em, atualizado_em)
VALUES
  (
    'portal_obras', '/portal/obras', 'hub_construcao', 'Portal do cliente — minhas obras',
    'Lista, só de leitura, das obras liberadas ao cliente convidado (papel cliente da obra). Cada obra mostra o percentual concluído, o prazo e a situação. Escopo garantido no banco por auth.uid() (erp_obra_cliente_acesso).',
    'hub', 'pronto',
    ARRAY['projetos_obras']::text[],
    ARRAY['fn_obra_portal_minhas_obras','fn_ajuda_campo_listar']::text[],
    false, 'Portal do cliente: exige login de cliente convidado (papel cliente da obra). A prévia idêntica é auditável em /dashboard/projetos/obras/[id]/portal-cliente.',
    now(), now()
  ),
  (
    'portal_obras_id', '/portal/obras/[id]', 'hub_construcao', 'Portal do cliente — acompanhamento da obra',
    'Detalhe de uma obra para o cliente convidado (só leitura): avanço/cronograma, fotos do diário (RDO) e medições. Sem custo nem margem. As RPCs negam (42501) obra fora do acesso do auth.uid().',
    'hub', 'pronto',
    ARRAY['projetos_obras','projetos_obra_tarefa','projetos_obra_medicao']::text[],
    ARRAY['fn_obra_portal_avanco','fn_obra_portal_fotos','fn_obra_portal_medicoes','fn_ajuda_campo_listar']::text[],
    false, 'Portal do cliente: exige login de cliente convidado (papel cliente da obra). A prévia idêntica é auditável em /dashboard/projetos/obras/[id]/portal-cliente.',
    now(), now()
  )
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, area = EXCLUDED.area, titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional, modulo = EXCLUDED.modulo, estado_real = EXCLUDED.estado_real,
  views_consumidas = EXCLUDED.views_consumidas, rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  auditavel_robo = EXCLUDED.auditavel_robo, motivo_nao_auditavel = EXCLUDED.motivo_nao_auditavel,
  atualizado_em = now();
