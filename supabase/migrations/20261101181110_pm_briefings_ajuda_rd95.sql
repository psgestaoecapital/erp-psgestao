-- P&M · Briefings (auditoria 31/10, nota 90 → >=95): completar RD-95 ("?") nos indicadores e ações.
-- A tela já tem CRUD (Novo/Abrir/Editar), "Virar job"/"Planejar o mês" e exclusão rastreável
-- (fn_agency_briefing_excluir: soft-delete excluido_em/excluido_por/excluido_motivo + audit_log_global).
-- Faltava só o "?" nos 3 KPIs e nas ações Novo/Abrir/Virar job. ADITIVO (só linhas de ajuda).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.briefing.kpi_total', '/dashboard/pm/briefings', 'Briefings · Indicadores', 'Briefings',
  'Quantidade total de briefings ativos (não excluídos) da empresa.',
  'Dar a dimensão da demanda registrada de atendimento.',
  '18 briefings.',
  'Achar que inclui os excluídos: briefing excluído sai da contagem (mas fica na auditoria).',
  'pm', 1, 1, 'publicado'),
 ('pm.briefing.kpi_pendentes', '/dashboard/pm/briefings', 'Briefings · Indicadores', 'Pendentes',
  'Briefings ainda "Novo" ou "Em análise" — que não viraram job.',
  'Mostrar o que falta tratar com o cliente/produção.',
  '5 pendentes.',
  'Confundir com atrasados: pendente é por status, não por prazo.',
  'pm', 2, 1, 'publicado'),
 ('pm.briefing.kpi_viraram_job', '/dashboard/pm/briefings', 'Briefings · Indicadores', 'Viraram job',
  'Briefings que já foram transformados em job de produção.',
  'Medir quantos pedidos saíram do papel.',
  '9 viraram job.',
  'Esperar que some com pendentes: são grupos diferentes de status.',
  'pm', 3, 1, 'publicado'),
 ('pm.briefing.novo', '/dashboard/pm/briefings', 'Briefings · Ações', 'Novo briefing',
  'Abre o formulário para registrar um briefing novo (cliente, título, objetivo, texto, público, prazo, referências).',
  'Guardar o pedido do cliente do jeito certo, pronto para virar job.',
  'Reunião com o cliente → Novo briefing → preenche e salva.',
  'Deixar o título vazio: é obrigatório.',
  'pm', 4, 1, 'publicado'),
 ('pm.briefing.abrir', '/dashboard/pm/briefings', 'Briefings · Ações', 'Abrir',
  'Abre o briefing salvo para ver o texto formatado e continuar editando.',
  'Revisar e desenvolver o briefing sem perder a formatação.',
  'Abrir → ajustar o objetivo → Salvar.',
  'Pensar que abrir cria outro: é o mesmo briefing, editável.',
  'pm', 5, 1, 'publicado'),
 ('pm.briefing.virar_job', '/dashboard/pm/briefings', 'Briefings · Ações', 'Virar job',
  'Transforma o briefing em um job de produção, levando objetivo, público, prazo, referências e o texto completo.',
  'Passar do pedido para a execução com um toque, sem redigitar.',
  'Briefing aprovado → Virar job → abre o job com o briefing dentro.',
  'Virar job duas vezes: depois de virar, o briefing fica "em produção" e não repete.',
  'pm', 6, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
