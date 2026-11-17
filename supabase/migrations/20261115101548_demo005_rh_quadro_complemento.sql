-- Seed de COMPLEMENTO de RH (fictício) da DEMO de Indústria (company 005, is_demo).
-- Motivo (auditoria aud8 /dashboard/industrial/rh/quadro, nota 85→95, gap crit. b/c):
-- as colunas SALÁRIO, CUSTO MÉDIO, CARGA HORÁRIA, SUPERVISOR e o custo da folha
-- apareciam "—" para todos os ~24 colaboradores do ponto porque a DEMO 005 não tinha
-- rh_pessoa_complemento nem rh_parametro_custo. fn_rh_quadro_base deriva salário de
-- COALESCE(complemento.salario_base, folha.remuneracao) e cargo/setor/supervisor do
-- complemento; sem ele, o núcleo da tela (projeção de salário e custo por cargo/setor)
-- ficava sem dado real (RD-98 p1, critério b: dado não carrega para custo).
--
-- GENÉRICO: lê os colaboradores REAIS do ponto da DEMO (ind_ponto_colaborador), casa
-- a FUNÇÃO com prod_cargo e o DEPARTAMENTO com prod_setor (nada chumbado); salário
-- fictício por função. Complementa #4903 (folha por setor da mão de obra), que semeia
-- 10 pessoas de folha distintas — aqui damos salário/cargo/setor às pessoas do ponto.
--
-- RD-69/LGPD: dado 100% FICTÍCIO, só na empresa DEMO; salário é agregado ao gestor
--   não-RH (fn__rh_pode_custo já protege a exibição). RD-38: contagem provada na PR.
-- Persistência ao reset: fn_demo_reset NÃO toca rh_pessoa_complemento/rh_parametro_custo
--   nem ind_ponto_colaborador (conferido), então o seed de uma vez sobrevive aos resets.

-- ci-sem-guarda: fn_demo_seed_industria_rh_quadro — seed DEMO controlado, company fixa
--   b0700000-0000-4000-a000-000000000005 (trava p_company_id e exige is_demo; escreve SÓ
--   nas tabelas de complemento/parametro da DEMO, nunca em dado de cliente).
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

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_rh_quadro',
    'complementos', (SELECT count(*) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'com_salario',  (SELECT count(salario_base) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'com_cargo',    (SELECT count(cargo_id) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'folha_base',   (SELECT COALESCE(sum(salario_base),0) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_rh_quadro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_rh_quadro(uuid) TO authenticated, service_role;

-- Semeia agora na DEMO (deploy-migrations aplica na main → produção).
SELECT public.fn_demo_seed_industria_rh_quadro('b0700000-0000-4000-a000-000000000005');
