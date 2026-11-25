-- #11321 · Reenquadra o texto de ajuda ("?") dos toggles de Lei 12.741 — frase limpa e corrida
-- (as chaves foram criadas em 20261127000130). Só texto; idempotente (UPDATE de valores fixos).
UPDATE public.erp_ajuda_campo SET
  o_que_preencher = 'Mostra o valor aproximado dos tributos (Lei 12.741) nas notas. Só aparece em vendas a CONSUMIDOR FINAL — em nota a contribuinte não sai.',
  para_que_serve  = 'No Simples, usa o percentual cadastrado (ex.: 11,5%); no regime normal, usa a tabela/token do IBPT.',
  exemplo         = 'Loja que vende ao consumidor liga para cumprir a Lei 12.741.',
  erro_comum      = 'Esperar o valor em toda nota — ele só sai em venda a consumidor final.'
WHERE chave = 'fiscal.config.lei12741_ativo';

UPDATE public.erp_ajuda_campo SET
  o_que_preencher = 'Usa o token/tabela de IBPT da própria empresa no cálculo. Só no regime normal e com o token configurado.',
  para_que_serve  = 'Sem isto, as notas usam a tabela genérica do IBPT.',
  exemplo         = 'Empresa do regime normal que gerou e testou o token liga para usar as alíquotas dela.',
  erro_comum      = 'Tentar ligar sem o token configurado/testado, ou no Simples (que usa o percentual).'
WHERE chave = 'fiscal.config.ibpt_empresa_nas_notas';
