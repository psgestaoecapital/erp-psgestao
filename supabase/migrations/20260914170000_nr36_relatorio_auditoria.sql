-- ============================================================
-- SST ② · Relatório de auditoria trabalhista (NR-36 / Art. 253) — valor probatório
-- ============================================================
-- Depende do ① (motor sequencial + classe_evento + status conforme/desvio/sem_dado).
-- O que dá valor de prova (SPEC §3.1): cada número aponta o registro de origem, base legal
-- citada, parâmetros vigentes, jornada REAL (marcação) confrontada com a exposição, desvios
-- em minutos, se a marcação foi ajustada à mão, e um hash + registro de emissão auditável.
--
-- ⚠️ FUSO (decisão 14/09, contexto a4a440da): ind_ponto_marcacao grava hora LOCAL rotulada
-- como +00:00; ind_ponto_pausa grava UTC correto. Ao cruzar, normalizo para HORA DE PAREDE local:
--   marcação → AT TIME ZONE 'UTC'  (tira o rótulo falso, vira o relógio local)
--   pausa    → AT TIME ZONE 'America/Sao_Paulo'  (UTC → local)
-- Provado com caso real (CPF 00795909004, 31/08): as 3 exposições caem DENTRO da jornada
-- 06:56–17:46; SEM normalizar, a que termina 20:00 UTC cairia 3h fora (catastrófico no MTE).

-- 1) Registro de emissão — o relatório vira documento auditável (quem, quando, período, hash).
CREATE TABLE IF NOT EXISTS public.nr36_relatorio_emissao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  dt_ini            date NOT NULL,
  dt_fim            date NOT NULL,
  emitido_por       uuid,
  emitido_por_email text,
  emitido_em        timestamptz NOT NULL DEFAULT now(),
  hash              text NOT NULL,
  parametros        jsonb,
  resumo            jsonb
);
ALTER TABLE public.nr36_relatorio_emissao ENABLE ROW LEVEL SECURITY;
-- acesso só via funções SECURITY DEFINER (fn_nr36_assert já gate por tenant/admin); sem policy aberta.

