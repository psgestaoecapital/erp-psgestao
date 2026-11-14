-- Seed de FOLHA de pagamento (fictícia) da DEMO de Indústria (company 005, is_demo).
-- Motivo (auditoria aud8 Frioeste/demo 005, nota 92→95): a tela
-- /dashboard/industrial/mao-obra (painel "Custo de mão de obra por setor",
-- fn_custo_folha_setor → v_custo_folha_setor) só mostrava o empty-state porque a
-- DEMO 005 não tinha folha importada nem ind_pessoa, então o caminho POPULADO
-- (custo por setor + KPIs) não era comprovável visualmente (critério c do PDCA).
--
-- v_custo_folha_setor agrupa folha_competencia JOIN ind_pessoa (matricula) pelo
-- ind_pessoa.setor. Portanto o seed precisa das 3 pontas, com matrículas casadas:
--   ind_pessoa (setor Abate/Desossa) + folha_competencia + folha_verba.
--
-- RD-69: dado 100% FICTÍCIO, só na empresa DEMO (sufixo "Demo", CPFs gerados).
-- LGPD: salário é dado sensível — a tela já expõe só o AGREGADO por setor ao
-- gestor-não-RH (fn__pode_ver_folha); aqui apenas populamos a DEMO.
-- RD-38: contagem antes/depois provada no corpo da PR.
-- RD-30: folha_competencia/folha_verba têm trava de delete físico
-- (fn_bloqueia_delete_fisico); a idempotência libera o delete SÓ nesta transação
-- e SÓ nas linhas da DEMO (app.permitir_delete_fisico), como fn_demo_seed_industria_postos.
-- Persistência ao reset: fn_demo_reset NÃO toca ind_pessoa/folha_* (conferido),
-- então o seed de uma vez sobrevive aos resets da DEMO.

-- ci-sem-guarda: fn_demo_seed_industria_folha — seed DEMO controlado, company fixa
--   b0700000-0000-4000-a000-000000000005 (a função trava p_company_id IS DISTINCT FROM c e
--   exige companies.is_demo IS TRUE; escreve SÓ nas tabelas da DEMO, nunca em dado de cliente).
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_folha(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c          constant uuid := 'b0700000-0000-4000-a000-000000000005';
  v_comp     date;
  v_fc_id    uuid;
  v_i        int := 0;
  r          record;
  comp       date;
  competencias constant date[] := ARRAY['2026-09-01','2026-10-01']::date[];
BEGIN
  -- trava: só a DEMO de indústria
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- delete físico liberado SÓ nesta transação e SÓ nas linhas da DEMO (RD-30)
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);

  -- idempotência: zera só a folha/pessoas desta DEMO (ordem: verba → competência → pessoa)
  DELETE FROM folha_verba       WHERE company_id = c;
  DELETE FROM folha_competencia WHERE company_id = c;
  DELETE FROM ind_pessoa        WHERE company_id = c;

  -- Quadro fictício casado com os postos do abate/desossa (fn_demo_seed_industria_postos).
  -- (matricula, nome, setor, remuneracao mensal base)
  FOR r IN
    SELECT * FROM (VALUES
      (5001, 'Bruno Carvalho Demo',  'Abate',   3200.00),
      (5002, 'Diego Rocha Demo',     'Abate',   3000.00),
      (5003, 'Fábio Lima Demo',      'Abate',   3100.00),
      (5004, 'Hugo Martins Demo',    'Abate',   3100.00),
      (5005, 'João Pedro Demo',      'Abate',   3400.00),
      (5006, 'Rafael Souza Demo',    'Abate',   4200.00),  -- supervisor
      (5007, 'Lucas Ferreira Demo',  'Desossa', 2900.00),
      (5008, 'Nelson Pires Demo',    'Desossa', 2950.00),
      (5009, 'Paulo Teixeira Demo',  'Desossa', 2700.00),
      (5010, 'Sérgio Alves Demo',    'Desossa', 4000.00)   -- supervisor
    ) AS t(matricula, nome, setor, remun)
  LOOP
    v_i := v_i + 1;

    INSERT INTO ind_pessoa (company_id, matricula, cpf, nome, vinculo, setor, setor_origem, ativo, origem)
    VALUES (c, r.matricula, fn_demo_cpf_valido(557000000 + v_i), r.nome, 'clt', r.setor, 'manual', true, 'demo');

    FOREACH comp IN ARRAY competencias LOOP
      v_comp := comp;
      INSERT INTO folha_competencia (company_id, matricula, nome, competencia, remuneracao, total_geral, secoes)
      VALUES (c, r.matricula, r.nome, v_comp, r.remun, round(r.remun * 1.68, 2), r.setor)
      RETURNING id INTO v_fc_id;

      -- Verbas: provento base + encargos patronais (somam o total_geral) + INSS (desconto informativo).
      INSERT INTO folha_verba (company_id, competencia, matricula, folha_competencia_id, codigo_verba, descricao, tipo, valor) VALUES
        (c, v_comp, r.matricula, v_fc_id, '001', 'Salário base',        'provento', r.remun),
        (c, v_comp, r.matricula, v_fc_id, '900', 'Encargos patronais',  'provento', round(r.remun * 0.68, 2)),
        (c, v_comp, r.matricula, v_fc_id, '910', 'INSS',                'desconto', round(r.remun * 0.09, 2));
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_folha',
    'pessoas',      (SELECT count(*) FROM ind_pessoa WHERE company_id = c),
    'competencias', (SELECT count(DISTINCT competencia) FROM folha_competencia WHERE company_id = c),
    'folha_linhas', (SELECT count(*) FROM folha_competencia WHERE company_id = c),
    'verbas',       (SELECT count(*) FROM folha_verba WHERE company_id = c),
    'custo_total',  (SELECT COALESCE(sum(total_geral),0) FROM folha_competencia WHERE company_id = c));
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_folha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_folha(uuid) TO authenticated, service_role;

-- Semeia agora na DEMO (deploy-migrations aplica na main → produção).
SELECT public.fn_demo_seed_industria_folha('b0700000-0000-4000-a000-000000000005');
