-- Hub · Calculadora de Obra: "?" do botão "Gerar orçamento do cálculo" (RD-95). Aditiva: só texto de ajuda novo,
-- sem dado de cliente, sem RLS/grants. Faixa desenvolvedor_4_g (segundos 52). Fecha o gap da auditoria FC (26/10):
-- em empresa sem orçamento em rascunho, o único caminho ("Adicionar à proposta") ficava morto.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.calculadora.gerar_orcamento', 'Calculadora', 'Gerar orçamento do cálculo',
  'Nada a preencher: toque para criar um orçamento novo (rascunho) já com todos os itens do cálculo dentro.',
  'Transforma a lista de compra num orçamento aberto em Orçamentos, com quantidade, custo e preço de cada item, pronto para você fechar a proposta do cliente.',
  'Cálculo de parede com 7 itens → "Gerar orçamento do cálculo" → abre o orçamento nº 123 com os 7 itens e os preços já lançados.',
  'Achar que já salva a venda: ele cria o orçamento em rascunho; você ainda revisa e aprova a proposta em Orçamentos. Item sem produto vinculado entra com preço zero para você completar lá.',
  60, '/dashboard/projetos/calculadora')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
