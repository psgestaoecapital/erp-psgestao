-- HB4 · Avanço físico pelo diário de obra (RDO) — o diário passa a guardar a QUANTIDADE executada no dia.
-- Achado (auditor PDCA 24/10, /dashboard/projetos/obras/[id]/cronograma): faltava "vínculo com RDO para alimentar o
-- avanço físico". Conferido no banco 24/10 (RD-38): projetos_obra_rdo só tinha o texto "o que foi feito"; a OS de obra
-- já liga tarefa (tarefa_id) e item do contrato (obra_item_id), então a quantidade do dia diz quanto da tarefa andou.
--
-- 1) projetos_obra_rdo.quantidade_executada — coluna NOVA, opcional (NULL = não informada), >= 0, na unidade do item.
-- 2) fn_obra_rdo_salvar (mesma assinatura, guarda de empresa intacta): aceita p_dados.quantidade_executada; tela antiga
--    que não manda o campo não apaga a quantidade já gravada.
-- 3) fn_demo_seed_construtora_rdo (só a DEMO 006, is_demo): os diários da semente ganham quantidade (forro 40+60 m²,
--    drywall 35 m², pintura 3×95 m²) e completa a quantidade dos diários da semente já gravados (sem autor, mesmo
--    texto); roda uma vez agora.
-- 4) "?" (RD-95) do campo no diário e do quadro/ação no cronograma.
-- A conta (src/lib/hub/avancoDiario.ts) roda na tela; nada grava o % da tarefa sozinho: o usuário toca em "Usar".
-- RD-55: nenhum dado de cliente é alterado (coluna nova vazia; UPDATE só na DEMO 006). Plano de volta: recriar
-- fn_obra_rdo_salvar e fn_demo_seed_construtora_rdo como em 20261024190000/20261025120000; ALTER TABLE
-- projetos_obra_rdo DROP COLUMN quantidade_executada; DELETE das chaves projetos.os_obra.rdo_quantidade e
-- projetos.cronograma.avanco_diario*.
ALTER TABLE public.projetos_obra_rdo ADD COLUMN IF NOT EXISTS quantidade_executada numeric(14,4)
  CHECK (quantidade_executada IS NULL OR quantidade_executada >= 0);
COMMENT ON COLUMN public.projetos_obra_rdo.quantidade_executada IS
  'Quantidade do serviço da OS executada no dia (unidade do item do contrato). Alimenta o avanço pelo diário do cronograma.';

CREATE OR REPLACE FUNCTION public.fn_obra_rdo_salvar(p_os_id uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_company uuid; v_obra uuid; v_status text; v_id uuid;
  v_data date := COALESCE(NULLIF(p_dados->>'data', '')::date, current_date);
  v_clima text := COALESCE(NULLIF(p_dados->>'clima', ''), 'sol');
  v_efetivo integer := COALESCE(NULLIF(p_dados->>'efetivo', '')::integer, 0);
  v_ativ text := NULLIF(btrim(COALESCE(p_dados->>'atividades', '')), '');
  v_ocor text := NULLIF(btrim(COALESCE(p_dados->>'ocorrencias', '')), '');
  v_qtd numeric := NULLIF(replace(btrim(COALESCE(p_dados->>'quantidade_executada', '')), ',', '.'), '')::numeric;
  v_fotos text[] := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_dados->'fotos', '[]'::jsonb))), '{}');
