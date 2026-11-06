-- #2867 etapa 3 (rodrigo-code): RD-95 — ajuda do botão "Agendar serviço" da OS-orçamento. Aditiva (só dado de ajuda).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Ordem de Serviço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/os', 'oficina', 'publicado'
FROM (VALUES
  ('os.orcamento.agendar',
   'Agendar serviço',
   'Nada a preencher aqui: o botão abre a agenda da oficina já com o cliente, a placa e a observação do orçamento. Escolha o dia, a hora e o mecânico.',
   'Leva o orçamento aprovado para a agenda. Quando o veículo chegar, o operador faz a recepção e o checklist; o aviso "verifique o diagnóstico" lembra de conferir o serviço pedido.',
   'Cliente aprovou o orçamento por telefone: toque em "Agendar serviço", marque quinta às 9h e salve.',
   'Agendar antes de o cliente aprovar: mude o status da OS só depois da aprovação.',
   2)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
