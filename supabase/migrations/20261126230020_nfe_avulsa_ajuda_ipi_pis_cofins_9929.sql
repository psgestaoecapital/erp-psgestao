-- #9929 (jordana-manual) · NF-e avulsa: impostos IPI/PIS/COFINS por item (regime normal).
-- Só a ajuda RD-95 ("?") dos campos novos — a lógica é aditiva no código (builder + rota remessa + tela),
-- sem alterar o comportamento de quem não preencher. INSERTs idempotentes (não duplicam a chave).
-- Aditiva; não toca em dado de cliente. Faixa de segundos 20 (jordana), versão > última da main.
-- conserto-main (code-desenvolvedor-3, 25/11): status='ativo' violava erp_ajuda_campo_status_check
-- (só 'rascunho'/'publicado') e derrubava o deploy-migrations → as 10 linhas nunca aplicavam. Corrigido
-- para 'publicado' (como as 25 irmãs da tela) e vertical para 'fiscal' (as irmãs são todas 'fiscal').

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT v.chave, '/dashboard/fiscal/nfe/remessa', 'NF-e avulsa', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, 'fiscal', v.ordem, 1, 'publicado'
FROM (VALUES
  ('fiscal.nfe_avulsa.item_impostos_federais','IPI, PIS e COFINS do item',
   'Em branco, o item segue o cadastro do produto (sem mudança). Preencha para destacar IPI, PIS e COFINS deste item na NF-e. Só aparece no regime normal — no Simples Nacional esses tributos não são destacados na nota.',
   'Informar, por item, os tributos federais quando a operação exige destaque (ex.: venda no regime normal, CFOP 5.102/5.202).',
   'Peça no regime normal: PIS 1,65% e COFINS 7,6% sobre o valor do item; IPI conforme a TIPI do produto.',
   'No Simples Nacional não destaque PIS/COFINS/IPI aqui — use o CSOSN no bloco de ICMS.', 10),
  ('fiscal.nfe_avulsa.item_ipi_cst','CST do IPI',
   'Código da situação tributária do IPI (tabela da NF-e). Em branco, o item sai sem grupo de IPI.',
   'Define como o IPI entra na nota do item.', 'Saída tributada: 50. Saída isenta: 52.',
   'CST incompatível com a operação faz a SEFAZ rejeitar — confira a tabela do IPI.', 11),
  ('fiscal.nfe_avulsa.item_ipi_aliquota','Alíquota do IPI (%)',
   'Percentual do IPI do item. Em branco, sem IPI.', 'Calcula o IPI sobre o valor do item.',
   '3,25 para 3,25%.', 'Alíquota sem CST (ou vice-versa) pode gerar rejeição.', 12),
  ('fiscal.nfe_avulsa.item_ipi_valor','Valor do IPI (R$)',
   'Valor do IPI do item. Em branco, o provedor calcula por base × alíquota quando possível.',
   'Fecha o valor do IPI que vai na nota.', '32,50.', 'Valor que não bate com base × alíquota pode ser recusado.', 13),
  ('fiscal.nfe_avulsa.item_pis_cst','CST do PIS',
   'Código da situação tributária do PIS. Em branco, usa o cadastro do produto.',
   'Define como o PIS entra na nota do item.', 'Tributável (alíquota básica): 01.',
   'CST de PIS incompatível com o regime/operação é rejeitado.', 14),
  ('fiscal.nfe_avulsa.item_pis_aliquota','Alíquota do PIS (%)',
   'Percentual do PIS do item. Em branco, usa o cadastro do produto.', 'Calcula o PIS sobre o valor do item.',
   '1,65 para 1,65%.', 'Alíquota sem CST compatível pode gerar rejeição.', 15),
  ('fiscal.nfe_avulsa.item_pis_valor','Valor do PIS (R$)',
   'Valor do PIS do item. Em branco, calculado por base × alíquota quando possível.',
   'Fecha o valor do PIS da nota.', '16,50.', 'Valor que não bate com base × alíquota pode ser recusado.', 16),
  ('fiscal.nfe_avulsa.item_cofins_cst','CST da COFINS',
   'Código da situação tributária da COFINS. Em branco, usa o cadastro do produto.',
   'Define como a COFINS entra na nota do item.', 'Tributável (alíquota básica): 01.',
   'CST de COFINS incompatível é rejeitado.', 17),
  ('fiscal.nfe_avulsa.item_cofins_aliquota','Alíquota da COFINS (%)',
   'Percentual da COFINS do item. Em branco, usa o cadastro do produto.', 'Calcula a COFINS sobre o valor do item.',
   '7,6 para 7,6%.', 'Alíquota sem CST compatível pode gerar rejeição.', 18),
  ('fiscal.nfe_avulsa.item_cofins_valor','Valor da COFINS (R$)',
   'Valor da COFINS do item. Em branco, calculado por base × alíquota quando possível.',
   'Fecha o valor da COFINS da nota.', '76,00.', 'Valor que não bate com base × alíquota pode ser recusado.', 19)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
