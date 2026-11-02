-- RD-95: "?" (AjudaCampo) no contador de entregas e na prévia (capa) do card do Portfolio (P&M).
-- Aditiva: apenas INSERT de duas chaves em erp_ajuda_campo. Idempotente (ON CONFLICT DO NOTHING pela chave).
-- Rota /dashboard/pm/portfolio (PDCA aud8 84/95 — gap 2). Sem alterar dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('pm.portfolio.contador',
   '/dashboard/pm/portfolio',
   'Portfolio',
   'Quantas entregas aparecem',
   'Não é um campo de digitar: é a contagem das entregas publicadas que casam com o filtro de cliente escolhido.',
   'Dá a dimensão rápida do portfolio da agência — quantas peças já foram publicadas para o(s) cliente(s) selecionado(s).',
   'Com o filtro em "Todos os clientes" mostra o total; ao escolher um cliente, mostra só as entregas dele.',
   'Se o número vier menor do que o esperado, confira o filtro de cliente no topo — ele pode estar restringindo a lista.',
   'pm', 2, 'publicado'),
  ('pm.portfolio.capa',
   '/dashboard/pm/portfolio',
   'Portfolio · Card da entrega',
   'Prévia da entrega (capa)',
   'A capa é a 1ª imagem anexada ao job. Enquanto a agência não anexa uma imagem, mostramos uma capa gerada (cor + ícone por tipo da entrega).',
   'Deixa o portfolio com cara de vitrine mesmo antes de ter a arte final anexada, e destaca a peça real assim que a imagem é enviada.',
   'Design → capa com tom ametista e ícone 🎨; Vídeo → capa com tom azul e ícone 🎬; com imagem anexada, a própria arte vira a capa.',
   'Se a capa ficar sempre genérica, anexe a imagem da entrega no job (aba de arquivos) — a 1ª imagem passa a ser a capa.',
   'pm', 11, 'publicado')
ON CONFLICT (chave) DO NOTHING;
