-- Hub · Gestão de Obras · aba Medições — RD-95 "?" do indicador "Conta a receber gerada".
-- Code: desenvolvedor_4_g.
--
-- Contexto: a aprovação de uma medição gera, no NÚCLEO, o título a receber do cliente da obra
-- (trigger trg_obra_medicao_gerar_receber, PR #4397). A tela de Medições passa a MOSTRAR (somente
-- leitura) esse título na medição aprovada, com link para o financeiro. RD-95 exige "?" em todo
-- indicador novo: esta migration semeia a chave de ajuda projetos.medicao.receber_gerado.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo
-- global de ajuda (sem company_id, sem dado de cliente). NÃO cria/altera tabela nem função e não
-- altera nenhuma linha existente.
--
-- Prova RD-38 (rodar antes/depois):
--   antes:  SELECT count(*) FROM public.erp_ajuda_campo
--             WHERE chave='projetos.medicao.receber_gerado';   -- => 0
--   depois: SELECT count(*) FROM public.erp_ajuda_campo
--             WHERE chave='projetos.medicao.receber_gerado';   -- => 1 (mesma rota das demais chaves)

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.medicao.receber_gerado', '/dashboard/projetos/obras/[id]/medicoes', 'Medições', 'hub_projetos',
   'Conta a receber gerada',
   'Nada a preencher — é um indicador. Aparece na medição aprovada quando a aprovação já gerou o título a receber do cliente no financeiro.',
   'Mostra, sem sair da tela, que a medição aprovada virou cobrança: o valor e a situação do título, com link para o financeiro. Fecha o elo medição → faturamento.',
   'Medição nº 7 aprovada por R$ 25.000 → "Conta a receber gerada · R$ 25.000,00 · aberto". Clique em "Ver no financeiro" para acompanhar a cobrança.',
   'Esperar o título antes de aprovar a medição: ele só é gerado na aprovação. Rascunho não gera cobrança.', 12)
ON CONFLICT (chave) DO NOTHING;
