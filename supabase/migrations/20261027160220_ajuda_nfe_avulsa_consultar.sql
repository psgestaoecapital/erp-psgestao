-- #3861 (jordana-code 26/10): "?" do botão "Consultar agora" da NF-e avulsa (RD-95, ajuste do gilberto-revisor na #3258).
-- Só acrescenta a chave de ajuda; não mexe em nota, cálculo nem permissão.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES (
  'fiscal.nfe_avulsa.consultar', 'NF-e avulsa', 'Consultar agora',
  'Aparece quando a SEFAZ demora a responder. Toque para perguntar de novo o resultado da nota que já foi enviada.',
  'Atualiza o status (autorizada ou rejeitada) sem enviar a nota outra vez, então não gera nota duplicada.',
  'A nota ficou "aguardando SEFAZ" por alguns minutos: toque em Consultar agora.',
  'Emitir a nota de novo em vez de consultar: isso pode gerar duas notas para a mesma remessa.',
  17, '/dashboard/fiscal/nfe/remessa', 'fiscal', 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
