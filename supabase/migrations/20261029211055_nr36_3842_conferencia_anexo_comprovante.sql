-- Chamado #3842 (Karol · Pausas térmicas › aba Conferência) · anexar o comprovante assinado do ajuste.
--
-- Pedido (verbatim): "Na aba conferência tem o ajuste e pode ser flegado conferido com o colaborador, no caso temos um
-- documento impresso onde o colaborador assina e nos passa o horário da pausa que esqueceu de fazer o registro, preciso
-- que tenha dentro dessa aba quando flegado que foi conferido com o colaborador um local onde possa anexar esse
-- documento, comprovando que realmente o colaborador teve ciência desse ajuste."
--
-- Hoje o ajuste do dia (editor de Saída/retorno da Conferência) grava a releitura com origem 'conferido_colaborador' e
-- justificativa (nr36_releitura_justificativa + nr36_batida_ajuste), mas não havia onde guardar o PAPEL assinado que
-- prova a ciência do colaborador. Esta migration cria a camada de comprovante — por dia (company_id, cpf, data), a mesma
-- chave do editor — espelhando o padrão de anexo da Ciência (fn_nr36_ciencia_anexar_assinado + bucket compliance-pausas).
--
-- ADITIVA: cria tabela/índice/funções NOVOS. Não altera nenhuma pausa, batida, releitura ou ciência existente; não faz
-- UPDATE/DELETE em dado de cliente (só INSERT/SELECT). RLS por empresa, REVOKE anon.

CREATE TABLE IF NOT EXISTS public.nr36_releitura_anexo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cpf           text NOT NULL,
  data          date NOT NULL,
  arquivo_path  text NOT NULL,
  arquivo_nome  text,
  autor_id      uuid,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nr36_releitura_anexo_dia_idx ON public.nr36_releitura_anexo (company_id, cpf, data);
COMMENT ON TABLE public.nr36_releitura_anexo IS '#3842: comprovante assinado (papel) da ciência do colaborador sobre o ajuste de pausa do dia — por (company_id, cpf, data)';

ALTER TABLE public.nr36_releitura_anexo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_releitura_anexo_ler ON public.nr36_releitura_anexo;
CREATE POLICY nr36_releitura_anexo_ler ON public.nr36_releitura_anexo
  FOR SELECT TO authenticated USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.nr36_releitura_anexo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nr36_releitura_anexo TO authenticated;

-- Registra o comprovante já enviado ao bucket compliance-pausas (o front sobe o arquivo; aqui só grava o caminho).
CREATE OR REPLACE FUNCTION public.fn_nr36_releitura_anexar(
  p_company_id uuid, p_cpf text, p_data date, p_arquivo_path text, p_arquivo_nome text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_cpf IS NULL OR p_data IS NULL OR btrim(COALESCE(p_arquivo_path, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'parametros_incompletos');
  END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  INSERT INTO public.nr36_releitura_anexo (company_id, cpf, data, arquivo_path, arquivo_nome, autor_id)
  VALUES (p_company_id, p_cpf, p_data, btrim(p_arquivo_path), NULLIF(btrim(COALESCE(p_arquivo_nome, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_releitura_anexar(uuid, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_releitura_anexar(uuid, text, date, text, text) TO authenticated;

-- Lista os comprovantes de um dia (mais recente primeiro) para o editor de Conferência.
CREATE OR REPLACE FUNCTION public.fn_nr36_releitura_anexos_listar(
  p_company_id uuid, p_cpf text, p_data date
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'arquivo_path', a.arquivo_path, 'arquivo_nome', a.arquivo_nome, 'criado_em', a.criado_em
         ) ORDER BY a.criado_em DESC), '[]'::jsonb)
    FROM public.nr36_releitura_anexo a
   WHERE a.company_id = p_company_id AND a.cpf = p_cpf AND a.data = p_data
     AND (a.company_id IN (SELECT get_user_company_ids()) OR is_admin());
$fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_releitura_anexos_listar(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_releitura_anexos_listar(uuid, text, date) TO authenticated;

-- RD-95: "?" do novo campo de upload do comprovante (texto da Central de Ajuda, editável sem deploy).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'compliance', 'publicado'
FROM (VALUES
 ('nr36.conferencia.comprovante', 'Conferência', 'Comprovante assinado',
  'Anexe aqui o documento em papel que o colaborador assinou confirmando o horário da pausa que esqueceu de registrar (PDF ou foto).',
  'Guarda a prova de que o colaborador teve ciência do ajuste feito neste dia — fica junto da releitura, com quem anexou e quando, para auditoria.',
  'PDF escaneado da folha assinada pelo Anderson com o horário da saída da 1ª pausa do dia 12/09.',
  'Ajustar o dia e esquecer de anexar o papel assinado: sem o comprovante, o ajuste "conferido com o colaborador" fica sem prova na auditoria.',
  10, '/dashboard/compliance/pausas-tecnicas')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
