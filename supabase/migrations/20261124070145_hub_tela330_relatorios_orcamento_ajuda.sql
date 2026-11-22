-- Hub · tela 330 (Relatórios do Orçamento, releitura 21/11) — chave de ajuda do seletor de formato.
-- RD-95: o filtro "Formato" (Sintético · Analítico · Planilha cega) da nova tela de relatórios tem o "?".
-- Aditiva e idempotente (ON CONFLICT); só semeia a chave de ajuda, não toca tabela de domínio nem dado de cliente.
-- A tela em si só LÊ o orçamento pelas RPCs já publicadas (fn_projetos_orcamento_eap_arvore,
-- fn_projetos_orcamento_item_eap_listar). Code: desenvolvedor_4_g.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.orcamento_eap.relatorio_formato','/dashboard/projetos/obras/[id]/orcamento/relatorios','Relatórios do orçamento','Formato','Escolha como quer ver o orçamento: Sintético (totais por etapa), Analítico (todos os itens com custos) ou Planilha cega (itens sem preços).','Muda o nível de detalhe e o público do relatório: o sintético resume por etapa, o analítico mostra item a item, e a planilha cega é para o empreiteiro cotar sem ver o seu orçamento.','Planilha cega para enviar ao empreiteiro de pisos','Mandar o Analítico (com os seus preços) para o fornecedor cotar — para cotação use a Planilha cega.','projetos',180,'publicado')
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
