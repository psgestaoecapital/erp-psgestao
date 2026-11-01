-- Hub · Clientes (tela 272) — RD-95: cada indicador do selo comercial do cliente ganha o SEU "?" (auditor FC 27/10).
-- Antes os 7 selos (funil, em aberto, ganhas, propostas, visitas, obras, ganhas sem obra) dividiam uma única chave
-- (projetos.clientes.comercial). Agora cada um tem a sua ajuda. SÓ ADITIVO (linhas novas em erp_ajuda_campo).
-- Faixa 52 (desenvolvedor_4_g).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/clientes', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.clientes.comercial.funil', 'Comercial', 'Funil', 'Calculado: a etapa mais avançada do funil entre as oportunidades em aberto do cliente.', 'Mostra em que ponto da negociação o cliente está, sem abrir o pipeline.', 'Funil: Proposta enviada', 'Confundir com oportunidade ganha: o funil é só das oportunidades ainda em aberto.', 60),
  ('projetos.clientes.comercial.em_aberto', 'Comercial', 'Em aberto', 'Calculado: quantas oportunidades do cliente estão em aberto e a soma do valor delas.', 'É o quanto de negócio ainda está em jogo com este cliente.', '2 em aberto · R$ 85 mil', 'Somar com as ganhas: aqui é só o que ainda não fechou.', 61),
  ('projetos.clientes.comercial.ganhas', 'Comercial', 'Ganhas', 'Calculado: quantas oportunidades do cliente foram ganhas.', 'Mostra o histórico de fechamento do cliente.', '3 ganhas', 'Ganha nem sempre virou obra — veja o selo "ganha sem obra".', 62),
  ('projetos.clientes.comercial.propostas', 'Comercial', 'Propostas', 'Calculado: quantas propostas (orçamentos) o cliente tem.', 'Mede o esforço comercial já feito para o cliente.', '4 propostas', 'Proposta não é venda fechada: é o orçamento enviado.', 63),
  ('projetos.clientes.comercial.visitas', 'Comercial', 'Visitas', 'Calculado: quantas visitas técnicas o cliente teve.', 'Mostra o relacionamento de campo com o cliente.', '2 visitas', 'Visita sem oportunidade ligada não aparece no funil.', 64),
  ('projetos.clientes.comercial.obras', 'Comercial', 'Obras', 'Calculado: quantas obras o cliente tem no Hub.', 'Liga o cliente à execução — quantas obras já viraram realidade.', '1 obra', 'Cliente com venda ganha e 0 obra: a obra ainda não foi aberta (veja "ganha sem obra").', 65),
  ('projetos.clientes.comercial.ganhas_sem_obra', 'Comercial', 'Ganhas sem obra', 'Calculado: oportunidades ganhas que ainda não viraram obra.', 'Alerta de venda fechada parada: abra a obra no detalhe do cliente para não perder a execução.', '1 ganha sem obra', 'Ignorar o alerta: a venda fechada fica sem obra, sem orçamento e fora do Resultado.', 66)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
