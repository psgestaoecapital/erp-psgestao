-- HB0 · HBF-0.5 (empresa DEMO irrigada) — Diário de obra (RDO) na Construtora DEMO + reset que não quebra com RDO.
-- Achado (banco 24/10, RD-38):
--  a) projetos_obra_rdo tem FK para projetos_obra_os e projetos_obras com ON DELETE NO ACTION, e o fn_demo_seed_construtora
--     faz DELETE FROM projetos_obra_os / projetos_obras da demo SEM apagar antes o RDO. Hoje há 0 RDO no banco, mas o
--     primeiro diário lançado na demo (auditor, sócio, teste) faria o reset da demo falhar com violação de FK.
--  b) a semente não grava nenhum RDO: o histograma/pluviometria do cronograma e o diário da OS abrem vazios na demo.
--
-- 1) fn_demo_seed_construtora_rdo(company) — NOVA, só na 006 e só se is_demo; sem GRANT a usuário. Grava 10 diários nas
--    OS DEMO que já começaram (OSO-0001, 0002, 0004, 0008), sempre dentro da janela início..fim da OS e nunca no futuro,
--    com sol/nublado/chuva/chuva forte e 2 dias em que não deu para trabalhar. Idempotente: só insere o dia que a OS
--    ainda não tem (NOT EXISTS no mesmo índice único os_id+data) — não sobrescreve diário feito na tela.
-- 2) fn_demo_seed_construtora: patch por âncora sobre o corpo vivo (RD-69; aborta se a âncora sumir; idempotente):
--    apaga o RDO da demo ANTES das OS e chama a semente do RDO logo depois da semente de OS.
-- 3) Roda uma vez agora (só a semente de RDO; sem reset da demo).
-- RD-55: nenhuma empresa real é tocada (tudo fixo na 006 com is_demo). Plano de volta: os dois replace ao contrário no
-- fn_demo_seed_construtora; DELETE FROM projetos_obra_rdo WHERE company_id = '…0006'; DROP FUNCTION
-- fn_demo_seed_construtora_rdo(uuid).

-- ci-sem-guarda: fn_demo_seed_construtora_rdo — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_rdo(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_hoje date := current_date;
  v_ins int;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  INSERT INTO projetos_obra_rdo (company_id, obra_id, os_id, data, clima, praticavel, efetivo, atividades, ocorrencias)
  SELECT c, os.obra_id, os.id, v_hoje + r.dia, r.clima, r.praticavel, r.efetivo, r.ativ, r.ocor
    FROM (VALUES
      ('OSO-0001', -18, 'sol', true, 4, 'Marcação dos níveis do forro no térreo com nível a laser; locação das tabicas.', NULL),
      ('OSO-0001', -17, 'nublado', true, 4, 'Conferência dos níveis com o engenheiro e liberação da etapa.', NULL),
      ('OSO-0002', -3, 'sol', true, 5, 'Início da estrutura do forro nas salas 1 e 2: pendurais e perfis F530.', NULL),
      ('OSO-0002', -2, 'chuva_forte', false, 0, NULL, 'Chuva forte e falta de energia no bloco A; equipe dispensada às 9 h.'),
      ('OSO-0002', -1, 'nublado', true, 5, 'Estrutura do forro concluída nas salas 1 a 3.', 'Faltaram 20 tirantes; pedido feito ao almoxarifado.'),
      ('OSO-0004', -2, 'chuva', false, 0, NULL, 'Chuva com goteira na recepção; aguardando o cliente vedar a laje.'),
      ('OSO-0004', -1, 'sol', true, 3, 'Guias e montantes da recepção instalados; início do fechamento da sala de espera.', NULL),
      ('OSO-0008', -14, 'sol', true, 3, 'Lixamento e primeira demão na sala comercial.', NULL),
      ('OSO-0008', -13, 'chuva', true, 3, 'Segunda demão nas paredes internas (área coberta).', 'Chuva atrasou a secagem; fachada ficou para amanhã.'),
      ('OSO-0008', -12, 'sol', true, 2, 'Retoques, limpeza e entrega da sala ao cliente.', NULL)
    ) AS r(numero, dia, clima, praticavel, efetivo, ativ, ocor)
    JOIN projetos_obra_os os ON os.company_id = c AND os.numero = r.numero AND os.excluido_em IS NULL
   WHERE v_hoje + r.dia <= v_hoje
     AND (os.iniciada_em IS NULL OR v_hoje + r.dia >= os.iniciada_em::date)
     AND (os.concluida_em IS NULL OR v_hoje + r.dia <= os.concluida_em::date)
     AND NOT EXISTS (SELECT 1 FROM projetos_obra_rdo x
                      WHERE x.os_id = os.id AND x.data = v_hoje + r.dia AND x.excluido_em IS NULL);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'rdo_inseridos', v_ins,
    'rdo_demo', (SELECT count(*) FROM projetos_obra_rdo WHERE company_id = c AND excluido_em IS NULL));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_rdo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_rdo(uuid) TO service_role;

DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_rdo' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  DELETE FROM projetos_obra_os WHERE company_id = c;',
    E'  DELETE FROM projetos_obra_rdo WHERE company_id = c;\n  DELETE FROM projetos_obra_os WHERE company_id = c;');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora da limpeza das OS nao encontrada'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_os(c);',
    E'  PERFORM fn_demo_seed_construtora_os(c);\n  PERFORM fn_demo_seed_construtora_rdo(c);');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora da semente de OS nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora(uuid) TO service_role;

-- aplica agora (só a semente de RDO, só se a demo existir neste banco e já tiver as OS)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE)
     AND EXISTS (SELECT 1 FROM public.projetos_obra_os WHERE company_id = 'b0700000-0000-4000-a000-000000000006'
                  AND numero = 'OSO-0008') THEN
    PERFORM public.fn_demo_seed_construtora_rdo('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
