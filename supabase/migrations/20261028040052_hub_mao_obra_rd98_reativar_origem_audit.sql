-- Hub · Mão de obra · RD-98 (dev desenvolvedor_4_g, faixa 52)
-- Fecha a tela /dashboard/projetos/mao-obra (delta aud8/Max 27/10):
--   • Pilar 3 (ORIGEM DO DADO): preenche system_screens.views_consumidas (estava VAZIO) com as views/tabelas que a
--     página realmente lê, e acrescenta o novo RPC de reativação em rpcs_chamadas.
--   • Pilar 4 (EXCLUSÃO RASTREÁVEL): o encerrar (soft via ativo=false + vigencia_fim — o padrão adotado nesta tela, pois
--     um desligamento é um evento DATADO, não um "lixo") passa a gravar QUEM encerrou (ajuste_por/ajuste_em) e um
--     registro em audit_log_global; e ganha o espelho fn_mao_obra_ficha_reativar (RESTAURAR), também auditado.
--   • fn_mao_obra_listar devolve também as fichas ENCERRADAS (a listagem padrão continua só com as ativas,
--     vigencia_fim IS NULL), para a tela oferecer o Restaurar sem expor encerradas no custo.
-- Migration ADITIVA de metadado + 1 função nova + CREATE OR REPLACE de 2 funções da própria tela (via expressa do Hub).
-- RD-38: todos os objetos abaixo foram conferidos no banco (existem e são lidos de fato pela página/RPCs).

