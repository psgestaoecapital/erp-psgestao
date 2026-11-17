-- Revenda · Custos do veículo (/dashboard/revenda/veiculo/[id]/custos) — chamado #6874.
-- O campo "valor" do lançamento de custo passou a usar o campo monetário padrão (CampoMoeda), que formata em R$
-- enquanto digita e grava o número puro. Esta migration semeia o "?" (RD-95/AjudaCampo) desse campo; o .tsx que usa
-- o <AjudaCampo chave="revenda.veiculo.custos.valor" rota="/dashboard/revenda/veiculo/custos" /> acompanha nesta PR.
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Só INSERT de texto de ajuda; NÃO altera função, RLS, nem dado de
-- cliente. Faixa de segundos do jordana-code (:20). Nenhuma leitura/varredura pesada.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/revenda/veiculo/custos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('revenda.veiculo.custos.valor', 'Lançar custo', 'Valor do custo',
  'Digite quanto custou, em reais. O campo já formata em R$ enquanto você digita — não precisa colocar ponto nem vírgula à mão.',
  'É o valor que entra no "Realizado" do veículo e, se você marcar "gerar título em contas a pagar", vira o valor do título na GE.',
  'Para um custo de mil e duzentos reais, digite 120000 e o campo mostra R$ 1.200,00.',
  'Errar um zero: confira sempre o R$ que aparece no campo antes de salvar (ex.: R$ 1.200,00, não R$ 120,00).', 2)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
