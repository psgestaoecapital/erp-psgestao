-- PDCA aud8 /dashboard/industrial/rh/quadro (DEMO 005, nota 78) — FATIA 2 do gap crit. b:
-- as colunas ESCALA e CARGA HORÁRIA ficavam "—" para os 24 colaboradores porque a DEMO 005
-- não tinha nenhuma linha em ind_ponto_jornada (fn_ind_ponto_jornada_listar devolvia []).
-- A FATIA 1 (#5000) já populou SETOR/SUPERVISOR/salário via rh_pessoa_complemento; aqui
-- completamos ESCALA/CARGA, derivadas por função do colaborador do ponto (RD-26: reuso da
-- tabela e da RPC que JÁ existem, nada de recriar).
--
-- RD-26/RD-98: estendo o MESMO seed idempotente da FATIA 1 (fn_demo_seed_industria_rh_quadro,
--   já chamado pelo fn_demo_reset da DEMO 005 → persiste ao reset). Upsert por
--   (empresa, cpf, matrícula, vigência) — a chave única da própria ind_ponto_jornada, pensada
--   para o sync; rodar 2× não duplica.
-- RD-69/LGPD: dado 100% FICTÍCIO, só na empresa DEMO (trava p_company_id + is_demo).
-- Aditivo (RD-55): não cria tabela/coluna, não toca RLS/grant, não altera dado de cliente.
-- RD-38: contagens provadas no banco em BEGIN/ROLLBACK (24 jornadas, 0→24; escalas por função).
-- Reverter: restaurar a definição anterior de fn_demo_seed_industria_rh_quadro (sem o bloco
--   de jornada); as linhas DEMO podem ser removidas com DELETE … WHERE company_id='…0005'.

-- ci-sem-guarda: fn_demo_seed_industria_rh_quadro — seed DEMO controlado, company fixa
--   b0700000-0000-4000-a000-000000000005 (trava p_company_id e exige is_demo; escreve SÓ
--   nas tabelas de complemento/parâmetro/jornada da DEMO, nunca em dado de cliente).
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_rh_quadro(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000005';
BEGIN
  -- trava: só a DEMO de indústria
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- idempotência: zera só o complemento desta DEMO (sem trava de delete físico nesta tabela)
  DELETE FROM rh_pessoa_complemento WHERE company_id = c;

  -- Complemento para cada colaborador do ponto (função → cargo, departamento → setor).
  INSERT INTO rh_pessoa_complemento
    (company_id, cpf, matricula, cargo_id, setor_id, supervisor_nome, salario_base, observacao)
  SELECT c, p.cpf, btrim(p.matricula), cg.id, st.id,
    'Supervisor ' || COALESCE(NULLIF(btrim(p.departamento), ''), 'Geral'),
    CASE upper(btrim(COALESCE(p.funcao, '')))
      WHEN 'OPERADOR DE ABATE'               THEN 2600
      WHEN 'DESOSSADOR'                      THEN 2900
      WHEN 'AUXILIAR DE EMBALAGEM'           THEN 2100
      WHEN 'OPERADOR DE CÂMARA FRIA'         THEN 2400
      WHEN 'MECÂNICO DE MANUTENÇÃO'          THEN 3500
      WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN 4200
      ELSE 2000
    END,
    'seed DEMO (fictício)'
  FROM (
    SELECT DISTINCT ON (cpf) cpf, matricula, funcao, departamento
    FROM ind_ponto_colaborador
    WHERE company_id = c AND cpf IS NOT NULL
    ORDER BY cpf, created_at DESC NULLS LAST
  ) p
  LEFT JOIN prod_cargo cg ON cg.company_id = c AND cg.ativo
       AND upper(btrim(cg.nome)) = upper(btrim(p.funcao))
  LEFT JOIN prod_setor st ON st.company_id = c AND st.ativo
       AND upper(btrim(st.nome)) = upper(btrim(p.departamento));

  -- Parâmetro de custo da folha (encargos e horas/mês padrão) — base do custo/hora.
  INSERT INTO rh_parametro_custo (company_id, encargos_pct, horas_mes, fonte_custo, atualizado_em)
  VALUES (c, 38.35, 220, 'folha_total', now())
  ON CONFLICT (company_id) DO UPDATE
    SET encargos_pct = EXCLUDED.encargos_pct,
        horas_mes    = EXCLUDED.horas_mes,
        fonte_custo  = EXCLUDED.fonte_custo,
        atualizado_em = now();

  -- ESCALA/CARGA (FATIA 2): jornada por colaborador do ponto, derivada da FUNÇÃO.
  --  · câmara fria → 12x36 noturno · manutenção/segurança → 5x2 44h (administrativa)
  --  · abate/desossa/embalagem → 6x1 44h (produção).
  -- Upsert pela chave única da tabela (idempotente; vigência = início do ano corrente).
  INSERT INTO ind_ponto_jornada
    (company_id, cpf, registration_number, escala_nome, tipo_escala, horas_semana, horas_mes,
     hora_entrada, hora_saida, intervalo_min, vigencia_inicio, vigencia_fim, fonte, sincronizado_em, atualizado_em)
  SELECT c, p.cpf, btrim(p.matricula),
    j.escala_nome, j.tipo_escala, j.horas_semana, j.horas_mes,
    j.hora_entrada, j.hora_saida, 60,
    date_trunc('year', CURRENT_DATE)::date, NULL, 'sync', now(), now()
  FROM (
    SELECT DISTINCT ON (cpf) cpf, matricula, funcao
    FROM ind_ponto_colaborador
    WHERE company_id = c AND cpf IS NOT NULL
    ORDER BY cpf, created_at DESC NULLS LAST
  ) p
  CROSS JOIN LATERAL (VALUES (
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN '12x36 noturno'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN '5x2 44h (administrativa)'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN '5x2 44h (administrativa)'
        ELSE '6x1 44h (produção)' END,
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN '12x36'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN '5x2'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN '5x2'
        ELSE '6x1' END,
      (CASE upper(btrim(COALESCE(p.funcao,''))) WHEN 'OPERADOR DE CÂMARA FRIA' THEN 42.00 ELSE 44.00 END)::numeric(6,2),
      (CASE upper(btrim(COALESCE(p.funcao,''))) WHEN 'OPERADOR DE CÂMARA FRIA' THEN 180.00 ELSE 220.00 END)::numeric(7,2),
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN TIME '19:00'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN TIME '08:00'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN TIME '08:00'
        ELSE TIME '06:00' END,
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN TIME '07:00'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN TIME '17:48'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN TIME '17:48'
        ELSE TIME '14:48' END
  )) AS j(escala_nome, tipo_escala, horas_semana, horas_mes, hora_entrada, hora_saida)
  ON CONFLICT (company_id, lower(COALESCE(cpf,'')), lower(COALESCE(registration_number,'')), COALESCE(vigencia_inicio, DATE '0001-01-01'))
  DO UPDATE SET
    escala_nome   = EXCLUDED.escala_nome,
    tipo_escala   = EXCLUDED.tipo_escala,
    horas_semana  = EXCLUDED.horas_semana,
    horas_mes     = EXCLUDED.horas_mes,
    hora_entrada  = EXCLUDED.hora_entrada,
    hora_saida    = EXCLUDED.hora_saida,
    intervalo_min = EXCLUDED.intervalo_min,
    fonte         = EXCLUDED.fonte,
    sincronizado_em = EXCLUDED.sincronizado_em,
    atualizado_em = now();

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_rh_quadro',
    'complementos', (SELECT count(*) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'com_salario',  (SELECT count(salario_base) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'com_cargo',    (SELECT count(cargo_id) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'jornadas',     (SELECT count(*) FROM ind_ponto_jornada WHERE company_id = c),
    'folha_base',   (SELECT COALESCE(sum(salario_base),0) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_rh_quadro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_rh_quadro(uuid) TO authenticated, service_role;

-- Semeia agora na DEMO (deploy-migrations aplica na main → produção).
SELECT public.fn_demo_seed_industria_rh_quadro('b0700000-0000-4000-a000-000000000005');
