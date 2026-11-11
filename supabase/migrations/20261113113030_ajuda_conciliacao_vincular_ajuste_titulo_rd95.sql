-- RD-95 (#5672): "?" (AjudaCampo) do novo campo "A qual título pertence este ajuste?" no modal
-- Vincular vários (src/components/conciliacao/VincularVariosModal.tsx). Com 2+ títulos vinculados e um
-- acréscimo/desconto, o operador agora ESCOLHE a qual título o ajuste pertence (âncora); antes o encargo
-- caía sempre no título de MAIOR valor (fn_conciliacao_fechar_agrupado, order by valor_vinculado desc).
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). rota = pathname real onde o modal renderiza.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, vertical, ordem, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('financeiro.conciliacao.vincular_ajuste_titulo',
   '/dashboard/financeiro/conciliacao/inbox', 'Conciliação', 'Título do ajuste (vincular vários)', 'financeiro', 23,
   'Quando há 2 ou mais títulos vinculados e você registrou um acréscimo (juros/multa) ou um desconto, escolha a qual desses títulos o ajuste pertence.',
   'Garante que o encargo ou o desconto entre no título certo. Se não escolher, o sistema joga o ajuste no título de maior valor, o que pode deixar outro título com o encargo errado.',
   '3 boletos do mesmo cliente, só o de 10/03 veio com R$ 5 de juros: registre o acréscimo 5,00 e selecione o título de 10/03.',
   'Deixar sem escolher com vários títulos — o acréscimo/desconto acaba no título de maior valor, não no que realmente teve o encargo.')
ON CONFLICT (chave) DO NOTHING;
