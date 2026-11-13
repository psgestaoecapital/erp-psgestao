-- Auditor PDCA (auditor_pdca_1, jornada J2) · /dashboard/industrial/rh/quadro, aba "Por cargo":
-- na DEMO Indústria (005) o <select> de cargo de cada linha fica VAZIO e o R$/h médio por
-- cargo aparece zerado. Causa provada no dado (RD-38, prod. horsymhsinqcimflrtjo):
--   • prod_cargo(005)          = 0  -> nenhum cargo para o dropdown oferecer;
--   • prod_cargo_vinculo(005)  = 0  -> nenhuma função do ponto ligada a cargo, então
--                                      fn_rh_quadro_base (LEFT JOIN prod_cargo_vinculo vc
--                                      ON upper(vc.chave)=upper(p.funcao)) devolve cargo NULL
--                                      para as 24 pessoas do ponto;
--   • prod_fonte_dados(005,'ponto') = 0 -> o vínculo exige fonte_id (NOT NULL, FK) e a DEMO
--                                      nunca teve a fonte de PONTO (as 24 pessoas de
--                                      ind_ponto_colaborador foram semeadas direto, sem import).
--
-- CORREÇÃO (seed FICTÍCIO da DEMO 005 — RD-69/LGPD: tudo FAKE; ADITIVA e IDEMPOTENTE):
--   1) cria a fonte de dados do PONTO (prod_fonte_dados tipo='ponto'), se não existir;
--   2) cria 1 cargo por função distinta do ponto (6: Operador de abate, Desossador,
--      Auxiliar de embalagem, Operador de câmara fria, Mecânico de manutenção,
--      Técnico de segurança do trabalho);
--   3) liga cada função do ponto ao seu cargo (prod_cargo_vinculo, chave=função),
--      espelhando EXATAMENTE o que fn_prod_cargo_do_ponto_vincular faria pela tela.
--
-- PROVA RD-38 (rodada em BEGIN...ROLLBACK na produção): depois do seed,
--   cargo=6, vinculo=6, fonte=1 e as 24 pessoas do ponto passam a casar um cargo pelo join
--   do quadro (pessoas_com_cargo=24) -> a aba "Por cargo" deixa de ficar vazia.
--
-- SOBREVIVE AO RESET: fn_demo_reset NÃO toca industrial_plants, prod_fonte_dados, prod_cargo
--   nem prod_cargo_vinculo (verificado no dado), e a planta DEMO-SST tem id estável; logo o
--   seed persiste ao fn_demo_reset sem precisar entrar na função de seed dos postos (evita
--   colisão com a PR #4746, que reescreve fn_demo_seed_industria_postos).
--
-- SEGURANÇA/ESCOPO: SÓ a DEMO 005 (trava is_demo IS TRUE + id fixo). Nenhuma linha de cliente
--   é tocada. Sem DDL, sem RLS/grant/RPC nova; usa só tabelas prod_* já existentes (RLS por
--   company_id já ligada). Não altera salário/folha (fonte de custo de pessoa fica para o
--   núcleo/code-3, CEO 11/11) — apenas a camada CARGO do ponto, do domínio produtividade.

DO $$
DECLARE
  c        constant uuid := 'b0700000-0000-4000-a000-000000000005';
  v_plant  uuid;
  v_fonte  uuid;
  v_cargo  uuid;
  r        record;
BEGIN
  -- trava: só a DEMO de indústria (RD-69)
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RAISE NOTICE 'demo005_cargo: empresa 005 ausente ou não-demo — seed ignorado';
    RETURN;
  END IF;

  SELECT id INTO v_plant
    FROM industrial_plants
   WHERE company_id = c AND codigo_planta = 'DEMO-SST'
   LIMIT 1;
  IF v_plant IS NULL THEN
    RAISE NOTICE 'demo005_cargo: planta DEMO-SST ausente — seed ignorado';
    RETURN;
  END IF;

  -- 1) fonte de dados do PONTO (origem das funções que viram cargo)
  SELECT id INTO v_fonte
    FROM prod_fonte_dados
   WHERE company_id = c AND plant_id = v_plant AND tipo = 'ponto'
   ORDER BY ativo DESC, created_at
   LIMIT 1;
  IF v_fonte IS NULL THEN
    INSERT INTO prod_fonte_dados (company_id, plant_id, tipo, nome, ativo)
    VALUES (c, v_plant, 'ponto', 'Ponto (folha de presença) — DEMO', true)
    RETURNING id INTO v_fonte;
  END IF;

  -- 2) + 3) cargo (1:1 com a função) e vínculo função->cargo, para cada função do ponto
  FOR r IN
    SELECT btrim(funcao) AS chave
      FROM ind_ponto_colaborador
     WHERE company_id = c AND COALESCE(btrim(funcao), '') <> ''
     GROUP BY btrim(funcao)
  LOOP
    SELECT id INTO v_cargo
      FROM prod_cargo
     WHERE company_id = c AND plant_id = v_plant AND nome = r.chave
     LIMIT 1;
    IF v_cargo IS NULL THEN
      INSERT INTO prod_cargo (company_id, plant_id, nome)
      VALUES (c, v_plant, r.chave)
      ON CONFLICT (company_id, plant_id, nome) DO NOTHING
      RETURNING id INTO v_cargo;
      IF v_cargo IS NULL THEN
        SELECT id INTO v_cargo
          FROM prod_cargo
         WHERE company_id = c AND plant_id = v_plant AND nome = r.chave;
      END IF;
    END IF;

    INSERT INTO prod_cargo_vinculo (company_id, plant_id, cargo_id, fonte_id, chave, rotulo)
    VALUES (c, v_plant, v_cargo, v_fonte, r.chave, r.chave)
    ON CONFLICT (fonte_id, chave) DO NOTHING;
  END LOOP;
END $$;
