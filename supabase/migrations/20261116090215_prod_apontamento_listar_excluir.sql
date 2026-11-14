-- PDCA · /dashboard/produtividade/apontamento — RD-98 CRUD: um apontamento errado (posto/hora/qtd) não podia ser
-- CORRIGIDO nem REMOVIDO na tela (só havia lançar/relançar, que corrige a MESMA chave). A grade de confronto
-- agrega por posto×hora, então não dava para agir lançamento a lançamento. Esta migration adiciona:
--   • fn_prod_apontamento_listar: os lançamentos CRUS do dia (id, posto, produto, hora, qtd, unidade, pessoas, fonte)
--     para a tela mostrar "Lançamentos do dia" e permitir Editar (reabrir no formulário) e Excluir item a item;
--   • fn_prod_apontamento_excluir: exclusão RASTREÁVEL por id — valida empresa/planta, registra o valor anterior em
--     audit_log_global (quem/quando/o quê) e remove a linha.
--
-- ADITIVO (RD-97): só CRIA duas funções de leitura/exclusão novas e os textos de ajuda ("?"). NÃO cria/altera
-- tabela, RLS, grant de tabela nem função existente. Ambas STABLE/VOLATILE SECURITY DEFINER com a mesma guarda das
-- irmãs (fn_prod_assert_planta); anon sem EXECUTE. Faixa de segundos do dev7claudeps (:15), acima do ledger.

-- ============================================================ 1) LISTAR lançamentos crus do dia
CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_listar(
  p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_data date
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'posto_id', a.posto_id, 'posto_numero', po.numero, 'posto_atividade', po.atividade,
           'produto_id', a.produto_id, 'produto_codigo', pr.codigo, 'produto_nome', pr.nome,
           'hora', a.hora, 'qtd_produzida', a.qtd_produzida, 'unidade', a.unidade,
           'pessoas_presentes', a.pessoas_presentes, 'fonte', a.fonte
         ) ORDER BY po.numero NULLS LAST, a.hora, pr.codigo), '[]'::jsonb) INTO v
    FROM public.prod_apontamento_hora a
    LEFT JOIN public.prod_posto po ON po.id = a.posto_id
    LEFT JOIN public.prod_produto pr ON pr.id = a.produto_id
   WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id AND a.data = p_data;
  RETURN jsonb_build_object('ok', true, 'lancamentos', v);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_prod_apontamento_listar(uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontamento_listar(uuid, uuid, uuid, date) TO authenticated, service_role;

-- ============================================================ 2) EXCLUIR um lançamento (rastreável)
CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_excluir(
  p_company_id uuid, p_plant_id uuid, p_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_row public.prod_apontamento_hora%ROWTYPE;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT * INTO v_row FROM public.prod_apontamento_hora
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior)
  VALUES (p_company_id, auth.uid(), 'prod_apontamento_hora', p_id::text, 'delete', to_jsonb(v_row));

  DELETE FROM public.prod_apontamento_hora
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_prod_apontamento_excluir(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontamento_excluir(uuid, uuid, uuid) TO authenticated, service_role;

-- ============================================================ 3) RD-95 · textos de ajuda ("?") das ações novas
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/produtividade/apontamento', 'industria', 'publicado'
FROM (VALUES
 ('prod.apont.lancamentos', 'Lançamentos', 'Lançamentos do dia',
  'A lista do que já foi apontado neste dia e fluxo: posto, hora, produto e quantidade. É daqui que se corrige ou remove um lançamento.',
  'Permite agir lançamento a lançamento — a grade de confronto acima soma por posto e hora; aqui cada linha é um apontamento.',
  'Posto 12, 08h, Coxão mole, 320 kg.',
  'Procurar o lançamento na grade de confronto: lá os valores são somados; aqui cada linha pode ser editada ou excluída.', 200),
 ('prod.apont.editar', 'Lançamentos', 'Editar lançamento',
  'Reabre o lançamento no formulário acima com posto, produto, hora e quantidade preenchidos. Ajuste e lance de novo — o mesmo posto/produto/hora é corrigido, não duplicado.',
  'Corrige um apontamento errado (quantidade, fonte, pessoas) sem ter que recriar do zero.',
  'Lancei 230 e era 320: clico Editar, troco para 320 e lanço.',
  'Trocar o posto/hora por Editar: mudar a chave cria um novo lançamento — para corrigir a chave, exclua o errado e lance o certo.', 210),
 ('prod.apont.excluir', 'Lançamentos', 'Excluir lançamento',
  'Remove este lançamento do dia. A exclusão é registrada (quem, quando e o valor anterior) para auditoria.',
  'Tira um apontamento lançado por engano (posto, hora ou produto trocados) sem mexer nos demais.',
  'Lancei no posto errado: excluo e lanço no posto certo.',
  'Excluir para corrigir a quantidade: para só mudar o valor, use Editar e relance — a exclusão é para o que não deveria existir.', 220)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
