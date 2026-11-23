-- #9929 (Gean Auto Mecânica · crítica) — "Emissão de nota avulsa deve ter campo informativo de impostos".
-- RD-95: chave de ajuda "?" do bloco INFORMATIVO de impostos (ICMS/IBS-CBS) do modal "Emitir NF-e (peças)" da OS.
-- Aditiva e idempotente (ON CONFLICT DO UPDATE). Não toca dado de cliente nem estrutura.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('oficina.os.nfe_impostos_informativo','/dashboard/os','Nota fiscal','Impostos da nota (informativo)',
   'Nada a preencher aqui — é um resumo só de leitura. Os impostos vêm da tributação de cada produto (CST/CSOSN, alíquotas e NCM do cadastro) e da operação da nota; para mudá-los, ajuste o cadastro do produto ou a configuração fiscal antes de emitir.',
   'Mostra, antes de emitir, os tributos que a NF-e vai carregar — por item o CST/CSOSN e a base e o valor do ICMS, e, quando a nota tiver, a base, o IBS e a CBS; no rodapé a soma. Assim dá para conferir os impostos sem precisar baixar o espelho em PDF. Os valores são os mesmos que seriam transmitidos à SEFAZ.',
   'Peça tributada no regime normal: CST 00, base R$ 100,00, ICMS R$ 18,00. No Simples (CSOSN 102) o ICMS da operação fica R$ 0,00 e o crédito aparece na informação complementar.',
   'ICMS R$ 0,00 não é erro: no Simples Nacional o imposto não destaca na nota. Substituição tributária (ST), quando o produto tem, já entra embutida conforme o cadastro fiscal do produto — confira o CST/CSOSN do produto se o valor não bater com o esperado.',
   'oficina', 70, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