-- 1) ENCERRAR: mesmo comportamento, agora com QUEM (ajuste_por/ajuste_em) + audit_log_global ------------------------
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_encerrar(p_ficha_id uuid, p_data date DEFAULT CURRENT_DATE, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a record; v_data date := COALESCE(p_data, current_date);
BEGIN
  SELECT * INTO a FROM erp_mao_obra_custo WHERE id = p_ficha_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  PERFORM public.fn__mao_obra_exige_gestor(a.company_id);
  IF a.vigencia_fim IS NOT NULL OR NOT a.ativo THEN RAISE EXCEPTION 'Esta ficha já está encerrada.'; END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo (desligamento ou inativação).'; END IF;
  UPDATE erp_mao_obra_custo SET vigencia_fim = GREATEST(v_data, vigencia_inicio), ativo = false,
         ajuste_por = auth.uid(), ajuste_em = now(),
         motivo = concat_ws(' · ', motivo, (CASE WHEN a.tipo = 'pessoa' THEN 'desligado: ' ELSE 'inativado: ' END) || btrim(p_motivo))
   WHERE id = p_ficha_id;
  IF a.tipo = 'pessoa' THEN
    UPDATE compliance_funcionarios SET data_demissao = v_data, ativo = false, updated_at = now() WHERE id = a.funcionario_id;
  END IF;
  -- RD-98 pilar 4: rastro de quem encerrou (além do vigencia_fim/motivo na própria ficha)
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (a.company_id, auth.uid(), 'erp_mao_obra_custo', p_ficha_id::text,
            CASE WHEN a.tipo = 'pessoa' THEN 'desligar' ELSE 'inativar' END,
            jsonb_build_object('vigencia_fim', GREATEST(v_data, a.vigencia_inicio), 'motivo', btrim(p_motivo)));
  PERFORM public.fn__mao_obra_sync_catalogo(a.funcao_id);
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 2) REATIVAR: espelho do encerrar — tira do histórico e devolve ao custo, auditado --------------------------------
CREATE OR REPLACE FUNCTION public.fn_mao_obra_ficha_reativar(p_ficha_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM erp_mao_obra_custo WHERE id = p_ficha_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  PERFORM public.fn__mao_obra_exige_gestor(a.company_id);
  IF a.ativo AND a.vigencia_fim IS NULL THEN RAISE EXCEPTION 'Esta ficha já está ativa.'; END IF;
  -- nunca pode haver duas fichas ativas no mesmo grupo (pessoa/perfil) — evita custo duplicado
  IF EXISTS (SELECT 1 FROM erp_mao_obra_custo o WHERE o.grupo_id = a.grupo_id AND o.id <> a.id AND o.ativo AND o.vigencia_fim IS NULL) THEN
    RAISE EXCEPTION 'Já existe uma ficha ativa desta pessoa/perfil — encerre a atual antes de restaurar esta.';
  END IF;
  UPDATE erp_mao_obra_custo SET vigencia_fim = NULL, ativo = true,
         ajuste_por = auth.uid(), ajuste_em = now(),
         motivo = concat_ws(' · ', motivo, 'reativado' || CASE WHEN length(btrim(COALESCE(p_motivo, ''))) >= 1 THEN ': ' || btrim(p_motivo) ELSE '' END)
   WHERE id = p_ficha_id;
  IF a.tipo = 'pessoa' THEN
    UPDATE compliance_funcionarios SET data_demissao = NULL, ativo = true, updated_at = now() WHERE id = a.funcionario_id;
  END IF;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (a.company_id, auth.uid(), 'erp_mao_obra_custo', p_ficha_id::text, 'reativar',
            jsonb_build_object('reativado_em', now(), 'motivo', NULLIF(btrim(COALESCE(p_motivo, '')), '')));
  PERFORM public.fn__mao_obra_sync_catalogo(a.funcao_id);
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_reativar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_reativar(uuid, text) TO authenticated;

-- 3) LISTAR: devolve também as fichas ENCERRADAS (padrão continua só ativas) para a tela oferecer Restaurar ---------
CREATE OR REPLACE FUNCTION public.fn_mao_obra_listar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pode boolean; v_enc jsonb; v_funcoes jsonb; v_equipe jsonb; v_encerradas jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  v_pode := public.fn__mao_obra_pode_ver_individual(p_company_id);
  v_enc := public.fn_mao_obra_encargos_vigentes(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'cbo', f.cbo, 'forma_pagamento', f.forma_pagamento, 'unidade_producao', f.unidade_producao,
           'custo_hora_manual', f.custo_hora_manual, 'he50_horas_padrao', f.he50_horas_padrao, 'he100_horas_padrao', f.he100_horas_padrao, 'custo_hora_usa_he', f.custo_hora_usa_he, 'unida_a_id', f.unida_a_id, 'ativo', f.ativo,
           'unida_a_nome', (SELECT u.nome FROM erp_funcao_mao_obra u WHERE u.id = f.unida_a_id),
           'migrada_de', f.projetos_mao_obra_id, 'custo', public.fn_funcao_custo_hora(f.id),
           -- LGPD: salário sugerido só para quem vê salário (média de poucas pessoas revelaria o salário de alguém)
           'salario_sugerido', CASE WHEN v_pode THEN public.fn__mao_obra_salario_sugerido(f.id, v_enc) END) ORDER BY f.ativo DESC, f.nome), '[]'::jsonb)
    INTO v_funcoes FROM erp_funcao_mao_obra f WHERE f.company_id = p_company_id;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'nome'), '[]'::jsonb) INTO v_equipe FROM (
    SELECT jsonb_build_object('id', k.id, 'grupo_id', k.grupo_id, 'tipo', k.tipo, 'funcionario_id', k.funcionario_id,
      'nome', CASE WHEN k.tipo = 'pessoa' THEN cf.nome_completo ELSE COALESCE(k.descricao, fn.nome || ' (perfil padrão)') END,
      'funcao_id', k.funcao_id, 'funcao', fn.nome, 'vinculo', k.vinculo, 'forma_pagamento', k.forma_pagamento, 'setor', COALESCE(k.setor, cf.setor),
      'quantidade_pessoas', k.quantidade_pessoas, 'horas_produtivas_mes', k.horas_produtivas_mes,
      'vigencia_inicio', k.vigencia_inicio, 'conferido', k.conferido, 'conferido_em', k.conferido_em, 'ativo', k.ativo,
      'matricula', cf.matricula, 'data_admissao', cf.data_admissao, 'chaves_confirmadas', k.chaves_confirmadas_em IS NOT NULL,
      'ficha', CASE WHEN v_pode THEN public.fn__mao_obra_ficha_json(k.id) - ARRAY['company_id', 'created_by', 'conferido_por', 'ajuste_por', 'chaves_confirmadas_por'] END,
      'ajuste_por_nome', CASE WHEN v_pode AND k.ajuste_por IS NOT NULL THEN (SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) FROM users u WHERE u.id = k.ajuste_por) END,
      'custo', CASE WHEN v_pode THEN public.fn_mao_obra_custo_calcular(public.fn__mao_obra_ficha_json(k.id), public.fn_mao_obra_encargos_vigentes(k.company_id)) END) x
    FROM erp_mao_obra_custo k
    JOIN erp_funcao_mao_obra fn ON fn.id = k.funcao_id
    LEFT JOIN compliance_funcionarios cf ON cf.id = k.funcionario_id
   WHERE k.company_id = p_company_id AND k.vigencia_fim IS NULL) z;
  -- fichas encerradas (vigencia_fim preenchida): só identificação e motivo, sem custo — para oferecer Restaurar
  SELECT COALESCE(jsonb_agg(y ORDER BY y->>'vigencia_fim' DESC), '[]'::jsonb) INTO v_encerradas FROM (
    SELECT jsonb_build_object('id', k.id, 'grupo_id', k.grupo_id, 'tipo', k.tipo,
      'nome', CASE WHEN k.tipo = 'pessoa' THEN cf.nome_completo ELSE COALESCE(k.descricao, fn.nome || ' (perfil padrão)') END,
      'funcao', fn.nome, 'vinculo', k.vinculo, 'vigencia_inicio', k.vigencia_inicio, 'vigencia_fim', k.vigencia_fim,
      'motivo', k.motivo, 'quantidade_pessoas', k.quantidade_pessoas,
      'ajuste_por_nome', CASE WHEN k.ajuste_por IS NOT NULL THEN (SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) FROM users u WHERE u.id = k.ajuste_por) END) y
    FROM erp_mao_obra_custo k
    JOIN erp_funcao_mao_obra fn ON fn.id = k.funcao_id
    LEFT JOIN compliance_funcionarios cf ON cf.id = k.funcionario_id
   WHERE k.company_id = p_company_id AND k.vigencia_fim IS NOT NULL) w;
  IF v_pode AND auth.uid() IS NOT NULL THEN
    INSERT INTO erp_mao_obra_acesso_log (company_id, user_id, ficha_id, grupo_id, origem)
    SELECT k.company_id, auth.uid(), k.id, k.grupo_id, 'lista' FROM erp_mao_obra_custo k
     WHERE k.company_id = p_company_id AND k.vigencia_fim IS NULL;
  END IF;
  RETURN jsonb_build_object('pode_ver_individual', v_pode, 'encargos', v_enc, 'funcoes', v_funcoes, 'equipe', v_equipe, 'encerradas', v_encerradas);
