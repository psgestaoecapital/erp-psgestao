-- P&M · Onda PM-F, F3/F4 (telas): textos do "?" (RD-95) das novas ações do fluxo do fee e o nome do item de menu.
-- Aditiva: só INSERT em erp_ajuda_campo (ON CONFLICT DO NOTHING) e o rótulo do módulo pm_contratos ("Contratos" → "Fees").

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('pm.fee.briefing', '/dashboard/pm/contratos', 'Fee', 'Briefing do fee',
   'Nada a digitar aqui: mostra se o fee já tem briefing. "Fazer briefing" abre o briefing já ligado a este fee e ao cliente.',
   'É o 1º passo da produção do fee: registrar com o cliente o que ele espera e quais são os objetivos, antes de planejar.',
   'Fee "Nova Terra Tintas · 8 posts/mês" → briefing com objetivo, público e referências do mês.',
   'Planejar ou abrir jobs sem briefing: a equipe produz sem saber o que o cliente quer.', 'pm', 400),
  ('pm.fee.planejamento', '/dashboard/pm/contratos', 'Fee', 'Planejamento do mês',
   'Clique em "Planejar o mês": o sistema cria o planejamento do mês com um item por serviço contratado no fee, com datas já distribuídas.',
   'É o 2º passo: distribui os serviços do fee nas datas do mês. Cada item aprovado do planejamento vira um job.',
   'Fee com 4 posts/mês → 4 itens no planejamento (dias 4, 12, 19 e 27), em rascunho, para ajustar e aprovar.',
   'Criar jobs soltos para um fee: eles não aparecem no contratado × realizado. Job de fee nasce do planejamento.', 'pm', 401),
  ('pm.fee.jobs', '/dashboard/pm/contratos', 'Fee', 'Jobs do mês',
   'Nada a digitar: conta os jobs do fee criados neste mês. Clique para ver o contratado × realizado por serviço.',
   'Mostra se a produção do mês está dentro do que foi contratado: faltando, em dia ou além do contrato.',
   '8 posts contratados, 6 jobs criados → "faltam 2".',
   'Job sem serviço vinculado não conta no escopo — vincule o serviço no job.', 'pm', 402),
  ('pm.fee.planejar', '/dashboard/pm/briefings', 'Fee', 'Planejar o mês',
   'Clique para criar (ou abrir) o planejamento deste mês do fee ligado ao briefing.',
   'Leva o briefing para o próximo passo do fluxo: o planejamento com os serviços do fee nas datas.',
   'Briefing de novembro aprovado → "Planejar o mês" → planejamento de novembro com os itens do fee.',
   'Usar "Virar job" num briefing de fee: job de fee nasce do planejamento, não do briefing.', 'pm', 403),
  ('pm.briefing.fee', '/dashboard/pm/briefings', 'Briefing', 'Fee do briefing',
   'Já vem preenchido quando o briefing é aberto pelo fee (P&M › Fees › Fazer briefing).',
   'Liga o briefing ao fee do cliente: o planejamento do mês usa este briefing.',
   'Briefing do fee "Nova Terra Tintas".',
   'Fazer o briefing do fee pelo "Novo briefing" solto: ele fica sem ligação com o fee.', 'pm', 58)
ON CONFLICT (chave) DO NOTHING;

UPDATE public.module_catalog SET nome = 'Fees' WHERE id = 'pm_contratos' AND nome = 'Contratos';
