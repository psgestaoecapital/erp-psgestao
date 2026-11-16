-- Ponto Eletrônico: lançamento MANUAL de horas (fallback sem provider integrado).
-- Gap (aud8 92/95, critério a): empresa sem relógio/integração conectada não conseguia
-- registrar NENHUMA hora — a tela ficava só no empty-state "Nenhum provider conectado".
-- Esta função deixa a empresa operar o ponto manualmente (provider='manual'), alimentando
-- as mesmas tabelas (ind_ponto_colaborador / ind_ponto_horas) que o BI e o compliance já leem.
--
-- RD-26: REUSA o modelo existente (raw.total_hours.worked_time em HH:MM, lido por
--        fn_ponto_bi_agregado via fn_hhmm_decimal) e o guard get_user_company_ids().
-- Segurança: SECURITY DEFINER + guarda por empresa; REVOKE anon; aditiva; não toca dado de
--        outra empresa. Re-lançar o mesmo colaborador+período substitui o manual anterior
--        (editar/corrigir, RD-98), sem mexer em registros vindos de provider.
-- Faixa desenvolvedor_4_g (segundos :45).

CREATE OR REPLACE FUNCTION public.fn_ponto_horas_manual_lancar(
  p_company_id      uuid,
  p_cpf             text,
  p_nome            text,
  p_periodo_inicio  date,
  p_periodo_fim     date,
  p_total_horas     numeric,
  p_funcao          text DEFAULT NULL,
  p_departamento    text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cpf   text := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  v_nome  text := NULLIF(btrim(COALESCE(p_nome, '')), '');
  v_h     int;
  v_m     int;
  v_worked text;
  v_raw   jsonb;
  v_id    uuid;
BEGIN
  -- Guarda por empresa (mesma usada no BI de ponto)
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  IF v_cpf = '' THEN
    RAISE EXCEPTION 'Informe o CPF do colaborador';
  END IF;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do colaborador';
  END IF;
  IF p_periodo_inicio IS NULL OR p_periodo_fim IS NULL OR p_periodo_fim < p_periodo_inicio THEN
    RAISE EXCEPTION 'Período inválido: a data fim não pode ser anterior ao início';
  END IF;
  IF p_total_horas IS NULL OR p_total_horas < 0 OR p_total_horas > 1000 THEN
    RAISE EXCEPTION 'Total de horas inválido (informe um valor entre 0 e 1000)';
  END IF;

  -- HH:MM que o BI (fn_ponto_bi_agregado / fn_hhmm_decimal) sabe ler
  v_h := floor(p_total_horas)::int;
  v_m := round((p_total_horas - floor(p_total_horas)) * 60)::int;
  IF v_m = 60 THEN v_h := v_h + 1; v_m := 0; END IF;
  -- Horas NÃO são padded (podem ter 3 dígitos: 176h). lpad trunca strings maiores que o
  -- tamanho — lpad('176',2,'0') = '17' —, então só os minutos levam o zero à esquerda.
  v_worked := v_h::text || ':' || lpad(v_m::text, 2, '0');

  v_raw := jsonb_build_object(
    'total_hours', jsonb_build_object('worked_time', v_worked),
    'origem',      'manual',
    'lancado_por', auth.uid(),
    'lancado_em',  now()
  );

  -- Colaborador: cria se não existir; se existir, só completa o que está vazio (não sobrescreve sync)
  SELECT id INTO v_id
  FROM ind_ponto_colaborador
  WHERE company_id = p_company_id AND regexp_replace(COALESCE(cpf,''), '\D', '', 'g') = v_cpf
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO ind_ponto_colaborador (company_id, provider, cpf, nome, funcao, departamento, raw, sincronizado_em)
    VALUES (p_company_id, 'manual', v_cpf, v_nome, NULLIF(btrim(COALESCE(p_funcao,'')),''),
            NULLIF(btrim(COALESCE(p_departamento,'')),''),
            jsonb_build_object('origem','manual','lancado_por',auth.uid()), now());
  ELSE
    UPDATE ind_ponto_colaborador
       SET nome        = COALESCE(nome, v_nome),
           funcao      = COALESCE(funcao, NULLIF(btrim(COALESCE(p_funcao,'')),'')),
           departamento= COALESCE(departamento, NULLIF(btrim(COALESCE(p_departamento,'')),''))
     WHERE id = v_id;
  END IF;

  -- Idempotência/edição: substitui o lançamento MANUAL anterior do mesmo colaborador+período.
  -- Nunca remove registros de provider integrado.
  DELETE FROM ind_ponto_horas
   WHERE company_id = p_company_id AND provider = 'manual'
     AND regexp_replace(COALESCE(cpf,''), '\D', '', 'g') = v_cpf
     AND periodo_inicio = p_periodo_inicio AND periodo_fim = p_periodo_fim;

  INSERT INTO ind_ponto_horas (company_id, provider, cpf, periodo_inicio, periodo_fim, total_horas,
                               funcao, departamento, raw, sincronizado_em)
  VALUES (p_company_id, 'manual', v_cpf, p_periodo_inicio, p_periodo_fim, round(p_total_horas, 2),
          NULLIF(btrim(COALESCE(p_funcao,'')),''), NULLIF(btrim(COALESCE(p_departamento,'')),''),
          v_raw, now())
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id, 'cpf', v_cpf, 'total_horas', round(p_total_horas,2), 'worked_time', v_worked);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ponto_horas_manual_lancar(uuid,text,text,date,date,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ponto_horas_manual_lancar(uuid,text,text,date,date,numeric,text,text) TO authenticated, service_role;

-- RD-95: "?" dos campos do lançamento manual
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('ponto.manual.abrir', '/dashboard/industrial/ponto', 'Lançamento manual', 'Lançar horas manualmente',
   'Use quando a empresa ainda não tem um relógio de ponto integrado: registre o total de horas de cada colaborador no período, à mão.',
   'Permite operar o ponto sem integração — as horas lançadas entram nos mesmos relatórios e no Painel de Jornada.',
   'Ex.: fechamento de outubro de um colaborador: 176 horas no período 01/10 a 31/10.',
   'Esquecer de lançar: sem relógio integrado e sem lançamento manual, a tela fica sem horas e o Painel vem zerado.',
   'industrial', 50, 'publicado'),
  ('ponto.manual.cpf', '/dashboard/industrial/ponto', 'Lançamento manual', 'CPF do colaborador',
   'Digite o CPF de quem trabalhou as horas. Pode digitar com ou sem pontuação — o sistema guarda só os números.',
   'Identifica o colaborador de forma única e liga o lançamento à ficha dele (reaproveita se já existir).',
   'Ex.: 123.456.789-00',
   'CPF errado cria um colaborador duplicado; confira antes de salvar.',
   'industrial', 51, 'publicado'),
  ('ponto.manual.nome', '/dashboard/industrial/ponto', 'Lançamento manual', 'Nome do colaborador',
   'Nome completo de quem trabalhou as horas.',
   'Aparece nas listas de Colaboradores e Histórico de horas e nos relatórios.',
   'Ex.: João da Silva',
   'Abreviar demais dificulta achar a pessoa depois nas listas.',
   'industrial', 52, 'publicado'),
  ('ponto.manual.funcao', '/dashboard/industrial/ponto', 'Lançamento manual', 'Função (opcional)',
   'Cargo/função do colaborador, se quiser registrar. Pode deixar em branco.',
   'Ajuda a agrupar e filtrar as horas por função nos relatórios.',
   'Ex.: Operador de produção',
   'Sem função, o relatório agrupa como "(sem função)" — não é erro, só menos detalhe.',
   'industrial', 53, 'publicado'),
  ('ponto.manual.periodo', '/dashboard/industrial/ponto', 'Lançamento manual', 'Período (início e fim)',
   'O intervalo de datas a que as horas se referem — normalmente o mês do fechamento.',
   'Define em que período as horas entram nos relatórios e no Painel. Lançar de novo o mesmo colaborador no MESMO período substitui o valor anterior.',
   'Ex.: 01/10/2026 a 31/10/2026.',
   'Fim antes do início: o sistema recusa. Períodos sobrepostos com valores diferentes podem contar horas em dobro.',
   'industrial', 54, 'publicado'),
  ('ponto.manual.total_horas', '/dashboard/industrial/ponto', 'Lançamento manual', 'Total de horas no período',
   'O total de horas trabalhadas no período, em horas decimais (use ponto ou vírgula: 176 ou 176,5).',
   'É o número que alimenta o fechamento e o Painel de Jornada para esse colaborador.',
   'Ex.: 176 (oito horas em 22 dias) ou 176,5 para 176 horas e 30 minutos.',
   'Digitar minutos como se fossem horas: 176,30 vira 176h18min (0,30h), não 176h30min. Para 30 min, use 176,5.',
   'industrial', 55, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
