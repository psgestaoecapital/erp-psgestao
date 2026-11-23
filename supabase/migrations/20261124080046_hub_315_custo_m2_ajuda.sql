-- Hub · §315 Orçamento por EAP (Onda C-2) · KPI "Custo por m²" (blueprint essencial)
-- RD-95: "?" do indicador novo "Custo por m²" nos totais do orçamento.
-- Aditivo: só insere a linha de ajuda; o cálculo (total estruturado ÷ area_construida_m2)
-- é na tela, sem tocar banco/estrutura.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'projetos.orcamento_eap.custo_m2',
  '/dashboard/projetos/obras/[id]/orcamento',
  'Orçamento por EAP',
  'Custo por m²',
  'Indicador calculado: não é digitado. Preencha a área construída (m²) no cadastro da obra para ele aparecer.',
  'Mostra o custo da obra por metro quadrado (total estruturado pela EAP ÷ área construída). Serve para comparar obras e aferir o orçamento contra referências de mercado e o CUB.',
  'R$ 690.902,50 em 384 m² = R$ 1.799,22 /m².',
  'Ler o custo/m² sem toda a EAP estruturada: enquanto houver itens sem EAP, o total estruturado é parcial e o custo/m² fica abaixo do real.',
  'projetos',
  15
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'projetos.orcamento_eap.custo_m2');
