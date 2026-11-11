-- RD-95: "?" do card combinado "Aprovar e confirmar" da Central de Melhorias (#7050 item 2).
-- Quando o operador/admin é o próprio autor do chamado, ele aprova a resposta e confirma o resultado
-- num passo só, sem abrir a Fila de Melhorias.
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo global de
-- ajuda (sem company_id, sem dado de cliente). NÃO cria/altera tabela nem função e não altera linha existente.
-- Code: rodrigo-code
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
 ('chamado.aprovar_e_confirmar','/dashboard/melhorias','Chamados','Aprovar e confirmar',
  'Aparece só quando VOCÊ abriu o chamado e tem papel de atendimento: a resposta da equipe ainda não foi liberada. Clique em "Aprovar e confirmar que funcionou" se a entrega resolveu, ou em "Aprovar e dizer que não funcionou" (diga o motivo) para reabrir.',
  'Junta num passo só a aprovação (interna, da Fila) e a sua confirmação (da Central): você não precisa abrir a Fila de Melhorias para liberar a própria resposta e já dizer se resolveu. Fica registrado quem aprovou e quando.',
  'Abri o chamado, a equipe respondeu, testei e funcionou: clico "Aprovar e confirmar que funcionou" e o chamado conclui.',
  'Confirmar que funcionou sem ter testado de verdade: a aprovação libera a resposta e conclui o chamado de uma vez.',
  2,'publicado')
ON CONFLICT (chave) DO NOTHING;
