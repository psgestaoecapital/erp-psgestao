-- Hub · /dashboard/projetos/calculadora — delta até 95 (aud8/Max 27/10, caixa df0449fd · Code: desenvolvedor_4_g)
-- Foto DEMO 0006 13:41Z: visual 94 (selo "Fórmula validada (NBR)", "O que comprar" com custo por item,
-- exports completos, "Adicionar à proposta", "?" em tudo). Deltas p/ fechar o quad:
--   (bug) valor da linha "Montante M70..." cortado em "O que comprar" -> corrigido no FRONT (min-w-0/shrink-0).
--   RD-98 pilar 3 (ORIGEM): rota estava sem views_consumidas/rpcs_chamadas em system_screens (vazios).
--   RD-98 pilar 4 (EXCLUSÃO RASTREÁVEL): "Cálculos anteriores" só tinha INSERT, sem exclusão — adiciona
--     soft-delete rastreável (excluido_em/excluido_por) + desfazer de 15 min, no mesmo padrão de fn_viagem_excluir.
--
-- Migration ADITIVA (RD-94.1 c): colunas NOVAS + funções NOVAS com guarda de empresa + GRANT/REVOKE; nenhuma
-- função/RLS/view existente é tocada e nenhum dado de cliente é apagado.

-- RD-98 p4: colunas de exclusão rastreável em erp_calc_historico (aditivas)
ALTER TABLE public.erp_calc_historico
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE INDEX IF NOT EXISTS idx_calc_historico_vivos
  ON public.erp_calc_historico (company_id, criado_em DESC)
  WHERE excluido_em IS NULL;

-- Soft-delete do cálculo salvo (só da própria empresa; guarda de empresa como em fn_viagem_excluir)
CREATE OR REPLACE FUNCTION public.fn_calc_historico_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.erp_calc_historico%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO v FROM public.erp_calc_historico WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cálculo não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  UPDATE public.erp_calc_historico SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Desfazer a exclusão em até 15 min, só por quem excluiu (igual à viagem)
CREATE OR REPLACE FUNCTION public.fn_calc_historico_restaurar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.erp_calc_historico%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para desfazer'); END IF;
  SELECT * INTO v FROM public.erp_calc_historico WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.excluido_em IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cálculo não está excluído'); END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  IF v.excluido_por IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só quem excluiu pode desfazer'); END IF;
  IF v.excluido_em < now() - interval '15 minutes' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Passou o prazo de 15 minutos para desfazer'); END IF;
  UPDATE public.erp_calc_historico SET excluido_em = NULL, excluido_por = NULL WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_calc_historico_excluir(uuid)   FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_calc_historico_restaurar(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_calc_historico_excluir(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_calc_historico_restaurar(uuid) TO authenticated;

-- RD-95: "?" nos dois novos controles da seção "Cálculos anteriores"
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cálculos anteriores', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/projetos/calculadora', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.calculadora.excluir_calculo','Excluir cálculo','Não se preenche. É a ação de remover um cálculo salvo da lista.','Tira da lista um cálculo que não serve mais; some em todas as telas, mas fica recuperável por 15 minutos pelo "Desfazer".','Excluir um cálculo de teste','Achar que some de vez: é exclusão reversível (soft-delete), com quem excluiu e quando registrados.',401),
 ('projetos.calculadora.desfazer_calculo','Desfazer exclusão','Não se preenche. É o atalho para trazer de volta o cálculo que você acabou de excluir.','Recupera o último cálculo excluído, dentro de 15 minutos, só por quem excluiu.','Cliquei em Excluir sem querer → Desfazer','Esperar demais: depois de 15 minutos o Desfazer não vale mais.',402)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical, status = EXCLUDED.status;

-- RD-98 p3: origem do dado de src/app/dashboard/projetos/calculadora/* (grep: .from + sb.rpc)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'erp_produtos',           -- estoque p/ vincular item -> produto (custo real)
        'erp_calc_depara',        -- de-para item do cálculo x produto por sistema
        'erp_calc_historico',     -- cálculos salvos ("Cálculos anteriores")
        'erp_calc_regra',         -- regras/coeficientes por empresa (EditorRegras)
        'erp_orcamentos',         -- propostas em rascunho (destino do cálculo)
        'erp_orcamentos_itens'    -- itens enviados do cálculo para a proposta
       ]::text[],
       rpcs_chamadas = ARRAY[
        'fn_calc_regra_salvar',        -- salvar regra própria da empresa
        'fn_calc_regra_restaurar',     -- restaurar regra padrão
        'fn_calc_historico_excluir',   -- soft-delete de cálculo salvo (RD-98 p4)
        'fn_calc_historico_restaurar'  -- desfazer exclusão (15 min)
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/calculadora';
