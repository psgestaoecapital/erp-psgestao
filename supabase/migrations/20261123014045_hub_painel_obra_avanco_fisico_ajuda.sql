-- Hub · tela 310 (Painel, tabela "Obras em andamento"): blueprint §310 "Bloco de obras" pede o
-- "avanço físico e financeiro de cada uma". A tabela já trazia o financeiro (receita/custo/margem
-- prevista e realizada), mas não o AVANÇO FÍSICO. Esta fatia (front-only) acrescenta a coluna "Avanço"
-- (% de conclusão da obra, projetos_obras.pct_conclusao), em barra de progresso, ao lado da margem.
-- Esta migration apenas semeia o "?" (RD-95) da nova coluna; a DEMO do Hub (...006) já tem obras com
-- pct_conclusao variado (56/50/40/30/0), tornando a coluna demonstrável — sem seed.
-- Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING); catálogo de ajuda, não toca dado de cliente.
-- RD-100: sem nome de terceiro. Linguagem do usuário (gestor de obra).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.painel.obra.avanco_fisico', '/dashboard/projetos', 'Obras em andamento',
   'Avanço',
   'Mostra o percentual de conclusão física da obra (quanto já foi executado), informado no cadastro da obra.',
   'Deixa ver o avanço físico ao lado do resultado financeiro: uma obra 30% executada com margem caindo acende alerta antes do prejuízo. Compare "andou" (avanço) com "rendeu" (margem) na mesma linha.',
   'Uma obra com 56% de avanço aparece com a barra pela metade e "56%".',
   'Confundir avanço físico (o quanto foi executado) com avanço financeiro (o quanto já custou/faturou): são medidas diferentes e podem não andar juntas.',
   'hub_projetos', 33, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
