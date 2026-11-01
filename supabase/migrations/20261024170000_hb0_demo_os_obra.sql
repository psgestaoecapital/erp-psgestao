-- HB0 · HBF-0.3 (empresa DEMO irrigada) — Ordens de Serviço de obra na Construtora DEMO.
-- Achado (banco 24/10): a tela /dashboard/projetos/obras/os (#3017, HB0 item 6) saiu com nota funcional 20 no auditor
-- PDCA porque NÃO existe nenhuma OS de obra no banco (projetos_obra_os = 0 linhas, DEMO incluída): a lista abre vazia,
-- sem etapa, serviço, equipe nem status para mostrar. A tela funciona; faltava o dado da demonstração.
--
-- 1) fn_demo_seed_construtora_os(company) — NOVA, só na 006 e só se is_demo; sem GRANT a usuário. Grava 8 OS nas 4 obras
--    DEMO, cada uma ligada à etapa (projetos_obra_tarefa, pela ordem) e ao serviço (projetos_obra_item, pela descrição)
--    da PRÓPRIA obra, com os 4 status da tela: 3 abertas, 2 em execução, 2 concluídas, 1 cancelada.
--    Datas coerentes com o status (concluída tem início e fim; em execução só início; aberta nenhum).
--    Número OSO-0001..0008 no mesmo formato do fn_obra_os_salvar (o próximo criado na tela segue OSO-0009).
--    Idempotente: ON CONFLICT (company_id, numero) DO NOTHING — rodar de novo não duplica nem sobrescreve OS feita na tela.
-- 2) fn_demo_seed_construtora: patch por âncora (corpo vigente preservado — RD-69; aborta se a âncora sumir): chama a
--    semente de OS logo depois de 'semear' os extras. A limpeza já existe (DELETE FROM projetos_obra_os antes das obras).
-- 3) Roda uma vez agora (só a semente de OS; sem reset da demo).
-- RD-55: nenhuma empresa real é tocada. Plano de volta: DELETE FROM projetos_obra_os WHERE company_id = '…0006' AND
-- numero BETWEEN 'OSO-0001' AND 'OSO-0008'; o replace ao contrário no fn_demo_seed_construtora; DROP FUNCTION
-- fn_demo_seed_construtora_os(uuid).

-- ci-sem-guarda: fn_demo_seed_construtora_os — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_os(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_hoje date := current_date;
  v_obras int; v_ins int;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;
  SELECT count(*) INTO v_obras FROM projetos_obras
   WHERE company_id = c AND numero IN ('DEMO-OB-001', 'DEMO-OB-002', 'DEMO-OB-003', 'DEMO-OB-004');
  IF v_obras < 4 THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora_os: obras DEMO-OB-001..004 não encontradas';
  END IF;

  INSERT INTO projetos_obra_os (company_id, obra_id, numero, tarefa_id, obra_item_id, descricao, equipe, responsavel,
                                data_prevista, prioridade, status, iniciada_em, concluida_em, criado_em, atualizado_em)
  SELECT c, o.id, s.numero, t.id, i.id, s.descricao, s.equipe, s.responsavel, v_hoje + s.prev, s.prioridade, s.status,
         CASE WHEN s.ini IS NULL THEN NULL ELSE (v_hoje + s.ini)::timestamptz + interval '7 hours' END,
         CASE WHEN s.fim IS NULL THEN NULL ELSE (v_hoje + s.fim)::timestamptz + interval '17 hours' END,
         (v_hoje + s.criada)::timestamptz + interval '8 hours', now()
    FROM (VALUES
      ('OSO-0001', 'DEMO-OB-001', 1, 'Forro de gesso acartonado', 'Marcação de níveis e locação do forro – pavimento térreo',
       'Equipe Gesso 1', 'Carlos Encarregado (Demo)', -18, 'normal', 'concluida', -18, -17, -20),
      ('OSO-0002', 'DEMO-OB-001', 2, 'Forro de gesso acartonado', 'Montagem da estrutura do forro – bloco A (salas 1 a 4)',
       'Equipe Gesso 1', 'Carlos Encarregado (Demo)', 2, 'alta', 'em_execucao', -3, NULL, -6),
      ('OSO-0003', 'DEMO-OB-001', 3, 'Parede drywall simples', 'Fechamento das divisórias drywall do corredor',
       'Equipe Gesso 2', 'Carlos Encarregado (Demo)', 6, 'normal', 'aberta', NULL, NULL, -2),
      ('OSO-0004', 'DEMO-OB-002', 3, 'Parede drywall simples', 'Fechamento drywall da recepção e da sala de espera',
       'Equipe Gesso 2', 'Marina Técnica (Demo)', 1, 'normal', 'em_execucao', -2, NULL, -5),
      ('OSO-0005', 'DEMO-OB-002', 3, 'Assentamento de porcelanato 60x60', 'Assentamento do porcelanato dos consultórios 1 a 3',
       'Equipe Revestimento', 'Marina Técnica (Demo)', 4, 'urgente', 'aberta', NULL, NULL, -1),
      ('OSO-0006', 'DEMO-OB-003', 1, 'Assentamento de porcelanato 60x60', 'Mobilização e proteção do piso existente da loja',
       'Equipe Revestimento', 'Marina Técnica (Demo)', 3, 'normal', 'aberta', NULL, NULL, -1),
      ('OSO-0007', 'DEMO-OB-003', 4, 'Pintura acrílica 2 demãos', 'Pintura da fachada (adiada a pedido do cliente)',
       'Equipe Pintura', 'Carlos Encarregado (Demo)', 10, 'baixa', 'cancelada', NULL, NULL, -9),
      ('OSO-0008', 'DEMO-OB-004', 4, 'Pintura acrílica 2 demãos', 'Pintura final e entrega da sala comercial',
       'Equipe Pintura', 'Carlos Encarregado (Demo)', -12, 'normal', 'concluida', -14, -12, -16)
    ) AS s(numero, obra, etapa, servico, descricao, equipe, responsavel, prev, prioridade, status, ini, fim, criada)
    JOIN projetos_obras o ON o.company_id = c AND o.numero = s.obra
    LEFT JOIN LATERAL (SELECT t.id FROM projetos_obra_tarefa t
                        WHERE t.obra_id = o.id AND t.ordem = s.etapa AND t.excluido_em IS NULL
                        ORDER BY t.id LIMIT 1) t ON true
    LEFT JOIN LATERAL (SELECT i.id FROM projetos_obra_item i
                        WHERE i.obra_id = o.id AND i.descricao = s.servico AND i.excluido_em IS NULL
                        ORDER BY i.id LIMIT 1) i ON true
  ON CONFLICT (company_id, numero) DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'os_inseridas', v_ins,
    'os_demo', (SELECT count(*) FROM projetos_obra_os WHERE company_id = c AND excluido_em IS NULL));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_os(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_os(uuid) TO service_role;

-- a semente principal passa a semear as OS depois dos extras (patch por âncora, corpo vigente — RD-69)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_os' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_extras(c, ''semear'');',
    E'  PERFORM fn_demo_seed_construtora_extras(c, ''semear'');\n  PERFORM fn_demo_seed_construtora_os(c);');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora do semear dos extras nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora(uuid) TO service_role;

-- aplica agora (só a semente de OS, só se a demo existir neste banco e já tiver as obras)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE)
     AND EXISTS (SELECT 1 FROM public.projetos_obras WHERE company_id = 'b0700000-0000-4000-a000-000000000006'
                  AND numero = 'DEMO-OB-004') THEN
    PERFORM public.fn_demo_seed_construtora_os('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
