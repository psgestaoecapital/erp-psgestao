-- RD-95: "?" (AjudaCampo) das ações e do conteúdo do card na tela EHS › EPI › Alertas (/dashboard/ehs/epi/alertas).
-- Contexto (auditoria aud8 17/11, 90/95): só os filtros (status, severidade) tinham "?". As ações Resolver e Ignorar
-- e o conteúdo do alerta ficavam sem orientação — o usuário não sabia o que cada ação faz com o alerta.
-- Aditiva e idempotente: ON CONFLICT (chave) DO NOTHING. Sem UPDATE/DELETE de dado existente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('compliance.epi.alertas.conteudo', '/dashboard/ehs/epi/alertas', 'EHS · EPI · Alertas', 'Alerta',
   'Cada card é um alerta de EPI: o título diz o problema, a severidade (crítica/alta/média/baixa) a urgência, e os ícones ligam ao funcionário e ao EPI envolvidos.',
   'Mostra o que precisa de atenção na gestão de EPIs (CA vencido, entrega pendente, troca atrasada) para agir antes de virar risco ou autuação.',
   '"CA do capacete vencido" · severidade ALTA · 👤 João Silva · 🛡️ Capacete classe B.',
   'Olhar só o título e ignorar a severidade — um alerta crítico precede os demais.',
   'ehs', 1, 1, 'publicado'),

  ('compliance.epi.alertas.resolver', '/dashboard/ehs/epi/alertas', 'EHS · EPI · Alertas', 'Resolver',
   'Marque como resolvido quando a causa do alerta foi tratada (EPI entregue, CA renovado, troca feita). O alerta sai da lista de ativos.',
   'Fecha o alerta registrando que a pendência foi sanada, mantendo o histórico de conformidade.',
   'Resolver "troca de luva atrasada" depois de entregar o par novo ao funcionário.',
   'Resolver sem ter de fato tratado a causa — o risco continua e some da lista de ativos.',
   'ehs', 2, 1, 'publicado'),

  ('compliance.epi.alertas.ignorar', '/dashboard/ehs/epi/alertas', 'EHS · EPI · Alertas', 'Ignorar',
   'Use quando o alerta não se aplica (ex.: funcionário desligado, EPI descontinuado). O alerta sai dos ativos sem contar como resolvido.',
   'Tira da lista um alerta que não exige ação, sem fingir que a pendência foi tratada.',
   'Ignorar um alerta de EPI de um colaborador já desligado.',
   'Ignorar um alerta real para "limpar" a tela — a pendência de segurança continua existindo.',
   'ehs', 3, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
