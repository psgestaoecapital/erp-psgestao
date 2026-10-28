-- #3842 (Karol · FC) · Pausa térmica, aba Conferência — anexar o comprovante assinado do ajuste
--
-- Cenário da chamada: quando a responsável corrige um dia na Conferência e o horário digitado é "conferido com o
-- colaborador" (origem do ajuste = conferido_colaborador), existe uma folha IMPRESSA que o colaborador assinou
-- confirmando o horário da pausa que esqueceu de registrar. A tela permitia marcar a origem, mas não guardava esse
-- comprovante. Esta migration permite ANEXAR o documento assinado ao próprio ajuste do dia
-- (public.nr36_releitura_justificativa), comprovando a ciência do colaborador (NR-36).
--
-- Fase do Saneamento V1: Fase 3 (TELAS REAIS / conectores funcionais) — fecha uma lacuna de uma tela já publicada.
-- Aditiva (RD-94.1 c): colunas NOVAS numa tabela que já tem RLS + funções NOVAS. Sem UPDATE/DELETE em dado de cliente,
-- sem mudança de policy/RLS. A escrita continua só por função SECURITY DEFINER com guarda de empresa (a tabela só tem
-- policy de SELECT por empresa; cliente nunca escreve direto), espelhando fn_nr36_ciencia_anexar_assinado.

-- 1) Colunas do comprovante no ajuste do dia -------------------------------------------------
ALTER TABLE public.nr36_releitura_justificativa
  ADD COLUMN IF NOT EXISTS comprovante_url  text,
  ADD COLUMN IF NOT EXISTS comprovante_nome text,
  ADD COLUMN IF NOT EXISTS comprovante_em   timestamptz,
  ADD COLUMN IF NOT EXISTS comprovante_por  uuid;

COMMENT ON COLUMN public.nr36_releitura_justificativa.comprovante_url IS
  'URL do comprovante assinado do ajuste "conferido com o colaborador" (#3842).';

-- 2) Anexa (ou substitui) o comprovante do ÚLTIMO ajuste do dia -------------------------------
--    Mesma guarda de fn_nr36_ciencia_anexar_assinado: empresa do usuário OU admin.
CREATE OR REPLACE FUNCTION public.fn_nr36_releitura_anexar_comprovante(
  p_company_id uuid, p_cpf text, p_data date, p_arquivo_url text, p_arquivo_nome text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF COALESCE(btrim(p_arquivo_url), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_arquivo', 'mensagem', 'Envie o arquivo do comprovante.');
  END IF;
  SELECT id INTO v_id
    FROM public.nr36_releitura_justificativa
   WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data
   ORDER BY criado_em DESC
   LIMIT 1;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_ajuste',
      'mensagem', 'Este dia ainda não tem um ajuste salvo. Corrija o dia e salve antes de anexar o comprovante.');
  END IF;
  UPDATE public.nr36_releitura_justificativa
     SET comprovante_url  = p_arquivo_url,
         comprovante_nome = NULLIF(btrim(p_arquivo_nome), ''),
         comprovante_em   = now(),
         comprovante_por  = auth.uid()
   WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 3) Lê o comprovante do último ajuste do dia + se o dia tem ajuste "conferido com o colaborador"
CREATE OR REPLACE FUNCTION public.fn_nr36_releitura_comprovante_ler(
  p_company_id uuid, p_cpf text, p_data date
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_conf boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT jsonb_build_object(
           'comprovante_url',  comprovante_url,
           'comprovante_nome', comprovante_nome,
           'comprovante_em',   comprovante_em)
    INTO v
    FROM public.nr36_releitura_justificativa
   WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data
   ORDER BY criado_em DESC
   LIMIT 1;
  SELECT EXISTS (
           SELECT 1 FROM public.nr36_batida_ajuste a
            WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data
              AND a.removido_em IS NULL AND a.origem = 'conferido_colaborador')
    INTO v_conf;
  RETURN jsonb_build_object(
    'ok', true,
    'tem_ajuste', v IS NOT NULL,
    'conferido_colaborador', COALESCE(v_conf, false),
    'comprovante', COALESCE(v, '{}'::jsonb));
END $function$;

-- 4) Grants — só usuário logado (REVOKE anon), service_role para a rotina ---------------------
REVOKE ALL ON FUNCTION public.fn_nr36_releitura_anexar_comprovante(uuid, text, date, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.fn_nr36_releitura_comprovante_ler(uuid, text, date)                 FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_releitura_anexar_comprovante(uuid, text, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_nr36_releitura_comprovante_ler(uuid, text, date)                 TO authenticated, service_role;

-- 5) RD-95 — "?" do novo campo (idempotente) -------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'pausa-conferencia-comprovante',
  '/dashboard/compliance/pausas-tecnicas',
  'Conferência',
  'Comprovante assinado do ajuste',
  'Anexe o documento (PDF, foto ou imagem) que o colaborador assinou dando ciência do horário de pausa ajustado neste dia — por exemplo a folha impressa em que ele confirmou o horário da pausa que esqueceu de registrar.',
  'Guarda, junto ao próprio ajuste do dia, a prova de que o colaborador teve ciência do horário corrigido como "conferido com o colaborador". É a comprovação documental da conferência exigida pela NR-36.',
  'Folha de conferência da pausa de 03/09 assinada pelo colaborador, digitalizada em PDF.',
  'Anexar antes de salvar o ajuste do dia, ou anexar um arquivo que não corresponde a este colaborador/dia.',
  'compliance',
  50
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo
   WHERE chave = 'pausa-conferencia-comprovante'
     AND rota  = '/dashboard/compliance/pausas-tecnicas');
