-- PDCA GE · /dashboard/compras/mutirao (Mutirão de notas) — aud8 s/nota.
-- Gap RD-95: a tela aplica vínculos em LOTE (dinheiro/estoque) e não tinha nenhum "?". Semeia a ajuda dos
-- indicadores de progresso, do casamento exato em lote, dos filtros, da conferência em série e da prévia.
-- Gap RD-98 p3: a rota estava em system_screens com estado_real='desconhecida' e views/rpcs vazias. Preenche a
-- origem do dado (RPCs + tabela + componente) e reclassifica para 'pronto' (tela funcional e no menu).
-- Aditiva e idempotente (ON CONFLICT DO NOTHING / UPDATE por id); não toca dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compras.mutirao.progresso', 'Mutirão de notas', 'Fila de trabalho',
  'Nada a preencher: é a contagem das notas recebidas que ainda precisam ter os itens casados com os seus produtos.',
  'Mostra quanto do mutirão já está pronto — quantas notas estão 100% resolvidas, quantas faltam e quantos itens ainda não foram casados. A barra enche conforme você resolve.',
  '12 prontas · faltam 5 notas · 23 itens: cinco notas ainda têm itens sem produto.',
  'Achar que "pronta" quer dizer concluída: pronta aqui é todos os itens casados; concluir a nota (movimentar o estoque) ainda é feito na tela de documentos recebidos.',
  10, '/dashboard/compras/mutirao'),
 ('compras.mutirao.casamento_lote', 'Mutirão de notas', 'Casamento exato em lote',
  'Nada a preencher: o botão varre a fila e casa de uma vez só os itens que têm correspondência EXATA com um produto seu.',
  'Resolve em massa o que é seguro: só casa por de-para já aprendido do fornecedor, código de barras (EAN) e código do produto — NUNCA por descrição parecida. O número ao lado ("N itens") é quanto casaria agora; na linha da nota, "N casam sozinho" é o mesmo para aquela nota.',
  '40 itens casam sozinho: um clique resolve os 40 e o de-para nasce para as próximas notas do mesmo fornecedor virem casadas.',
  'Esperar que case tudo: itens sem código igual continuam na fila para conferência manual, de propósito — casar por descrição geraria vínculo errado.',
  11, '/dashboard/compras/mutirao'),
 ('compras.mutirao.filtros', 'Mutirão de notas', 'Filtros da fila',
  'Nada a preencher: escolha o recorte da fila. Todas mostra tudo; Prontas, só as 100% resolvidas; Com casamento exato, as que têm item casável agora; Sem nenhum vínculo, as que ainda não começaram.',
  'Ajuda a atacar primeiro o que rende mais — por exemplo "Com casamento exato" para limpar em lote, ou "Sem nenhum vínculo" para focar o trabalho manual.',
  'Filtro "Com casamento exato" + botão de lote = resolve o fácil antes de conferir o resto.',
  'Deixar num filtro e achar que a fila está vazia: troque para "Todas" para ver o que sobrou em outros recortes.',
  12, '/dashboard/compras/mutirao'),
 ('compras.mutirao.conferir', 'Mutirão de notas', 'Conferir a nota',
  'Nada a preencher: abre os itens da nota para você casar cada um com o seu produto (ou criar o de-para).',
  'É a conferência em série: resolve item a item e, ao terminar, "Próxima nota" já leva para a próxima pendente, sem voltar à lista.',
  'Nota com 3 itens sem produto: Conferir, casa os 3, Próxima nota.',
  'Fechar a nota com item ainda sem produto: o item volta para a fila como pendente — conclua todos antes de seguir.',
  13, '/dashboard/compras/mutirao'),
 ('compras.mutirao.proxima', 'Mutirão de notas', 'Próxima nota',
  'Nada a preencher: pula direto para a próxima nota que ainda tem itens pendentes.',
  'Mantém o ritmo do mutirão — você não precisa procurar na lista qual é a próxima que falta.',
  'Terminou de casar a nota atual? "Próxima nota" abre a seguinte pendente.',
  'Usar quando ainda falta item na nota aberta: você sai dela sem terminar e ela continua na fila.',
  14, '/dashboard/compras/mutirao'),
 ('compras.mutirao.pular', 'Mutirão de notas', 'Pular',
  'Nada a preencher: fecha a nota aberta sem casar os itens, deixando-a para depois.',
  'Serve para adiar uma nota que depende de uma decisão (produto novo, dúvida com o fornecedor) sem perder o lugar na fila.',
  'Nota com item que ainda vai virar cadastro novo: Pular e seguir, resolve depois.',
  'Pular e achar que resolveu: a nota continua pendente e volta a aparecer na fila.',
  15, '/dashboard/compras/mutirao'),
 ('compras.mutirao.previa_aplicar', 'Mutirão de notas', 'Aplicar vínculos da prévia',
  'Nada a preencher: a prévia lista, antes de gravar, cada item que será casado e por qual critério. "Aplicar N vínculos" confirma e grava todos de uma vez.',
  'Garante que nada é casado às cegas: você vê o de-para proposto (produto e critério) e só então aplica. Cada vínculo aplicado também ensina o de-para do fornecedor.',
  'Prévia com 40 vínculos (30 por código de barras, 10 por código do produto): confira e clique em Aplicar 40 vínculos.',
  'Aplicar sem ler a prévia: revise os destinos; o casamento é só por código/de-para, mas vale conferir os produtos antes de gravar em lote.',
  16, '/dashboard/compras/mutirao')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado + reclassificação do estado real (tela funcional e no menu).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_nfe_recebidas']::text[],
       rpcs_chamadas    = ARRAY['fn_nfe_fila_conferencia','fn_nfe_vincular_lote_exato','fn_nfe_vincular_lote_exato_previa']::text[],
       componentes_principais = ARRAY['ItensNfeRecebida']::text[],
       estado_real = CASE WHEN estado_real = 'desconhecida' THEN 'pronto' ELSE estado_real END,
       atualizado_em = now()
 WHERE id = 'ge_map_compras_mutirao';
