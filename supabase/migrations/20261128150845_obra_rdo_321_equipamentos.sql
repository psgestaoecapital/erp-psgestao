-- Hub · tela 321 (Diário de Obra / RDO) — campo "Equipamentos utilizados no dia".
-- Blueprint hub_projetos tela 321 (parcial): "Diário com clima, equipes e quantidade de trabalhadores,
-- equipamentos, materiais recebidos e usados, fornecedores, serviços iniciados/andamento/concluídos...".
-- Hoje o diário tem clima, efetivo, quantidade, atividades e ocorrências; FALTAVAM os campos estruturados.
-- Esta fatia entrega o EQUIPAMENTOS (texto livre), aditiva. Materiais/fornecedores/serviços seguem em fatias.
--
-- RD-26 (reusar): fn_obra_rdo_salvar (upsert por OS+dia) e projetos_obra_rdo (RLS por empresa já vigente) —
-- nenhuma tabela nova. RD-52: migration por arquivo+PR, acima da main, faixa de segundos :45-:54.
-- RD-38 (provado no dado, BEGIN...ROLLBACK leve numa OS DEMO em_execucao):
--   1) INSERT novo com equipamentos='Betoneira, andaime fachadeiro' -> persistiu;
--   2) save seguinte SEM a chave 'equipamentos' (tela antiga) -> efetivo mudou, equipamentos PRESERVADO
--      (guarda `p_dados ? 'equipamentos'`, igual à de quantidade_executada).

ALTER TABLE public.projetos_obra_rdo ADD COLUMN IF NOT EXISTS equipamentos text;

CREATE OR REPLACE FUNCTION public.fn_obra_rdo_salvar(p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid; v_obra uuid; v_status text; v_id uuid;
  v_data date := COALESCE(NULLIF(p_dados->>'data', '')::date, current_date);
  v_clima text := COALESCE(NULLIF(p_dados->>'clima', ''), 'sol');
  v_efetivo integer := COALESCE(NULLIF(p_dados->>'efetivo', '')::integer, 0);
  v_ativ text := NULLIF(btrim(COALESCE(p_dados->>'atividades', '')), '');
  v_ocor text := NULLIF(btrim(COALESCE(p_dados->>'ocorrencias', '')), '');
  v_equip text := NULLIF(btrim(COALESCE(p_dados->>'equipamentos', '')), '');
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
      (company_id, obra_id, os_id, data, clima, praticavel, efetivo, atividades, ocorrencias, equipamentos, fotos, criado_por, quantidade_executada)
    VALUES (v_company, v_obra, p_os_id, v_data, v_clima, COALESCE((p_dados->>'praticavel')::boolean, true), v_efetivo,
      v_ativ, v_ocor, v_equip, v_fotos, auth.uid(), v_qtd)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projetos_obra_rdo SET clima = v_clima, praticavel = COALESCE((p_dados->>'praticavel')::boolean, true),
      efetivo = v_efetivo, atividades = v_ativ, ocorrencias = v_ocor, fotos = v_fotos, atualizado_em = now(),
      -- tela antiga (sem o campo) não apaga o equipamento nem a quantidade já lançados
      equipamentos = CASE WHEN p_dados ? 'equipamentos' THEN v_equip ELSE equipamentos END,
      quantidade_executada = CASE WHEN p_dados ? 'quantidade_executada' THEN v_qtd ELSE quantidade_executada END
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- Guarda (check-fn-guards · regra 1): o CREATE OR REPLACE acima é SECURITY DEFINER, então o REVOKE anon tem de
-- ser reafirmado nesta migration. Mantém os grants atuais da função (authenticated + service_role), sem abrir a anon.
REVOKE ALL ON FUNCTION public.fn_obra_rdo_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_rdo_salvar(uuid, jsonb) TO authenticated, service_role;

-- RD-95: "?" do novo campo (mesmo padrão e rota dos demais campos do RDO: tela de OS).
-- Idempotente sem depender de constraint única em chave.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT
  'projetos.os_obra.rdo_equipamentos', '/dashboard/projetos/obras/os', 'OS de obra', 'Equipamentos utilizados',
  'Os equipamentos usados na obra no dia (próprios ou alugados), separados por vírgula.',
  'Registra o uso de equipamento no diário — base para custo de locação, manutenção e produtividade.',
  'Betoneira, andaime fachadeiro, serra circular',
  'Deixar em branco quando houve equipamento — perde o rastro de uso e locação.',
  'hub_projetos', 28, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'projetos.os_obra.rdo_equipamentos');
