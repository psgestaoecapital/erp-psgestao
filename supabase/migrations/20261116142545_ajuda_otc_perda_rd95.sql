-- Comércio · OTC Vender e Faturar (/dashboard/commerce/otc) — RD-95 "?" no modal "Registrar perda"
-- ============================================================================
-- GAP (RD-95): o modal de registro de perda do orçamento/pedido (Motivo da perda, cadastro de
--   Novo motivo, Descrição) estava sem "?". Os três campos agora têm ajuda explicando o que são.
-- CORREÇÃO (aditiva, idempotente): 3 chaves em erp_ajuda_campo; o front renderiza <AjudaCampo>
--   no rótulo de cada campo (dentro da <label>).
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('otc.perda.motivo', '/dashboard/commerce/otc', 'Registrar perda', 'Motivo da perda',
   'Escolha na lista por que esse orçamento/pedido foi perdido.',
   'Classifica a perda para você enxergar depois onde mais perde negócio (preço, prazo, concorrência).',
   'Preço acima do concorrente', 'Deixar sem motivo tira a perda dos relatórios e esconde o padrão.', 'gestao_empresarial', 10),

  ('otc.perda.novo_motivo', '/dashboard/commerce/otc', 'Registrar perda', 'Novo motivo',
   'O nome de um motivo de perda que ainda não existe na lista (fica salvo para as próximas vezes).',
   'Cria uma categoria própria de perda quando nenhuma das existentes serve.',
   'Prazo de entrega', 'Criar motivos quase iguais ("Preço" e "Valor alto") espalha o dado e atrapalha o relatório.', 'gestao_empresarial', 20),

  ('otc.perda.descricao', '/dashboard/commerce/otc', 'Registrar perda', 'Descrição',
   'Um texto livre com o que de fato aconteceu nessa perda (obrigatório em alguns motivos).',
   'Guarda o contexto para entender depois a história por trás do motivo escolhido.',
   'Cliente fechou com concorrente que deu 20% de desconto e 60 dias.', 'Deixar vazio quando o motivo exige descrição impede salvar a perda.', 'gestao_empresarial', 30)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
