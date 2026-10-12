-- PONTO · CLASSIFICADOR DE INFRAÇÕES (LOTE 1) — DERIVADO/aditivo, NUNCA reescreve ind_ponto_* (RD-55).
-- Passivo trabalhista: mostra QUAL infração, com base legal e gravidade. "possível infração — confira"
-- (indício, não parecer). RD-51: quando o dado não fecha → status 'a_revisar', jamais chuta o tipo.
-- Defaults CLT, parametrizável por empresa (acordo coletivo pode mudar). Mantém exclusão de jornada_externa
-- (mesma predicate do BI: ind_pessoa.jornada_externa por matrícula/cpf). Escala via fn_ponto_escala_segundos.
-- Visibilidade PS/dono até o RH validar (guard na função). Trilha de acesso nominal em audit_log_global (LGPD).
-- LOTE 1 = 4 tipos de CERTEZA: jornada>10h · extra>2h/dia · marcação ímpar (a_revisar) · interjornada<11h.
-- LOTE 2 (precisa calendário/acordo): intervalo intrajornada · DSR · domingo/feriado · noturno · banco de horas.
-- Prova (Frioeste real, jan–jul/2026, autenticado PS_ADMIN): jornada=768 · extra=410 · impar=158 · interjornada=139.
-- Reverter: DROP FUNCTION fn_ponto_infracoes + DROP TABLE ind_ponto_regra (nada em ind_ponto_* foi tocado).

-- 1 · Parâmetros por empresa (default CLT). ativo=false desliga o tipo.
CREATE TABLE IF NOT EXISTS public.ind_ponto_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tipo text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  gravidade text NOT NULL DEFAULT 'media',          -- alta | media | baixa
  base_legal text,
  descricao text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, tipo)
);
ALTER TABLE public.ind_ponto_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ind_ponto_regra_sel ON public.ind_ponto_regra;
CREATE POLICY ind_ponto_regra_sel ON public.ind_ponto_regra FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Seed Frioeste com defaults CLT (parametrizável depois pelo acordo coletivo, via RH).
INSERT INTO public.ind_ponto_regra (company_id, tipo, ativo, gravidade, base_legal, descricao, params) VALUES
 ('975365cc-9e5a-4251-9022-68c6bfde10d8','_global', true, 'baixa', 'CLT art.58 §1º',
   'Tolerância de marcação (não gera infração dentro dela).', '{"tol_marcacao_min":5,"tol_dia_min":10}'),
 ('975365cc-9e5a-4251-9022-68c6bfde10d8','jornada_acima_10h', true, 'alta', 'CLT art.58/59',
   'Jornada acima de 10h (8h + 2h extras).', '{"limite_h":10}'),
 ('975365cc-9e5a-4251-9022-68c6bfde10d8','extra_acima_2h', true, 'media', 'CLT art.59',
   'Horas extras acima do limite de 2h/dia.', '{"limite_h":2}'),
 ('975365cc-9e5a-4251-9022-68c6bfde10d8','marcacao_impar', true, 'media', 'Portaria 671/2021',
   'Marcação incompleta (nº de batidas ímpar) — entrada sem saída ou vice-versa.', '{}'),
 ('975365cc-9e5a-4251-9022-68c6bfde10d8','interjornada_11h', true, 'alta', 'CLT art.66',
   'Interjornada inferior a 11h entre o fim de uma jornada e o início da seguinte.', '{"limite_h":11}')
ON CONFLICT (company_id, tipo) DO NOTHING;

-- 2 · Classificador (derivado). Guard: PS_ADMIN ou CLIENT_OWNER da empresa (visibilidade PS/dono).
CREATE OR REPLACE FUNCTION public.fn_ponto_infracoes(
  p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL, p_cpf text DEFAULT NULL)
