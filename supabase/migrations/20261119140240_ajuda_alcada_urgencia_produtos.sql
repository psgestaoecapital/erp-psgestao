-- PDCA GE · /dashboard/compras/alcada · auditor_pdca_2 17/11 · item 1 (RD-98)
-- A allowlist de PRODUTOS para compra urgente (urgencia_produto_ids) era aplicada pelo
-- servidor (fn_compras_solicitacao_enviar) mas INGERENCIÁVEL pela tela — só dava para
-- popular por SQL cru. A PR adiciona a seção de produtos na UI (picker + chips). Estas
-- são as chaves de ajuda ("?", RD-95) dos 2 novos pontos. Aditiva e idempotente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT v.chave, '/dashboard/compras/alcada', 'Alçada de compras', v.rotulo,
       v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, 'gestao_empresarial', v.ordem, 1, 'publicado'
FROM (VALUES
  ('compras.alcada.urgencia_produtos', 'Produtos liberados para compra urgente',
   'Lista de produtos específicos que podem ser comprados com urgência, sem passar pela aprovação normal.',
   'Libera a compra urgente de um item pontual mesmo quando a categoria dele não está liberada — a regra vale por produto, além da regra por categoria.',
   'Filtro de linha anti-chamas (quando só esse item precisa de urgência, não a categoria inteira).',
   'Esperar que o produto apareça sem estar cadastrado: só entram produtos do seu cadastro (Produtos).', 6),
  ('compras.alcada.incluir_produto', 'Incluir produto',
   'Digite o nome do produto e escolha na lista; toque em Incluir para adicioná-lo aos liberados.',
   'Acrescenta um produto específico à lista de compra urgente.',
   'Óleo lubrificante 15W40.',
   'Digitar um nome que não existe no cadastro: só vale produto cadastrado e ativo.', 7)
) AS v(chave, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave
);