BEGIN
  SELECT company_id, obra_id, status INTO v_company, v_obra, v_status
    FROM public.projetos_obra_os WHERE id = p_os_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_status NOT IN ('aberta', 'em_execucao') THEN
    RAISE EXCEPTION 'Só dá para lançar o diário em OS aberta ou em execução';
  END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'O diário é do dia que já aconteceu — a data não pode ser futura'; END IF;
  IF v_clima NOT IN ('sol', 'nublado', 'chuva', 'chuva_forte') THEN RAISE EXCEPTION 'Clima inválido'; END IF;
  IF v_efetivo < 0 THEN RAISE EXCEPTION 'O efetivo não pode ser negativo'; END IF;
  IF v_ativ IS NULL AND v_ocor IS NULL THEN RAISE EXCEPTION 'Conte o que foi feito ou o que aconteceu no dia'; END IF;
  IF v_qtd < 0 THEN RAISE EXCEPTION 'A quantidade executada não pode ser negativa'; END IF;
  IF cardinality(v_fotos) > 10 THEN RAISE EXCEPTION 'No máximo 10 fotos por dia'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_fotos) f WHERE f NOT LIKE v_company::text || '/rdo/' || p_os_id::text || '/%') THEN
    RAISE EXCEPTION 'Foto fora da pasta desta OS';
  END IF;

  SELECT id INTO v_id FROM public.projetos_obra_rdo WHERE os_id = p_os_id AND data = v_data AND excluido_em IS NULL;
  IF v_id IS NULL THEN
    INSERT INTO public.projetos_obra_rdo
      (company_id, obra_id, os_id, data, clima, praticavel, efetivo, atividades, ocorrencias, fotos, criado_por, quantidade_executada)
    VALUES (v_company, v_obra, p_os_id, v_data, v_clima, COALESCE((p_dados->>'praticavel')::boolean, true), v_efetivo,
      v_ativ, v_ocor, v_fotos, auth.uid(), v_qtd)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projetos_obra_rdo SET clima = v_clima, praticavel = COALESCE((p_dados->>'praticavel')::boolean, true),
      efetivo = v_efetivo, atividades = v_ativ, ocorrencias = v_ocor, fotos = v_fotos, atualizado_em = now(),
      -- tela antiga (sem o campo) não apaga a quantidade já lançada
      quantidade_executada = CASE WHEN p_dados ? 'quantidade_executada' THEN v_qtd ELSE quantidade_executada END
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_rdo_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_rdo_salvar(uuid, jsonb) TO authenticated, service_role;

