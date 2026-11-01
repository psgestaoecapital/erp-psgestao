-- Viagem · "nada irreversível sem prévia e desfazer" (auditor 24/10, gap RD-95 da tela · desenvolvedor_4_g, faixa 52).
-- Só aditivo: uma função nova para DESFAZER a exclusão de um lançamento e os "?" da prévia do fechamento. Nada existente
-- muda (fn_viagem_lancamento_excluir continua marcando excluido_em; a prévia do fechamento só lê a v_viagem_custo_obra).
--
--   Desfazer: devolve o lançamento que a PRÓPRIA pessoa excluiu há no máximo 15 minutos, com a viagem ainda aberta.
--   Viagem fechada não se altera (o GE já recebeu o acerto); perfil de consulta não grava (fn_viagem_pode_gravar).
CREATE OR REPLACE FUNCTION public.fn_viagem_lancamento_restaurar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_l public.erp_viagem_lancamento%ROWTYPE; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para desfazer'); END IF;
  SELECT * INTO v_l FROM public.erp_viagem_lancamento WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_l.excluido_em IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento não está excluído'); END IF;
  PERFORM public.fn__guarda_empresa(v_l.company_id);
  IF NOT public.fn_viagem_pode_gravar(v_l.company_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Perfil de consulta não altera viagens'); END IF;
  IF v_l.excluido_por IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só quem excluiu pode desfazer'); END IF;
  IF v_l.excluido_em < now() - interval '15 minutes' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Passou o prazo de 15 minutos para desfazer'); END IF;
  SELECT status INTO v_status FROM public.erp_viagem WHERE id = v_l.viagem_id;
  IF v_status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem fechada não se altera'); END IF;
  UPDATE public.erp_viagem_lancamento SET excluido_em = NULL, excluido_por = NULL WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_lancamento_restaurar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_lancamento_restaurar(uuid) TO authenticated, service_role;

-- "?" da prévia do fechamento e do desfazer (RD-95), em linguagem de quem está na estrada
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.previa_fechar', 'Fechamento', 'Prévia do fechamento', 'Nada a preencher: confira o total, o saldo com o colaborador e quanto vai para cada obra antes de confirmar.', 'Fechar não tem volta: o GE recebe o acerto e a viagem fica travada. A prévia mostra exatamente o que será lançado.', 'Total R$ 1.240,00 · reembolsar R$ 140,00 · Obra 012 R$ 900,00 · Obra 015 R$ 340,00', 'Confirmar sem olhar a obra de cada cupom: o custo cai na obra errada do Resultado.', 60),
  ('projetos.viagem.previa_obra', 'Fechamento', 'Vai para a obra', 'Calculado: o que cada obra recebe desta viagem — os cupons lançados nela mais a parte dela no que é da viagem toda (combustível, pedágio).', 'É o mesmo valor que aparece no Resultado da obra depois de fechar.', 'Obra 012 · R$ 900,00', 'Cupom lançado na obra principal por engano: volte, exclua e lance de novo na obra certa.', 61),
  ('projetos.viagem.previa_confirmar', 'Fechamento', 'Confirmar fechamento', 'Toque só depois de conferir a prévia.', 'Fecha a viagem e manda o acerto ao GE (reembolso ou devolução do adiantamento).', 'Conferi: confirmar', 'Fechar com cupom faltando: a viagem fechada não aceita mais lançamento.', 62),
  ('projetos.viagem.desfazer_exclusao', 'Lançamentos', 'Desfazer exclusão', 'Toque logo depois de excluir um cupom por engano.', 'Devolve o lançamento como estava. Vale por 15 minutos, só para quem excluiu e com a viagem aberta.', 'Excluiu o cupom do posto errado: desfazer', 'Esperar mais de 15 minutos ou fechar a viagem: aí é preciso lançar o cupom de novo.', 63)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
