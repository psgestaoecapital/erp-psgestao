-- Pausas térmicas · Conferência (#3842, Karol): ao conferir/corrigir um dia COM o colaborador, poder anexar o
-- documento impresso que ele assinou (comprovando ciência do ajuste). O comprovante fica junto da releitura
-- justificada daquele dia, como prova de que o colaborador teve ciência — exigência de auditoria da NR-36.
--
-- Aditiva: coluna nova (nullable) em nr36_releitura_justificativa + fn_nr36_reler_dia_justificado ganha um parâmetro
-- OPCIONAL (p_comprovante_urls). Nenhum chamador existente precisa mudar; sem comprovante o fluxo é idêntico ao de hoje.
-- Os arquivos ficam no bucket compliance-pausas (mesmo da importação), sob o caminho da empresa; aqui guardamos só o path.

-- 1) coluna do(s) comprovante(s) assinado(s) — caminhos no Storage (bucket compliance-pausas)
ALTER TABLE public.nr36_releitura_justificativa
  ADD COLUMN IF NOT EXISTS comprovante_urls text[];
COMMENT ON COLUMN public.nr36_releitura_justificativa.comprovante_urls IS
  '#3842 · caminhos (Storage/compliance-pausas) do documento assinado pelo colaborador, provando ciência do ajuste do dia.';

