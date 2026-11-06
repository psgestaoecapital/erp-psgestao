-- Viagem · "?" (RD-95) da ação "Editar dados da viagem" na tela /dashboard/projetos/viagens —
-- desenvolvedor_4_g (faixa 52). Gap do auditor: "CRUD completo (editar) visível na listagem". A tela passa a
-- editar os dados da viagem aberta (colaborador, placa, obra, período, adiantamento, origem/destino) reusando a
-- fn_viagem_salvar; esta migration só acrescenta o texto de ajuda da nova ação.
-- ADITIVA: só insere um texto novo em erp_ajuda_campo (ON CONFLICT DO NOTHING); nada existente é alterado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.editar', 'Ações', 'Editar dados da viagem', 'Corrige os dados da viagem ainda aberta: colaborador, placa, obra principal, saída/volta, adiantamento, origem e destino.', 'Acertar um dado digitado errado sem precisar abrir outra viagem; os cupons já lançados continuam valendo.', 'Trocar a placa de ABC1D23 para ABC1E45 porque o veículo mudou antes da saída', 'Mudar o período para fora da data de um cupom já lançado: o sistema recusa. Viagem fechada não se altera — reabra um novo acerto.', 31)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
