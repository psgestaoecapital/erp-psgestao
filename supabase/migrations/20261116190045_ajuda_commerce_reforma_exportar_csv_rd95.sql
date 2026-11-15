-- RD-95: "?" da nova ação "Exportar CSV" da tela /dashboard/commerce/reforma.
-- Code: desenvolvedor_4_g
-- Aditiva e idempotente (ON CONFLICT na chave única). Não altera dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'commerce.reforma.exportar_csv',
  '/dashboard/commerce/reforma',
  'Reforma Tributária',
  'Exportar CSV',
  'Nada a preencher — é um botão. Baixa uma planilha (.csv) com o IBS e a CBS que já vieram nas suas compras, mês a mês, e o total.',
  'Serve para levar esses números para fora do ERP — abrir no Excel/Planilhas ou mandar para o contador — sem redigitar nada.',
  'Clicar em "Exportar CSV" baixa o arquivo reforma_ibs_cbs.csv com uma linha por mês (IBS, CBS, IBS+CBS) e a linha TOTAL.',
  'Esperar imposto a pagar: o arquivo traz o que VEIO destacado nas compras, não uma previsão de carga futura.',
  'commerce',
  40,
  'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  grupo = EXCLUDED.grupo,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  status = EXCLUDED.status,
  atualizado_em = now();
