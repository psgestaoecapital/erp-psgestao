-- #9929 (Gean) · RD-95 · chaves de ajuda ("?") dos campos de ICMS POR ITEM da NF-e avulsa
-- (/dashboard/fiscal/nfe/remessa). Companheira da PR de front #6038 (impostos do ICMS por item).
-- Aditiva e idempotente (RD-52): INSERT ... WHERE NOT EXISTS por chave; roda de novo sem duplicar.
-- Não altera nenhuma chave existente. Sem dado de cliente. RD-100: sem nome de sistema de terceiros.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum,
       v.vertical, v.ordem, v.versao, v.status
FROM (VALUES
  ('fiscal.nfe_avulsa.item_icms', '/dashboard/fiscal/nfe/remessa', 'NF-e avulsa',
   'Impostos do item — ICMS',
   'Abra o painel (ícone %) para informar o ICMS só deste item. Deixe em branco para o item seguir o "ICMS da operação" da nota ou o cadastro do produto.',
   'Permite destacar o ICMS de um item específico da nota avulsa (por exemplo, uma devolução que devolve o imposto), levando CST/CSOSN, base, alíquota e valor para o XML da NF-e.',
   'Devolução de uma peça comprada com ICMS: informe a base e o valor da nota de compra para devolver o crédito.',
   'Preencher imposto por item numa remessa simples que não destaca ICMS — nesse caso deixe em branco.',
   'fiscal', 21, 1, 'publicado'),
  ('fiscal.nfe_avulsa.item_icms_cst', '/dashboard/fiscal/nfe/remessa', 'NF-e avulsa',
   'CST/CSOSN do item',
   'Escolha o código do ICMS deste item. "Do ICMS da operação" usa o que foi escolhido para a nota inteira.',
   'Empresa do Simples usa CSOSN; empresa do regime normal usa CST. É o código que vai no ICMS do item na NF-e.',
   'Simples: 900 (outros). Regime normal: 00 ou 90, conforme a contabilidade.',
   'Usar um CSOSN de venda (101/102) numa remessa ou devolução.',
   'fiscal', 22, 1, 'publicado'),
  ('fiscal.nfe_avulsa.item_icms_base', '/dashboard/fiscal/nfe/remessa', 'NF-e avulsa',
   'Base de cálculo do ICMS',
   'Valor sobre o qual o ICMS é calculado neste item. Deixe em branco quando a operação não destaca imposto.',
   'É a base do ICMS que vai no XML. Normalmente igual ao valor do item, salvo redução de base orientada pela contabilidade.',
   'Item de R$ 1.000,00 com base cheia: 1000,00.',
   'Informar o valor do ICMS sem a base: a nota pode ser rejeitada.',
   'fiscal', 23, 1, 'publicado'),
  ('fiscal.nfe_avulsa.item_icms_aliquota', '/dashboard/fiscal/nfe/remessa', 'NF-e avulsa',
   'Alíquota do ICMS (%)',
   'Percentual de ICMS do item (por exemplo 12, 17 ou 18), conforme a UF e a operação.',
   'Serve para conferir o ICMS do item. O valor do ICMS também pode ser informado direto no campo ao lado.',
   'Operação interna a 17%: digite 17.',
   'Alíquota acima de 100% ou negativa.',
   'fiscal', 24, 1, 'publicado'),
  ('fiscal.nfe_avulsa.item_icms_valor', '/dashboard/fiscal/nfe/remessa', 'NF-e avulsa',
   'Valor do ICMS',
   'Valor em reais do ICMS deste item. Deixe em branco quando não há imposto a destacar.',
   'É o valor do ICMS que vai no XML da NF-e para este item.',
   'Base 1.000,00 a 17% resulta em 170,00.',
   'Informar o valor sem a base de cálculo correspondente.',
   'fiscal', 25, 1, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
