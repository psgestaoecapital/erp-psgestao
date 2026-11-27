-- #11321 · Ajuda (RD-95) dos toggles de Lei 12.741 / tributos aproximados na Configuração Fiscal.
-- Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING). As colunas lei12741_ativo e ibpt_empresa_nas_notas já
-- existem; esta migration só cadastra o texto do "?" dos dois interruptores.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT v.chave, '/dashboard/configuracoes/fiscal', 'Configuração Fiscal', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, 'fiscal', v.ordem, 1, 'publicado'
FROM (VALUES
  ('fiscal.config.lei12741_ativo', 'Mostrar os tributos aproximados nas notas (Lei 12.741)',
   'Ligue para que a nota mostre o "valor aproximado dos tributos" (Lei 12.741/2012). Desligue para não mostrar.',
   'Acrescenta nas informações complementares da NF-e e da NFS-e o valor aproximado dos tributos. No Simples, usa o percentual aproximado cadastrado nesta tela; no regime normal, usa a tabela do IBPT (ou o token da empresa, se você ligar o controle abaixo).',
   'Loja que vende ao consumidor liga para cumprir a Lei 12.741 ("De olho no imposto").',
   'Esperar o valor em TODA nota: por lei ele só aparece em nota a CONSUMIDOR FINAL. Em nota a contribuinte (revenda) não sai — e isso é o correto.',
   10),
  ('fiscal.config.ibpt_empresa_nas_notas', 'Usar o token da empresa nas notas',
   'Ligue para as notas usarem as alíquotas do token do IBPT desta empresa (em vez da tabela genérica). Só aparece no regime normal e só habilita depois de o token ser configurado e testado com uma consulta OK.',
   'Faz o "valor aproximado dos tributos" sair com as alíquotas do próprio token da empresa, mais aderentes que a tabela genérica.',
   'Empresa do regime normal que gerou o token e testou com sucesso liga para usar as alíquotas dela.',
   'Tentar ligar sem token configurado/testado (fica desabilitado) ou no Simples (o Simples usa o percentual, não o token).',
   11)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
