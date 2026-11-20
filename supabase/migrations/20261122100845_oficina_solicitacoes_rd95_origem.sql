-- RD-98 p3 (origem do dado) + RD-95 (ajuda "?") — tela /dashboard/oficina/solicitacoes
-- Auditoria PDCA (aud8): 2 gaps na tela de Solicitações de peça.
--  1) system_screens.views_consumidas estava NULL — a tela só tinha rpcs_chamadas.
--     A lista vem de fn_oficina_peca_solicitacoes_listar, que lê erp_os_peca_solicitacao
--     (solicitações), erp_os (número/placa) e erp_produtos (preço de venda). A página ainda
--     lê erp_os direto (id, placa). Registramos essas 3 fontes.
--  2) RD-95 incompleto: a tela tinha "?" só nos 2 filtros, faltando nas AÇÕES
--     (Aprovar/Comprada/Trocada/Recusar) e no STATUS (badge do card). Cadastramos as 2 chaves.
-- Aditiva e idempotente. Não toca dado de cliente. RLS/permissão inalteradas.

-- 1) Origem do dado (RD-98 p3): fontes consumidas pela tela
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_os','erp_os_peca_solicitacao','erp_produtos']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/oficina/solicitacoes';

-- 2) Ajuda de campo (RD-95): STATUS do card + AÇÕES de decisão
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('oficina.solicitacoes.status', '/dashboard/oficina/solicitacoes', 'Solicitações de peça',
   'Situação do pedido',
   'Mostra em que etapa está cada pedido de peça: Pendente (aguarda sua decisão), Aprovado, Comprado, Recusado ou Trocada ✓ (já instalada no veículo).',
   'Você acompanha o pedido de ponta a ponta sem precisar perguntar ao mecânico: o que está parado aparece como Pendente e o que foi resolvido vai para o histórico.',
   'Um pedido em "Aprovado" ainda não foi comprado — marque "Comprada" quando a peça entrar e "Trocada" quando o mecânico instalar.',
   'Confundir Aprovado com Comprado: aprovar só libera a compra; a peça só está garantida depois de "Comprada".',
   'oficina', 3),
  ('oficina.solicitacoes.acoes', '/dashboard/oficina/solicitacoes', 'Solicitações de peça',
   'Decisão do pedido',
   'Botões para decidir cada pedido: Aprovar (libera a compra), Comprada (a peça foi comprada), Trocada (o mecânico instalou) e Recusar (nega o pedido). Os valores aparecem só para o gerente.',
   'Fecha o ciclo da peça — do pedido do mecânico até a troca no veículo — e mantém o estoque e a OS coerentes com o que realmente aconteceu.',
   'Peça aprovada e já comprada no balcão: clique "Comprada"; depois que o mecânico instalar, clique "Trocada".',
   'Pular "Comprada" e marcar "Trocada" direto: registre a compra antes para o custo entrar certo na OS.',
   'oficina', 4)
ON CONFLICT (chave) DO UPDATE SET
   rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
   o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
   exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
   vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, atualizado_em = now();