-- 2) O relatório. p_registrar=true grava a emissão (com hash). Normaliza o fuso na leitura.
CREATE OR REPLACE FUNCTION public.fn_nr36_relatorio_auditoria(
  p_company_id uuid, p_dt_ini date, p_dt_fim date, p_registrar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_emp jsonb; v_regras jsonb; v_colabs jsonb; v_hash text; v_canon text;
  v_uid uuid := auth.uid(); v_email text; v_report jsonb; v_emissao_id uuid;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);

  SELECT jsonb_build_object('razao_social',razao_social,'nome_fantasia',nome_fantasia,'cnpj',cnpj,'cnae',cnae,'endereco',endereco)
    INTO v_emp FROM public.companies WHERE id=p_company_id;
  SELECT jsonb_agg(jsonb_build_object('tipo',tipo,'nome',nome,'base_legal',base_legal,'parametros',parametros) ORDER BY tipo)
    INTO v_regras FROM public.nr36_pausa_regra WHERE company_id=p_company_id AND ativo;

  SELECT jsonb_agg(c ORDER BY nome_ord) INTO v_colabs FROM (
    SELECT col.nome AS nome_ord, jsonb_build_object(
      'cpf', col.cpf, 'nome', col.nome, 'matricula', col.matricula, 'funcao', col.funcao,
      'setor', col.departamento, 'equipe', col.equipe,
      'dias', (
        SELECT jsonb_agg(jsonb_build_object(
          'data', ap.data, 'tipo', ap.tipo, 'status', ap.status,
          'shift', ap.detalhe->'jornada'->>'shift',
          'jornada', (SELECT jsonb_build_object(
                        'entrada', to_char(min(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'),
                        'saida',   to_char(max(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'),
                        'ajustada', COALESCE(bool_or(mm.is_adjusted),false),
                        'origem',  (array_agg(DISTINCT mm.origin))[1],
                        'pontos',  count(*))
                      FROM public.ind_ponto_marcacao mm
                      WHERE mm.company_id=ap.company_id AND mm.cpf=ap.cpf AND mm.data=ap.data),
          'eventos', (SELECT jsonb_agg(jsonb_build_object(
                        'classe', pp.classe_evento, 'dur_min', round(pp.duracao_seg/60.0)::int,
                        'inicio', to_char(pp.inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
                        'fim', CASE WHEN pp.fim IS NULL THEN NULL ELSE to_char(pp.fim AT TIME ZONE 'America/Sao_Paulo','HH24:MI') END,
                        'point_id', pp.point_id) ORDER BY pp.inicio)
                      FROM public.ind_ponto_pausa pp
                      WHERE pp.company_id=ap.company_id AND pp.cpf=ap.cpf AND pp.data=ap.data),
          'desvios', COALESCE(ap.detalhe->'desvios','[]'::jsonb),
          'sem_dado_motivo', ap.detalhe->>'sem_dado_motivo'
        ) ORDER BY ap.data)
        FROM public.nr36_pausa_apurada ap
        WHERE ap.company_id=p_company_id AND ap.colaborador_id=col.id AND ap.data BETWEEN p_dt_ini AND p_dt_fim
      )
    ) AS c
    FROM public.ind_ponto_colaborador col
    WHERE col.company_id=p_company_id
      AND EXISTS (SELECT 1 FROM public.nr36_pausa_apurada ap
                   WHERE ap.company_id=p_company_id AND ap.colaborador_id=col.id AND ap.data BETWEEN p_dt_ini AND p_dt_fim)
  ) q;

  -- hash sobre o conteúdo canônico (sem timestamp de emissão) → estável e verificável.
  v_canon := (jsonb_build_object('empresa',v_emp,'periodo',jsonb_build_object('ini',p_dt_ini,'fim',p_dt_fim),
              'regras',v_regras,'colaboradores',COALESCE(v_colabs,'[]'::jsonb)))::text;
  v_hash := encode(extensions.digest(v_canon,'sha256'),'hex');  -- pgcrypto vive no schema extensions
  SELECT email INTO v_email FROM auth.users WHERE id=v_uid;

  v_report := jsonb_build_object(
    'empresa', v_emp,
    'periodo', jsonb_build_object('ini',p_dt_ini,'fim',p_dt_fim,'emitido_em', now()),
    'regras', v_regras,
    'colaboradores', COALESCE(v_colabs,'[]'::jsonb),
    'hash', v_hash,
    'emitido_por', jsonb_build_object('uid',v_uid,'email',v_email),
    'nota_fuso', 'Horários em hora local. Marcação e exposição normalizadas para o mesmo fuso (America/Sao_Paulo).');

  IF p_registrar THEN
    INSERT INTO public.nr36_relatorio_emissao (company_id, dt_ini, dt_fim, emitido_por, emitido_por_email, hash, parametros, resumo)
    VALUES (p_company_id, p_dt_ini, p_dt_fim, v_uid, v_email, v_hash, v_regras,
            jsonb_build_object('colaboradores', jsonb_array_length(COALESCE(v_colabs,'[]'::jsonb))))
    RETURNING id INTO v_emissao_id;
    v_report := v_report || jsonb_build_object('emissao_id', v_emissao_id);
  END IF;

  RETURN v_report;
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_relatorio_auditoria(uuid,date,date,boolean) TO authenticated;

-- 3) Histórico de emissões (para a aba). Só leitura, gate por tenant/admin.
CREATE OR REPLACE FUNCTION public.fn_nr36_relatorio_emissoes_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'dt_ini',dt_ini,'dt_fim',dt_fim,'emitido_por_email',emitido_por_email,
    'emitido_em',emitido_em,'hash',hash,'resumo',resumo) ORDER BY emitido_em DESC), '[]'::jsonb)
    INTO v FROM public.nr36_relatorio_emissao WHERE company_id=p_company_id;
  RETURN jsonb_build_object('ok',true,'emissoes',v);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_relatorio_emissoes_listar(uuid) TO authenticated;
