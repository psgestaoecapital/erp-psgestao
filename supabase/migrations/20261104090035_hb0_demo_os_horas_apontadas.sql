-- HB0 · HBF-0.5 (empresa DEMO irrigada) — horas apontadas NA OS na Construtora DEMO.
-- Achado (banco 02/11, RD-38): a tela /dashboard/projetos/obras/os mostra, no card de cada OS, um bloco "Horas"
-- (horas apontadas × custo de mão de obra), que lê projetos_obra_mao_obra_apontamento FILTRANDO por os_id NÃO nulo
-- (page.tsx: .not('os_id','is',null)). A DEMO 006 tem 80 apontamentos, mas TODOS com os_id NULL (lançados no nível
-- da obra pela semente principal), então o bloco "Horas" renderiza VAZIO na vitrine DEMO → "tela morta" nesse bloco
-- (RD-98 p1). A tela e a RPC (fn_obra_os_apontar_horas) funcionam; faltava o dado da demonstração ligado à OS.
--
-- 1) fn_demo_seed_construtora_os_horas(company) — NOVA, só na 006 e só se is_demo; sem GRANT a usuário. Grava 8
--    apontamentos de horas REAIS ligados a 4 OS (os_id preenchido): 2 por OS, nas OS em execução/concluídas
--    (OSO-0001, OSO-0002, OSO-0004, OSO-0008), com função real da empresa (erp_funcao_mao_obra), horas e custo/hora
--    coerentes. Mesmo modelo de dado que a tela grava (fn_obra_os_apontar_horas insere company/obra/os/data/função/
--    horas/custo_hora; "valor" é coluna GERADA = round(horas*custo_hora,2), por isso NÃO é inserida).
--    Idempotente: NOT EXISTS por (os_id, funcao_id, descrição) — rodar de novo não duplica nem sobrescreve horas
--    apontadas na tela.
-- 2) fn_demo_seed_construtora: patch por âncora (corpo vigente preservado — RD-69; aborta se a âncora sumir): chama a
--    semente de horas logo DEPOIS da semente de OS (as OS já existem nesse ponto). A limpeza já existe no corpo
--    principal (DELETE FROM projetos_obra_mao_obra_apontamento antes do loop das obras).
-- 3) Roda uma vez agora (só a semente de horas; sem reset da demo).
-- RD-55: nenhuma empresa real é tocada (guarda is_demo + company fixa 006). RD-98: aditiva, não apaga/altera dado de
-- cliente. Plano de volta: DELETE FROM projetos_obra_mao_obra_apontamento WHERE company_id='…0006' AND os_id IS NOT
-- NULL AND descricao LIKE '% — horas apontadas na OSO-%'; reverter o patch da âncora; DROP FUNCTION
-- fn_demo_seed_construtora_os_horas(uuid).

-- ci-sem-guarda: fn_demo_seed_construtora_os_horas — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_os_horas(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_ins int := 0;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  INSERT INTO projetos_obra_mao_obra_apontamento
    (company_id, obra_id, os_id, data, funcao_id, descricao, horas, custo_hora)
  SELECT c, o.obra_id, o.id,
         COALESCE(o.iniciada_em::date, o.concluida_em::date, current_date - 5) + s.dia,
         f.id,
         s.funcao || ' — horas apontadas na ' || o.numero,
         s.horas, s.custo_hora
    FROM (VALUES
      ('OSO-0001', 'Gesseiro', 24, 32.00, 0),
      ('OSO-0001', 'Servente', 24, 18.50, 1),
      ('OSO-0002', 'Gesseiro', 16, 32.00, 0),
      ('OSO-0002', 'Servente', 16, 18.50, 1),
      ('OSO-0004', 'Gesseiro', 16, 32.00, 0),
      ('OSO-0004', 'Servente',  8, 18.50, 1),
      ('OSO-0008', 'Pintor',   24, 28.00, 0),
      ('OSO-0008', 'Servente', 16, 18.50, 1)
    ) AS s(os_numero, funcao, horas, custo_hora, dia)
    JOIN public.projetos_obra_os o
      ON o.company_id = c AND o.numero = s.os_numero AND o.excluido_em IS NULL
    JOIN public.erp_funcao_mao_obra f
      ON f.company_id = c AND f.nome = s.funcao
   WHERE NOT EXISTS (
     SELECT 1 FROM public.projetos_obra_mao_obra_apontamento a
      WHERE a.company_id = c AND a.os_id = o.id AND a.funcao_id = f.id
        AND a.descricao = s.funcao || ' — horas apontadas na ' || o.numero);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'apont_os_inseridos', v_ins,
    'apont_os_total', (SELECT count(*) FROM public.projetos_obra_mao_obra_apontamento
                        WHERE company_id = c AND os_id IS NOT NULL AND excluido_em IS NULL));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_os_horas(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_os_horas(uuid) TO service_role;

-- a semente principal passa a semear as horas DEPOIS das OS (patch por âncora, corpo vigente — RD-69)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_os_horas' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_os(c);',
    E'  PERFORM fn_demo_seed_construtora_os(c);\n  PERFORM fn_demo_seed_construtora_os_horas(c);');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora: ancora PERFORM fn_demo_seed_construtora_os(c) nao encontrada';
  END IF;
  EXECUTE v_new;
END $do$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora(uuid) TO service_role;

-- aplica agora (só a semente de horas, só se a demo existir neste banco e já tiver as OS)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE)
     AND EXISTS (SELECT 1 FROM public.projetos_obra_os WHERE company_id = 'b0700000-0000-4000-a000-000000000006'
                  AND numero = 'OSO-0001') THEN
    PERFORM public.fn_demo_seed_construtora_os_horas('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
