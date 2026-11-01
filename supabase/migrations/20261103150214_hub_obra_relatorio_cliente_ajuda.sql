-- RD-95: "?" (AjudaCampo) dos indicadores do Relatório ao cliente da obra (tela 297, H9/Gestão de Obras)
-- e do link novo no cockpit da obra. Aditivo e idempotente (ON CONFLICT (chave) DO NOTHING).
-- Linguagem do usuário (arquiteto/engenheiro). RD-100: sem nome de outro sistema.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.obra.relatorio.conclusao', '/dashboard/projetos/obras/[id]/relatorio', 'Relatório ao cliente',
   'Avanço da obra (%)',
   'Mostra o quanto da obra já foi executado, em porcentagem.',
   'É o avanço físico lançado na medição/cronograma. Serve para o cliente ver, de relance, o estágio da obra.',
   '45% concluída',
   'Confundir avanço físico (execução) com avanço financeiro (quanto já foi faturado). Aqui é a execução.',
   'hub_projetos', 0, 1, 'publicado'),

  ('projetos.obra.relatorio.prazo', '/dashboard/projetos/obras/[id]/relatorio', 'Relatório ao cliente',
   'Prazo',
   'Mostra a data de início e a previsão de término da obra.',
   'Dá ao cliente a referência de quando a obra começou e quando deve terminar.',
   'Início 10/03 · Previsão 30/09',
   'Deixar a previsão de término em branco na obra: aqui aparece como "—".',
   'hub_projetos', 1, 1, 'publicado'),

  ('projetos.obra.relatorio.valor_previsto', '/dashboard/projetos/obras/[id]/relatorio', 'Relatório ao cliente',
   'Valor previsto',
   'Mostra o valor total previsto da obra (orçado/contratado).',
   'É a base de comparação com o que já foi medido. O cliente vê quanto a obra vale no total.',
   'R$ 320.000,00',
   'Esperar o valor realizado de custos aqui: este é o valor previsto da obra para o cliente.',
   'hub_projetos', 2, 1, 'publicado'),

  ('projetos.obra.relatorio.valor_medido', '/dashboard/projetos/obras/[id]/relatorio', 'Relatório ao cliente',
   'Valor medido',
   'Mostra quanto já foi medido/aprovado até agora.',
   'Comparado ao valor previsto, indica quanto da obra já foi reconhecido em medição.',
   'R$ 144.000,00',
   'Confundir com o que já foi pago: medido é o quanto foi aprovado na medição, não o recebido.',
   'hub_projetos', 3, 1, 'publicado'),

  ('projetos.obra.relatorio.diario', '/dashboard/projetos/obras/[id]/relatorio', 'Relatório ao cliente',
   'Dias de diário',
   'Mostra quantos dias de diário de obra (RDO) foram registrados.',
   'Indica a frequência do acompanhamento em campo que o cliente pode consultar.',
   '28 dias',
   'Achar que conta dias corridos da obra: conta os registros de diário feitos.',
   'hub_projetos', 4, 1, 'publicado'),

  ('projetos.obra.relatorio.fotos', '/dashboard/projetos/obras/[id]/relatorio', 'Relatório ao cliente',
   'Fotos do diário',
   'Mostra o total de fotos anexadas aos diários da obra.',
   'Dá ao cliente a dimensão do registro visual do andamento.',
   '112 fotos',
   'Esperar ver as fotos aqui: este indicador conta; as imagens ficam no diário da obra.',
   'hub_projetos', 5, 1, 'publicado'),

  ('projetos.obra.relatorio.medicoes', '/dashboard/projetos/obras/[id]/relatorio', 'Relatório ao cliente',
   'Medições',
   'Mostra o total de lançamentos de avanço/medição por item da obra.',
   'Indica o volume de medições já feitas, base do avanço e do valor medido.',
   '36 medições',
   'Confundir com o número de itens do cronograma: aqui são os lançamentos de avanço.',
   'hub_projetos', 6, 1, 'publicado'),

  ('projetos.cockpit.relatorio', '/dashboard/projetos/obras/[id]/cockpit', 'Ações da obra',
   'Relatório ao cliente',
   'Abre o relatório da obra pronto para enviar ao cliente (avanço, prazo, valores e registros).',
   'Reúne numa página só o que o cliente precisa ver e permite salvar em PDF/imprimir.',
   'Clique para abrir o relatório e usar "Imprimir / Salvar PDF".',
   'Procurar o relatório num menu separado: ele abre a partir do cockpit da obra.',
   'hub_projetos', 20, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
