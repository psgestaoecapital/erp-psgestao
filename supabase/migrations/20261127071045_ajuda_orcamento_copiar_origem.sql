-- Hub · Orçamento por EAP (tela 315) · §108 "Copiar de outro orçamento" (CEO 07/11, Onda do Hub).
-- A UI ganha o botão "Copiar de outro orçamento" + um seletor do orçamento de ORIGEM (mesma empresa), que chama
-- fn_projetos_orcamento_copiar(destino, origem) (backend em #6147). RD-95: o novo controle (o <select> da origem)
-- precisa do "?" com texto do banco — esta migration semeia a chave de ajuda.
--
-- ADITIVA e idempotente: só um INSERT de 1 linha em erp_ajuda_campo (ON CONFLICT (chave) DO NOTHING).
-- Nenhuma tabela/coluna nova, nenhum dado de cliente tocado. RD-52: arquivo em supabase/migrations + PR,
-- versão acima da main (faixa dev4g :45–:54).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/orcamento', 'projetos', 'publicado'
FROM (VALUES
  ('projetos.orcamento_eap.copiar_origem', 'Orçamento por EAP', 'Orçamento de origem',
   'Escolha outro orçamento da mesma empresa para copiar os itens dele para este orçamento.',
   'Aproveita um orçamento parecido (mesmo tipo de obra ou um modelo) sem lançar item por item. Os itens da origem, com a EAP, o local e os custos, são ADICIONADOS a este — os que já existem aqui continuam.',
   'Copiar o orçamento de uma obra anterior semelhante e depois ajustar as quantidades.',
   'Achar que a cópia SUBSTITUI o orçamento: ela soma os itens. Se repetir a cópia, os itens entram de novo (duplicam).',
   40)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