-- 2) a releitura justificada passa a aceitar e guardar o(s) comprovante(s) (parâmetro opcional, no fim)
CREATE OR REPLACE FUNCTION public.fn_nr36_reler_dia_justificado(
  p_company_id uuid, p_cpf text, p_data date, p_marcas jsonb, p_justificativa text,
  p_origem text DEFAULT 'manual'::text, p_pendencia_ciente boolean DEFAULT false,
  p_comprovante_urls text[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_antes jsonb; v_r jsonb; v_lote uuid; v_m record; v_aberta text; v_pend jsonb := '[]'::jsonb;
  v_sem_origem text; v_ciencia jsonb; v_just text := btrim(COALESCE(p_justificativa, ''));
  -- #3842 · só caminhos não-vazios; array vazio vira NULL (nada anexado)
  v_comprovantes text[] := NULLIF(ARRAY(SELECT btrim(u) FROM unnest(COALESCE(p_comprovante_urls, '{}'::text[])) u WHERE btrim(u) <> ''), '{}'::text[]);
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF length(v_just) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_justificativa',
      'mensagem', 'Escreva a justificativa (pelo menos 10 caracteres): por que este dia está sendo corrigido.');
  END IF;
  IF COALESCE(p_origem, '') NOT IN ('sugestao', 'manual') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem_invalida', 'mensagem', 'Origem da correção inválida.');
  END IF;
  IF p_marcas IS NULL OR jsonb_typeof(p_marcas) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_marcas', 'mensagem', 'Informe as marcações do dia.');
  END IF;

  -- horário digitado diz de onde veio (catraca | conferido com o colaborador); o que já era ajuste ativo segue como está
  SELECT string_agg(m->>'hora', ', ' ORDER BY m->>'hora') INTO v_sem_origem
    FROM jsonb_array_elements(p_marcas) m
   WHERE COALESCE(m->>'origem', 'arquivo') = 'manual' AND m->>'papel' IN ('saida', 'retorno')
     AND COALESCE(m->>'origem_ajuste', '') NOT IN ('catraca', 'conferido_colaborador')
     AND NOT EXISTS (SELECT 1 FROM public.nr36_batida_ajuste a
                      WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data AND a.removido_em IS NULL
                        AND a.hora = m->>'hora' AND a.papel = m->>'papel');
  IF v_sem_origem IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem_ajuste_obrigatoria',
      'mensagem', format('Diga de onde veio o horário digitado (%s): catraca ou conferido com o colaborador.', v_sem_origem));
  END IF;

  -- pendências que a releitura deixaria (mesma regra de pareamento de fn_nr36_reler_dia / lib pausasMarcas)
  v_aberta := NULL;
  FOR v_m IN SELECT m->>'hora' AS hora, m->>'papel' AS papel FROM jsonb_array_elements(p_marcas) m
              WHERE m->>'papel' IN ('saida', 'retorno') ORDER BY m->>'hora' LOOP
    IF v_m.papel = 'saida' THEN
      IF v_aberta IS NOT NULL THEN v_pend := v_pend || jsonb_build_object('tipo', 'sem_retorno', 'hora', v_aberta); END IF;
      v_aberta := v_m.hora;
    ELSIF v_aberta IS NOT NULL THEN
      v_aberta := NULL;
    ELSE
      v_pend := v_pend || jsonb_build_object('tipo', 'sem_saida', 'hora', v_m.hora);
    END IF;
  END LOOP;
  IF v_aberta IS NOT NULL THEN v_pend := v_pend || jsonb_build_object('tipo', 'sem_retorno', 'hora', v_aberta); END IF;
  IF jsonb_array_length(v_pend) > 0 AND NOT COALESCE(p_pendencia_ciente, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'falta_horario', 'pendencias', v_pend,
      'mensagem', 'Falta horário: ' || (SELECT string_agg(CASE WHEN p->>'tipo' = 'sem_saida' THEN 'a saída do retorno das ' || (p->>'hora')
                                                               ELSE 'o retorno da saída das ' || (p->>'hora') END, '; ')
                                          FROM jsonb_array_elements(v_pend) p)
        || '. Digite o horário (ex.: da catraca) em "Horário que faltou" ou marque que não sabe — aí o dia continua pendente.');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'inicio', to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
           'fim', to_char(COALESCE(p.fim_confirmado, p.fim) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
           'classe', p.classe_evento) ORDER BY p.inicio NULLS FIRST)
    INTO v_antes
    FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data;

  v_r := public.fn_nr36_reler_dia(p_company_id, p_cpf, p_data, p_marcas);
  IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN RETURN v_r; END IF;
  v_lote := (v_r->>'lote')::uuid;

  INSERT INTO public.nr36_releitura_justificativa (company_id, cpf, data, lote, origem, justificativa, marcas, antes, autor_id,
    pendencia_ciente, pendencias, comprovante_urls)
  VALUES (p_company_id, p_cpf, p_data, v_lote, p_origem, v_just, p_marcas, v_antes, auth.uid(),
    jsonb_array_length(v_pend) > 0, NULLIF(v_pend, '[]'::jsonb), v_comprovantes);

  -- camada de ajuste: ajuste ativo que saiu das marcas é encerrado (fica guardado); horário digitado novo entra
  UPDATE public.nr36_batida_ajuste a SET removido_em = now(), removido_lote = v_lote, removido_por = auth.uid()
   WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data AND a.removido_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_marcas) m
                      WHERE COALESCE(m->>'origem', 'arquivo') = 'manual' AND m->>'hora' = a.hora AND m->>'papel' = a.papel);
  INSERT INTO public.nr36_batida_ajuste (company_id, cpf, data, hora, papel, origem, justificativa, lote, autor_id)
  SELECT p_company_id, p_cpf, p_data, m->>'hora', m->>'papel', m->>'origem_ajuste', v_just, v_lote, auth.uid()
    FROM jsonb_array_elements(p_marcas) m
   WHERE COALESCE(m->>'origem', 'arquivo') = 'manual' AND m->>'papel' IN ('saida', 'retorno')
     AND NOT EXISTS (SELECT 1 FROM public.nr36_batida_ajuste a
                      WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data AND a.removido_em IS NULL
                        AND a.hora = m->>'hora' AND a.papel = m->>'papel');

  v_ciencia := public.fn__nr36_ciencia_apos_ajuste(p_company_id, p_cpf, p_data,
    format('Dia %s ajustado em %s por %s', to_char(p_data, 'DD/MM'), to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'),
           COALESCE(public.fn_usuario_nome(auth.uid()), 'a responsável')));
  RETURN v_r || jsonb_build_object('pendencias', v_pend, 'ciencia', v_ciencia, 'comprovantes', COALESCE(array_length(v_comprovantes, 1), 0));
END $function$;

-- 3) RD-95: "?" do campo novo (documento assinado) na aba Conferência
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'compliance', 'publicado'
FROM (VALUES
 ('compliance.pausas.conferencia_comprovante', 'Conferência', 'Documento assinado pelo colaborador',
  'Anexe (opcional) a foto ou o PDF do papel que o colaborador assinou confirmando o horário que esqueceu de registrar.',
  'Guarda a prova de que o colaborador teve ciência do ajuste daquele dia — a auditoria da NR-36 pede esse comprovante quando o horário foi conferido com ele, não lido da catraca.',
  'Foto do formulário de pausa assinado pelo Anderson, com o horário de retorno que faltou.',
  'Anexar documento de outro dia/colaborador: o comprovante fica preso à releitura DESTE dia e DESTE colaborador. Confira antes de salvar.',
  90, '/dashboard/compliance/pausas-tecnicas')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