RETURNS TABLE(cpf text, nome text, data date, tipo text, titulo text, descricao text,
             horarios text, base_legal text, gravidade text, status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pode boolean;
  v_tol_dia_seg numeric;
  v_lim_jornada_h numeric; v_lim_extra_h numeric; v_lim_inter_h numeric;
  v_on_jornada boolean; v_on_extra boolean; v_on_impar boolean; v_on_inter boolean;
BEGIN
  v_pode := EXISTS (SELECT 1 FROM users u WHERE u.id=v_uid AND u.system_role='PS_ADMIN')
         OR EXISTS (SELECT 1 FROM tenant_user_roles t WHERE t.user_id=v_uid AND t.company_id=p_company_id
                    AND t.role='CLIENT_OWNER' AND t.is_active);
  IF NOT v_pode THEN
    RAISE EXCEPTION 'Classificação de infrações é restrita à equipe PS e ao dono da empresa (até validação do RH).';
  END IF;

  v_tol_dia_seg   := coalesce((SELECT (r.params->>'tol_dia_min')::numeric FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='_global'),10)*60;
  v_lim_jornada_h := coalesce((SELECT (r.params->>'limite_h')::numeric FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='jornada_acima_10h'),10);
  v_lim_extra_h   := coalesce((SELECT (r.params->>'limite_h')::numeric FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='extra_acima_2h'),2);
  v_lim_inter_h   := coalesce((SELECT (r.params->>'limite_h')::numeric FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='interjornada_11h'),11);
  v_on_jornada := coalesce((SELECT r.ativo FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='jornada_acima_10h'),true);
  v_on_extra   := coalesce((SELECT r.ativo FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='extra_acima_2h'),true);
  v_on_impar   := coalesce((SELECT r.ativo FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='marcacao_impar'),true);
  v_on_inter   := coalesce((SELECT r.ativo FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='interjornada_11h'),true);

  -- trilha de acesso a dado nominal (LGPD)
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  SELECT p_company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'ind_ponto (infrações)',
         coalesce(p_cpf,'(todos)'), 'PONTO_INFRACOES_CONSULTA',
         jsonb_build_object('ini',p_data_ini,'fim',p_data_fim,'departamento',p_departamento);

  RETURN QUERY
  WITH externa AS (  -- CPFs jornada_externa (excluídos — decisão registrada)
    SELECT DISTINCT d.cpf FROM ind_ponto_dia d
    WHERE d.company_id=p_company_id AND EXISTS (
      SELECT 1 FROM ind_pessoa pp WHERE pp.company_id=d.company_id AND pp.jornada_externa
        AND (pp.matricula::text=d.registration_number OR pp.cpf=d.cpf))
  ),
  dia AS (
    SELECT d.cpf, d.data, coalesce(d.worked_seconds,0) AS ws,
           GREATEST(coalesce(d.worked_seconds,0)-fn_ponto_escala_segundos(d.shift),0) AS extra_seg,
           coalesce(d.total_pontos,0) AS pontos, d.department
    FROM ind_ponto_dia d
    WHERE d.company_id=p_company_id AND d.data BETWEEN p_data_ini AND p_data_fim
      AND (p_departamento IS NULL OR d.department=p_departamento)
      AND (p_cpf IS NULL OR d.cpf=p_cpf)
      AND d.cpf NOT IN (SELECT e.cpf FROM externa e)
  ),
  punch AS (
    SELECT m.cpf, m.data, min(m.datetime) AS first_ts, max(m.datetime) AS last_ts, count(*) AS n
    FROM ind_ponto_marcacao m
    WHERE m.company_id=p_company_id AND m.data BETWEEN (p_data_ini-1) AND p_data_fim
      AND (p_cpf IS NULL OR m.cpf=p_cpf) AND m.cpf NOT IN (SELECT e.cpf FROM externa e)
    GROUP BY m.cpf, m.data
  ),
  inter AS (
    SELECT p.cpf, p.data, p.first_ts,
           lag(p.last_ts) OVER (PARTITION BY p.cpf ORDER BY p.data) AS prev_last_ts
    FROM punch p
  ),
  nomes AS (SELECT DISTINCT ON (c.cpf) c.cpf, c.nome FROM ind_ponto_colaborador c WHERE c.company_id=p_company_id)
  -- A · Jornada > 10h
  SELECT dia.cpf, n.nome, dia.data, 'jornada_acima_10h'::text,
    'Jornada acima de '||v_lim_jornada_h||'h',
    'Trabalhou '||to_char((dia.ws/3600.0)::numeric,'FM990.0')||'h no dia (limite '||v_lim_jornada_h||'h). Possível infração — confira.',
    'trabalhadas: '||to_char((dia.ws/3600.0)::numeric,'FM990.0')||'h',
    'CLT art.58/59','alta','indicio'
  FROM dia LEFT JOIN nomes n ON n.cpf=dia.cpf
  WHERE v_on_jornada AND dia.ws > (v_lim_jornada_h*3600 + v_tol_dia_seg)
  UNION ALL
  -- B · Extra > 2h/dia
  SELECT dia.cpf, n.nome, dia.data, 'extra_acima_2h'::text,
    'Horas extras acima de '||v_lim_extra_h||'h',
    'Extras de '||to_char((dia.extra_seg/3600.0)::numeric,'FM990.0')||'h no dia (limite '||v_lim_extra_h||'h/dia). Possível infração — confira.',
    'extras: '||to_char((dia.extra_seg/3600.0)::numeric,'FM990.0')||'h',
    'CLT art.59','media','indicio'
  FROM dia LEFT JOIN nomes n ON n.cpf=dia.cpf
  WHERE v_on_extra AND dia.extra_seg > (v_lim_extra_h*3600 + v_tol_dia_seg)
  UNION ALL
  -- C · Marcação ímpar (a_revisar — não fecha o cálculo com certeza)
  SELECT dia.cpf, n.nome, dia.data, 'marcacao_impar'::text,
    'Marcação incompleta',
    dia.pontos||' batidas no dia (nº ímpar) — entrada sem saída (ou vice-versa). A revisar antes de tratar.',
    dia.pontos||' batidas',
    'Portaria 671/2021','media','a_revisar'
  FROM dia LEFT JOIN nomes n ON n.cpf=dia.cpf
  WHERE v_on_impar AND dia.pontos>0 AND (dia.pontos % 2)=1
  UNION ALL
  -- D · Interjornada < 11h (fim de um dia -> início do seguinte)
  SELECT inter.cpf, n.nome, inter.data, 'interjornada_11h'::text,
    'Interjornada inferior a '||v_lim_inter_h||'h',
    'Saiu '||to_char(inter.prev_last_ts,'DD/MM HH24:MI')||', voltou '||to_char(inter.first_ts,'DD/MM HH24:MI')||
      ' ('||to_char((extract(epoch FROM inter.first_ts-inter.prev_last_ts)/3600.0)::numeric,'FM990.0')||'h de descanso, mínimo '||v_lim_inter_h||'h). Possível infração — confira.',
    'descanso: '||to_char((extract(epoch FROM inter.first_ts-inter.prev_last_ts)/3600.0)::numeric,'FM990.0')||'h',
    'CLT art.66','alta','indicio'
  FROM inter LEFT JOIN nomes n ON n.cpf=inter.cpf
  WHERE v_on_inter AND inter.prev_last_ts IS NOT NULL
    AND inter.data BETWEEN p_data_ini AND p_data_fim
    AND (inter.first_ts - inter.prev_last_ts) < make_interval(hours => v_lim_inter_h::int)
  ORDER BY 3, 1, 4;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_ponto_infracoes(uuid, date, date, text, text) TO authenticated;
