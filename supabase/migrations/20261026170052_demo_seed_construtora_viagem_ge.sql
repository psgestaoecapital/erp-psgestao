-- Hub · semente da Construtora DEMO: lançar as viagens FECHADAS no GE (contas a pagar, centro de custo = obra), para a
-- demo PROVAR a conexão viagem → GE do fechamento (CEO 25/10, fechamento FC Pisos terça — caixa c3325b52 · desenvolvedor_4_g,
-- faixa 52). Até aqui a semente criava as viagens fechadas SEM título no contas a pagar (pagar_id NULL) — o custo já
-- aparecia no Resultado da obra (v_obra_resultado lê a v_viagem_custo_obra), mas o financeiro (reembolso/contas a pagar)
-- ficava vazio na demo. A rotina de fechamento real (fn_viagem_lancar_ge, migration 20261026110152) só roda quando o
-- usuário fecha a viagem na tela; as viagens da demo nascem fechadas pela semente e nunca passavam por ela.
--
-- SÓ ADITIVO + semente demo: função NOVA (fn_demo_seed_construtora_viagem_ge), só na empresa demo fixa do Hub (…0006) e
-- só se is_demo; sem GRANT a usuário. Nenhuma função ou tabela de produção muda. O lançamento reaproveita a função
-- canônica fn_viagem_lancar_ge (mesma conta do Resultado, confere 1:1), sem duplicar lógica. RD-38 (provado no dado):
-- fn_viagem_lancar_ge na viagem 3 (DEMO-FC-001) devolve 5 títulos = R$ 2.460,35 = v_viagem_custo_obra = custo_viagens
-- do Resultado da obra, centavo a centavo; a devolver R$ 746,73.
--
-- O que a função faz:
--   etapa 'limpar' (no reset, antes de apagar as obras/viagens): tira os títulos de GE das viagens da demo — o vínculo
--     (erp_viagem_ge_titulo) e o título no contas a pagar (erp_pagar, ref_externa_sistema='viagem'); sem isto, cada
--     reset deixaria títulos órfãos no contas a pagar da demo. Ordem: vínculo primeiro (FK NO ACTION para erp_pagar),
--     depois o título (erp_pagar_baixa cai por cascata; nenhuma movimentação é criada por esses títulos).
--   etapa 'semear' (no reset, depois das viagens existirem): escolhe um ator da demo (perfil que grava) e lança no GE
--     toda viagem FECHADA ainda não lançada, chamando fn_viagem_lancar_ge (idempotente). Sem usuário a função recusa,
--     por isso a semente impersona um usuário da própria demo (só na transação). Cada viagem é lançada num bloco com
--     EXCEPTION próprio: falha de uma NÃO derruba o reset (pior caso = título não criado, como era antes).
-- Autoria dos títulos: o usuário da demo impersonado (auth.uid()), igual ao fechamento real.
-- RD-55: nenhuma empresa real é tocada (guarda is_demo + company fixa). Plano de volta: tirar as 2 linhas
-- PERFORM fn_demo_seed_construtora_viagem_ge do fn_demo_seed_construtora (CREATE OR REPLACE pelo corpo vivo) e
-- DROP FUNCTION fn_demo_seed_construtora_viagem_ge; os títulos já criados saem no 'limpar' do próximo reset.

-- ci-sem-guarda: fn_demo_seed_construtora_viagem_ge — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_viagem_ge(p_company_id uuid, p_etapa text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_uid uuid;
  v_n int := 0;
  v_falhas int := 0;
  v_res jsonb;
  r record;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  IF p_etapa = 'limpar' THEN
    -- vínculo primeiro (FK NO ACTION para erp_pagar), depois o título (erp_pagar_baixa cai por cascata)
    DELETE FROM erp_viagem_ge_titulo WHERE company_id = c;
    DELETE FROM erp_pagar WHERE company_id = c AND ref_externa_sistema = 'viagem';
    RETURN jsonb_build_object('ok', true, 'etapa', 'limpar');
  END IF;

  IF p_etapa IS DISTINCT FROM 'semear' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'etapa_invalida');
  END IF;

  -- ator da demo (perfil que grava); sem usuário, fn_viagem_lancar_ge recusa — então pula sem falhar o reset
  SELECT uc.user_id INTO v_uid FROM public.user_companies uc
   WHERE uc.company_id = c AND lower(COALESCE(uc.role, '')) NOT IN ('viewer', 'visualizador')
   ORDER BY uc.user_id LIMIT 1;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'etapa', 'semear', 'pulado', 'sem_ator_demo');
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  -- lança cada viagem FECHADA ainda não lançada (idempotente); falha de uma não derruba o reset
  FOR r IN
    SELECT v.id FROM public.erp_viagem v
     WHERE v.company_id = c AND v.status = 'fechada' AND v.excluido_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_viagem_ge_titulo t WHERE t.viagem_id = v.id)
     ORDER BY v.numero
  LOOP
    BEGIN
      v_res := public.fn_viagem_lancar_ge(r.id);
      IF COALESCE((v_res->>'ok')::boolean, false) THEN v_n := v_n + 1; ELSE v_falhas := v_falhas + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_falhas := v_falhas + 1;  -- o reset não pode quebrar por causa de uma viagem; segue
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'etapa', 'semear', 'lancadas', v_n, 'falhas', v_falhas,
    'titulos', (SELECT count(*) FROM public.erp_viagem_ge_titulo t JOIN public.erp_viagem v ON v.id = t.viagem_id
                 WHERE v.company_id = c));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_viagem_ge(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_viagem_ge(uuid, text) TO service_role;

-- a semente principal passa a limpar/semear os títulos de GE das viagens (patch por âncora, corpo vigente — RD-69)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_viagem_ge' THEN RETURN; END IF;
  -- limpar os títulos ANTES de apagar as viagens (junto com os demais 'limpar')
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_fc(c, ''limpar'');',
    E'  PERFORM fn_demo_seed_construtora_viagem_ge(c, ''limpar'');\n  PERFORM fn_demo_seed_construtora_fc(c, ''limpar'');');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora do limpar (fc) nao encontrada'; END IF;
  v_def := v_new;
  -- semear os títulos DEPOIS de todas as viagens existirem (logo antes do RETURN final)
  v_new := replace(v_def,
    E'  RETURN jsonb_build_object(''ok'', true, ''base'', v_base, ''cronograma'', v_crono,',
    E'  PERFORM fn_demo_seed_construtora_viagem_ge(c, ''semear'');\n  RETURN jsonb_build_object(''ok'', true, ''base'', v_base, ''cronograma'', v_crono,');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora do RETURN nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

-- aplica agora (só se a demo existir neste banco): rebuild da demo, já com as viagens lançadas no GE
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
