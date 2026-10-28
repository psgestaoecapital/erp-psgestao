-- Chamado #3842 (Frioeste/Karol · Pausas térmicas · aba Conferência) · ao confirmar/ajustar um dia "conferido com o
-- colaborador" (origem conferido_colaborador), a responsável tem um documento IMPRESSO E ASSINADO em que o colaborador
-- informa o horário da pausa que esqueceu de registrar. Ela precisa anexar esse documento dentro da própria aba,
-- comprovando que o colaborador teve CIÊNCIA do ajuste. Espelha o que a aba Ciência já faz no documento mensal
-- (fn_nr36_ciencia_anexar_assinado), agora por DIA conferido.
--
-- ADITIVA (RD-94.1-c): cria uma tabela nova + RPCs de guarda; NÃO altera nenhuma tabela/função existente e NÃO toca
-- dado de cliente. O arquivo vai para o bucket compliance-pausas (já usado pelas abas Ciência e Importar); aqui só
-- guardamos a referência (caminho/URL), quem anexou e quando. RLS por empresa, REVOKE anon.

-- ── anexo do dia conferido ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nr36_conferencia_anexo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cpf           text NOT NULL,
  data          date NOT NULL,
  arquivo_path  text NOT NULL,
  arquivo_url   text,
  arquivo_nome  text,
  descricao     text,
  enviado_por   uuid,
  enviado_em    timestamptz NOT NULL DEFAULT now(),
  removido_em   timestamptz,
  removido_por  uuid
);
CREATE INDEX IF NOT EXISTS nr36_conferencia_anexo_dia_idx
  ON public.nr36_conferencia_anexo (company_id, cpf, data) WHERE removido_em IS NULL;
COMMENT ON TABLE public.nr36_conferencia_anexo IS
  '#3842: documento assinado pelo colaborador anexado a um dia conferido na aba Conferência (prova de ciência do ajuste).';

ALTER TABLE public.nr36_conferencia_anexo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_conferencia_anexo_ler ON public.nr36_conferencia_anexo;
CREATE POLICY nr36_conferencia_anexo_ler ON public.nr36_conferencia_anexo
  FOR SELECT TO authenticated USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.nr36_conferencia_anexo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nr36_conferencia_anexo TO authenticated;

-- ── registrar o anexo (guarda a empresa; o upload do arquivo já foi feito pelo cliente no bucket) ───────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_conferencia_anexo_registrar(
  p_company_id uuid,
  p_cpf text,
  p_data date,
  p_arquivo_path text,
  p_arquivo_url text DEFAULT NULL,
  p_arquivo_nome text DEFAULT NULL,
  p_descricao text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF coalesce(btrim(p_arquivo_path), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'arquivo obrigatório');
  END IF;
  INSERT INTO public.nr36_conferencia_anexo
    (company_id, cpf, data, arquivo_path, arquivo_url, arquivo_nome, descricao, enviado_por)
  VALUES
    (p_company_id, p_cpf, p_data, btrim(p_arquivo_path), p_arquivo_url,
     nullif(btrim(coalesce(p_arquivo_nome, '')), ''), nullif(btrim(coalesce(p_descricao, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_nr36_conferencia_anexo_registrar(uuid, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_conferencia_anexo_registrar(uuid, text, date, text, text, text, text) TO authenticated;

-- ── listar os anexos ativos de um dia ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_conferencia_anexo_listar(
  p_company_id uuid,
  p_cpf text,
  p_data date
) RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'arquivo_url', a.arquivo_url,
      'arquivo_path', a.arquivo_path,
      'arquivo_nome', a.arquivo_nome,
      'descricao', a.descricao,
      'enviado_em', a.enviado_em
    ) ORDER BY a.enviado_em DESC), '[]'::jsonb)
  FROM public.nr36_conferencia_anexo a
  WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data
    AND a.removido_em IS NULL
    AND (public.is_admin() OR a.company_id IN (SELECT public.get_user_company_ids()));
$function$;
REVOKE ALL ON FUNCTION public.fn_nr36_conferencia_anexo_listar(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_conferencia_anexo_listar(uuid, text, date) TO authenticated;

-- ── remover (soft-delete rastreável — RD-98 p4; o arquivo no storage nunca é apagado) ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_conferencia_anexo_remover(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company
    FROM public.nr36_conferencia_anexo WHERE id = p_id AND removido_em IS NULL;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'anexo não encontrado');
  END IF;
  IF NOT (public.is_admin() OR v_company IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  UPDATE public.nr36_conferencia_anexo
     SET removido_em = now(), removido_por = auth.uid()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_nr36_conferencia_anexo_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_conferencia_anexo_remover(uuid) TO authenticated;

-- ── "?" (RD-95) do campo de anexo na aba Conferência ───────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'compliance', 'publicado'
FROM (VALUES
 ('nr36.conferencia.anexo_assinado', 'Conferência', 'Documento assinado pelo colaborador',
  'Anexe o documento impresso que o colaborador assinou informando o horário da pausa que esqueceu de registrar (PDF ou foto). Só é preciso quando o ajuste foi "conferido com o colaborador".',
  'Guarda a prova de que o colaborador teve ciência do ajuste daquele dia — fica ligado ao CPF e à data conferida, e você pode baixar ou remover depois.',
  'PDF do formulário assinado por Maciel em 12/09, confirmando a saída da 1ª pausa às 10:15.',
  'Anexar o relatório de ponto do mês inteiro no lugar do documento daquele dia: aqui é a folha assinada do ajuste de um dia só.',
  10, '/dashboard/compliance/pausas-tecnicas')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