-- ci-sem-guarda: fn_demo_seed_construtora_rdo — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_rdo(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_hoje date := current_date;
  v_ins int; v_qtd int;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  INSERT INTO projetos_obra_rdo (company_id, obra_id, os_id, data, clima, praticavel, efetivo, atividades, ocorrencias, quantidade_executada)
  SELECT c, os.obra_id, os.id, v_hoje + r.dia, r.clima, r.praticavel, r.efetivo, r.ativ, r.ocor, r.qtd
    FROM (VALUES
      ('OSO-0001', -18, 'sol', true, 4, 'Marcação dos níveis do forro no térreo com nível a laser; locação das tabicas.', NULL, NULL::numeric),
      ('OSO-0001', -17, 'nublado', true, 4, 'Conferência dos níveis com o engenheiro e liberação da etapa.', NULL, NULL::numeric),
      ('OSO-0002', -3, 'sol', true, 5, 'Início da estrutura do forro nas salas 1 e 2: pendurais e perfis F530.', NULL, 40),
      ('OSO-0002', -2, 'chuva_forte', false, 0, NULL, 'Chuva forte e falta de energia no bloco A; equipe dispensada às 9 h.', NULL::numeric),
      ('OSO-0002', -1, 'nublado', true, 5, 'Estrutura do forro concluída nas salas 1 a 3.', 'Faltaram 20 tirantes; pedido feito ao almoxarifado.', 60),
      ('OSO-0004', -2, 'chuva', false, 0, NULL, 'Chuva com goteira na recepção; aguardando o cliente vedar a laje.', NULL::numeric),
      ('OSO-0004', -1, 'sol', true, 3, 'Guias e montantes da recepção instalados; início do fechamento da sala de espera.', NULL, 35),
      ('OSO-0008', -14, 'sol', true, 3, 'Lixamento e primeira demão na sala comercial.', NULL, 95),
      ('OSO-0008', -13, 'chuva', true, 3, 'Segunda demão nas paredes internas (área coberta).', 'Chuva atrasou a secagem; fachada ficou para amanhã.', 95),
      ('OSO-0008', -12, 'sol', true, 2, 'Retoques, limpeza e entrega da sala ao cliente.', NULL, 95)
    ) AS r(numero, dia, clima, praticavel, efetivo, ativ, ocor, qtd)
    JOIN projetos_obra_os os ON os.company_id = c AND os.numero = r.numero AND os.excluido_em IS NULL
   WHERE v_hoje + r.dia <= v_hoje
     AND (os.iniciada_em IS NULL OR v_hoje + r.dia >= os.iniciada_em::date)
     AND (os.concluida_em IS NULL OR v_hoje + r.dia <= os.concluida_em::date)
     AND NOT EXISTS (SELECT 1 FROM projetos_obra_rdo x
                      WHERE x.os_id = os.id AND x.data = v_hoje + r.dia AND x.excluido_em IS NULL);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- diários da semente gravados antes da quantidade existir: completa só os da semente (mesma OS e mesmo texto, sem
  -- autor e ainda sem quantidade) — diário feito na tela nunca é sobrescrito
  UPDATE projetos_obra_rdo x SET quantidade_executada = q.qtd
    FROM (VALUES ('OSO-0002', 'Início da estrutura do forro nas salas 1 e 2: pendurais e perfis F530.', 40),
                 ('OSO-0002', 'Estrutura do forro concluída nas salas 1 a 3.', 60),
                 ('OSO-0004', 'Guias e montantes da recepção instalados; início do fechamento da sala de espera.', 35),
                 ('OSO-0008', 'Lixamento e primeira demão na sala comercial.', 95),
                 ('OSO-0008', 'Segunda demão nas paredes internas (área coberta).', 95),
                 ('OSO-0008', 'Retoques, limpeza e entrega da sala ao cliente.', 95)) AS q(numero, ativ, qtd)
    JOIN projetos_obra_os os ON os.company_id = c AND os.numero = q.numero AND os.excluido_em IS NULL
   WHERE x.company_id = c AND x.os_id = os.id AND x.atividades = q.ativ AND x.criado_por IS NULL
     AND x.quantidade_executada IS NULL AND x.excluido_em IS NULL;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'rdo_inseridos', v_ins, 'quantidade_completada', v_qtd,
    'rdo_demo', (SELECT count(*) FROM projetos_obra_rdo WHERE company_id = c AND excluido_em IS NULL));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_rdo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_rdo(uuid) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora_rdo('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;

-- RD-95: "?" do campo do diário e do quadro/ação do cronograma.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, v.vertical, 'publicado'
FROM (VALUES
 ('projetos.os_obra.rdo_quantidade', 'OS de obra', 'Quantidade executada no dia',
  'Quanto do serviço desta OS a equipe fez hoje, na unidade do serviço (m², m, un). Deixe vazio se o dia não teve produção medível.',
  'Vira o avanço físico da tarefa no cronograma: o que foi executado dividido pelo que a tarefa tem de fazer daquele serviço.',
  '34 (m² de forro fechados nas salas 201 e 202)', 'Lançar o total acumulado da obra em vez do que foi feito só neste dia — o avanço soma os dias.',
  31, '/dashboard/projetos/obras/os', 'hub_projetos'),
 ('projetos.cronograma.avanco_diario', 'Cronograma da obra', 'Avanço pelo diário de obra',
  'Nada a preencher: compara o avanço de cada tarefa no cronograma com o que a equipe lançou como executado no diário (RDO) das OS daquela tarefa.',
  'Mostra o avanço físico medido no canteiro. Conta: executado no diário ÷ quantidade que a tarefa tem do item (quantidade contratada × participação da tarefa; sem participação, o item inteiro). Com vários itens, pesa pelo valor de cada um.',
  'Estrutura do forro: cronograma 80%, diário 61% (100 de 165 m² lançados em 2 dias).',
  'Achar que o diário apaga o avanço digitado — nada muda até você tocar em "Usar".', 47,
  '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao'),
 ('projetos.cronograma.avanco_diario_usar', 'Cronograma da obra', 'Usar o avanço do diário',
  'Nada a preencher: confirme para gravar na tarefa o % que o diário mostra.',
  'Atualiza o avanço da tarefa (e a curva S, o Gantt e o histórico de avanço) com o que foi medido no canteiro.',
  'Pintura e entrega: de 60% para 100%.', 'Usar quando a equipe não lançou a quantidade em todos os dias — o % do diário fica menor que o real.',
  48, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota, vertical)
ON CONFLICT (chave) DO NOTHING;