END $function$;

-- 4) RD-98 pilar 3: ORIGEM DO DADO em system_screens (views estavam VAZIAS) ----------------------------------------
UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_projetos_mao_obra_ui','erp_mao_obra_custo','erp_funcao_mao_obra','erp_mao_obra_componente','projetos_mao_obra']::text[],
       rpcs_chamadas = ARRAY['fn_mao_obra_listar','fn_mao_obra_funcoes_modelo','fn_mao_obra_funcao_salvar','fn_mao_obra_funcao_unir','fn_mao_obra_ficha_salvar','fn_mao_obra_ficha_conferir','fn_mao_obra_ficha_reajustar','fn_mao_obra_ficha_encerrar','fn_mao_obra_ficha_reativar','fn_mao_obra_ficha_historico','fn_mao_obra_encargos_salvar']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/mao-obra';

-- 5) RD-95: "?" da ação Restaurar (as demais reaproveitam chaves já existentes) -------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES ('projetos.mao_obra.acao.restaurar', '/dashboard/projetos/mao-obra', 'Mão de obra', 'Restaurar',
        'Clique para reativar uma ficha encerrada por engano.',
        'Devolve a pessoa (ou o perfil) ao custo da hora da função, a partir de hoje.',
        'Restaurar o gesseiro desligado por engano na semana passada.',
        'Restaurar com outra ficha ativa da mesma pessoa — o sistema avisa e não deixa custo em dobro.',
        'hub_projetos', 215)
ON CONFLICT (chave) DO UPDATE SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, atualizado_em = now();

-- 6) SEED DEMO 006: uma ficha JÁ ENCERRADA (perfil, sem custo ativo) para a tela demonstrar o Restaurar na foto do
-- auditor. Idempotente (NOT EXISTS pela descrição) e só afeta a empresa DEMO; fn_demo_reset não toca em mão de obra.
INSERT INTO public.erp_mao_obra_custo (company_id, tipo, funcao_id, descricao, salario, horas_produtivas_mes,
    quantidade_pessoas, vigencia_inicio, vigencia_fim, ativo, conferido, motivo)
SELECT p.c, 'perfil', f.id, 'Ajudante de obra (exemplo — inativado)', 1800, 176, 1,
       DATE '2026-01-02', DATE '2026-09-30', false, true,
       'inativado: exemplo para demonstrar o Restaurar (RD-98 exclusão rastreável)'
  FROM (SELECT 'b0700000-0000-4000-a000-000000000006'::uuid AS c) p
  JOIN LATERAL (SELECT id FROM public.erp_funcao_mao_obra WHERE company_id = p.c AND ativo ORDER BY nome LIMIT 1) f ON true
 WHERE NOT EXISTS (SELECT 1 FROM public.erp_mao_obra_custo e
                    WHERE e.company_id = p.c AND e.tipo = 'perfil' AND e.descricao = 'Ajudante de obra (exemplo — inativado)');

-- Permissões (gate check-fn-guards): a função não fica aberta ao anon nem ao PUBLIC.
REVOKE ALL ON FUNCTION public.fn_mao_obra_ficha_encerrar(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_ficha_encerrar(uuid, date, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_mao_obra_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_listar(uuid) TO authenticated;
