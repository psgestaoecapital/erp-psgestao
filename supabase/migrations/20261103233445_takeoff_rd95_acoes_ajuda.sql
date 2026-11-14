-- PDCA Hub /dashboard/projetos/takeoff — RD-95: as AÇÕES principais da tela não tinham "?".
-- Acrescenta "?" (AjudaCampo) aos botões Analisar com IA, Processar DWG, Reanalisar,
-- Adicionar ambiente e Gerar itens no orçamento (campos/colunas já tinham).
-- Chaves novas; idempotente via ON CONFLICT (erp_ajuda_campo.chave é UNIQUE).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('projetos.takeoff.analisar_ia', '/dashboard/projetos/takeoff', 'Take-off · Ações', 'Analisar com IA',
   'Ação que envia a planta enviada (imagem ou PDF) para a IA detectar os ambientes e medir áreas e perímetros.',
   'Preenche automaticamente a tabela de ambientes a partir do desenho, para você só revisar e confirmar em vez de digitar tudo.',
   'Após enviar a planta do apartamento, clicar em "Analisar com IA" traz sala, quartos e banheiros já com m² estimado.',
   'Clicar antes de enviar uma planta: sem arquivo não há o que analisar e o botão fica desabilitado.',
   'projetos', 30, 'publicado'),
  ('projetos.takeoff.processar_dwg', '/dashboard/projetos/takeoff', 'Take-off · Ações', 'Processar DWG',
   'Ação que lê o arquivo CAD (DWG) com precisão, extraindo as medidas reais das camadas do desenho.',
   'Usa a geometria exata do CAD (não estimativa visual), dando áreas e perímetros mais confiáveis para o orçamento.',
   'Com uma planta .dwg, "Processar DWG (precisão CAD)" traz as medidas direto das linhas do arquivo.',
   'Esperar precisão CAD de uma planta em imagem/PDF: aí o certo é "Analisar com IA", não o DWG.',
   'projetos', 31, 'publicado'),
  ('projetos.takeoff.reanalisar', '/dashboard/projetos/takeoff', 'Take-off · Ações', 'Reanalisar',
   'Ação que roda a leitura do DWG de novo (consome 1 crédito de processamento).',
   'Serve quando a planta foi corrigida ou a extração anterior ficou incompleta e você quer refazer a radiografia.',
   'Se a primeira leitura perdeu um cômodo, "Reanalisar" processa o arquivo novamente.',
   'Reanalisar sem necessidade: cada reanálise custa 1 crédito; revise a tabela antes de refazer.',
   'projetos', 32, 'publicado'),
  ('projetos.takeoff.add_ambiente', '/dashboard/projetos/takeoff', 'Take-off · Ações', 'Adicionar ambiente',
   'Ação que cria um ambiente manualmente na tabela, para o que a IA não detectou ou um espaço novo.',
   'Garante que nenhum cômodo fique de fora do orçamento, mesmo quando não aparece claro na planta.',
   'A planta não mostrou a área de serviço: clicar em "Adicionar ambiente" e lançar o m² à mão.',
   'Duplicar um ambiente que a IA já trouxe: confira a tabela antes de adicionar para não contar duas vezes.',
   'projetos', 33, 'publicado'),
  ('projetos.takeoff.gerar_orcamento', '/dashboard/projetos/takeoff', 'Take-off · Ações', 'Gerar itens no orçamento',
   'Ação que leva os ambientes confirmados (com serviço e base de cálculo) como itens para o orçamento de destino.',
   'Transforma a medição em itens de orçamento sem redigitar, ligando o take-off ao orçamento escolhido no topo.',
   'Com 5 ambientes confirmados e um orçamento selecionado, "Gerar itens no orçamento" cria os 5 itens lá.',
   'Gerar sem escolher o orçamento de destino, ou sem confirmar ambientes: o botão fica desabilitado nesses casos.',
   'projetos', 34, 'publicado')
ON CONFLICT (chave) DO NOTHING;
