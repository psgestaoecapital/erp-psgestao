-- Hub · ONDA S-MED · tela 320 — ajuda (RD-95) do fluxo de aprovação da medição (componente MedicaoEtapas).
-- Aditiva/idempotente: só semeia 2 chaves de ajuda. Sem ALTER/DROP, sem dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.medicao.etapa_fluxo','/dashboard/projetos/obras/[id]/medicoes','Medição · Aprovação','Aprovação da medição','Acompanhe a medição passar pelas etapas de aprovação até o financeiro liberar.','Uma única medição caminha por Lançamento → Aceite do contratado → Engenharia → Gestão de pessoas → Diretoria → Financeiro; cada etapa aprova ou devolve, e tudo fica no histórico.','Engenharia aprovou; aguardando a Diretoria.','Achar que aprovar uma etapa já gera o título — o título só nasce depois que o Financeiro aprova.','projetos',310,'publicado'),
 ('projetos.medicao.etapa_motivo','/dashboard/projetos/obras/[id]/medicoes','Medição · Aprovação','Motivo da devolução','Explique o que precisa ser corrigido ao devolver a medição para a etapa anterior.','Fica no histórico e orienta quem vai refazer; a devolução reabre a etapa anterior sem apagar nada.','Faltou anexar a folha assinada do mês.','Devolver sem motivo — o motivo é obrigatório para a etapa anterior saber o que resolver.','projetos',320,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  status          = 'publicado',
  atualizado_em   = now();
