-- Chamado #3842 (Karol · segurancadotrabalho · NR-36 · pausas térmicas) — anexar na Conferência o DOCUMENTO ASSINADO.
--
-- Pedido: na aba Conferência, quando um horário é "conferido com o colaborador" (ele assina um papel impresso dizendo
-- o horário da pausa que esqueceu de registrar), a responsável precisa de um lugar para ANEXAR esse documento,
-- comprovando que o colaborador teve ciência do ajuste. Hoje o editor do dia só grava o horário e a justificativa —
-- não guarda a prova assinada.
--
-- ADITIVA: cria uma tabela nova (nr36_conferencia_anexo) e três funções novas; não altera nenhuma tabela/função
-- existente nem toca em dado de cliente já gravado. O arquivo em si vai para o bucket 'compliance-pausas', no mesmo
-- padrão de caminho do tenant já usado pela Importação ("<company_id>/..."). Como o documento é dado pessoal do
-- colaborador, o prefixo "<company_id>/conferencia/" ganha policies RESTRICTIVE (abaixo): subir e ler o arquivo exigem
-- o MESMO papel da gravação (fn_nr36_pode_subir). O nome do arquivo leva um UUID — o CPF fica só na tabela.
-- Toca RLS (tabela nova + policy do bucket) → via revisada (revisao-eng-chefe).
--
-- NR-36 é área crítica: a leitura (tabela, listar e arquivo) e a gravação/remoção exigem o mesmo papel que importa relatório
-- de pausa (fn_nr36_pode_subir: TST ou responsável pelo Compliance), a empresa continua isolada por RLS e a remoção é soft-delete (nada some do rastro).

-- ── tabela: documento assinado anexado a um dia conferido ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nr36_conferencia_anexo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cpf           text NOT NULL,
  data          date NOT NULL,
  arquivo_path  text NOT NULL,
  arquivo_nome  text NOT NULL,
  arquivo_hash  text,
  enviado_por   uuid,
  enviado_em    timestamptz NOT NULL DEFAULT now(),
  removido_em   timestamptz,
  removido_por  uuid
);
CREATE INDEX IF NOT EXISTS nr36_conferencia_anexo_dia_idx
  ON public.nr36_conferencia_anexo (company_id, cpf, data) WHERE removido_em IS NULL;
COMMENT ON TABLE public.nr36_conferencia_anexo IS
  '#3842: documento assinado que comprova a ciência do colaborador sobre o ajuste de um dia na Conferência (NR-36)';

ALTER TABLE public.nr36_conferencia_anexo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nr36_conferencia_anexo_ler ON public.nr36_conferencia_anexo;
CREATE POLICY nr36_conferencia_anexo_ler ON public.nr36_conferencia_anexo
  FOR SELECT TO authenticated
  USING (public.fn_nr36_pode_subir(company_id));
REVOKE ALL ON public.nr36_conferencia_anexo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nr36_conferencia_anexo TO authenticated;

-- ── salvar: registra o anexo (o upload ao bucket é feito pela tela, já com a policy do tenant) ────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_conferencia_anexo_salvar(
  p_company_id uuid, p_cpf text, p_data date, p_arquivo_path text, p_arquivo_nome text, p_arquivo_hash text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT public.fn_nr36_pode_subir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao',
      'mensagem', 'Só o Técnico de Segurança do Trabalho ou o responsável pelo Compliance pode anexar o documento da conferência.');
  END IF;
  IF COALESCE(btrim(p_arquivo_path), '') = '' OR COALESCE(btrim(p_arquivo_nome), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'arquivo', 'mensagem', 'Arquivo inválido.');
  END IF;
  -- o caminho tem de ser do próprio tenant (1º segmento = company_id), igual à policy do bucket compliance-pausas
  IF split_part(p_arquivo_path, '/', 1) <> p_company_id::text THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'path', 'mensagem', 'Caminho do arquivo fora da empresa.');
  END IF;
  INSERT INTO public.nr36_conferencia_anexo (company_id, cpf, data, arquivo_path, arquivo_nome, arquivo_hash, enviado_por)
  VALUES (p_company_id, p_cpf, p_data, btrim(p_arquivo_path), btrim(p_arquivo_nome), NULLIF(btrim(p_arquivo_hash), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- ── listar: os anexos ativos de um dia conferido ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_conferencia_anexo_listar(p_company_id uuid, p_cpf text, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.fn_nr36_pode_subir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao', 'anexos', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'arquivo_path', arquivo_path, 'arquivo_nome', arquivo_nome, 'enviado_em', enviado_em
         ) ORDER BY enviado_em DESC), '[]'::jsonb)
    INTO v
    FROM public.nr36_conferencia_anexo
   WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data AND removido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'anexos', v);
END $function$;

-- ── remover: soft-delete (preserva o rastro) ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_conferencia_anexo_remover(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.nr36_conferencia_anexo WHERE id = p_id AND removido_em IS NULL;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado', 'mensagem', 'Anexo não encontrado ou já removido.');
  END IF;
  IF NOT public.fn_nr36_pode_subir(v_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao',
      'mensagem', 'Só o Técnico de Segurança do Trabalho ou o responsável pelo Compliance pode remover o documento.');
  END IF;
  UPDATE public.nr36_conferencia_anexo SET removido_em = now(), removido_por = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nr36_conferencia_anexo_salvar(uuid, text, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_nr36_conferencia_anexo_listar(uuid, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_nr36_conferencia_anexo_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_conferencia_anexo_salvar(uuid, text, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_conferencia_anexo_listar(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_conferencia_anexo_remover(uuid) TO authenticated;

-- ── bucket compliance-pausas: o prefixo "<company_id>/conferencia/" exige o papel TST/Compliance ─────────────────────
-- Policies RESTRICTIVE (somam-se às permissivas nr36_pausas_insert/select, que só olham a empresa). O CASE evita
-- converter para uuid qualquer objeto de outro bucket ou de outro prefixo. Sem policy de DELETE (arquivo nunca apagado).
DROP POLICY IF EXISTS nr36_conferencia_arquivo_insert ON storage.objects;
CREATE POLICY nr36_conferencia_arquivo_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN bucket_id = 'compliance-pausas' AND split_part(name, '/', 2) = 'conferencia'
                    AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN public.fn_nr36_pode_subir(split_part(name, '/', 1)::uuid)
                   ELSE true END);
DROP POLICY IF EXISTS nr36_conferencia_arquivo_select ON storage.objects;
CREATE POLICY nr36_conferencia_arquivo_select ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (CASE WHEN bucket_id = 'compliance-pausas' AND split_part(name, '/', 2) = 'conferencia'
                    AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN public.fn_nr36_pode_subir(split_part(name, '/', 1)::uuid)
                   ELSE true END);

-- ── RD-95: ajuda "?" do novo campo ────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'sst', 'publicado'
FROM (VALUES
 ('compliance.pausas.conferencia.anexo', 'Conferência', 'Documento assinado da conferência',
  'Anexe o papel que o colaborador assinou confirmando o horário da pausa ajustado neste dia (PDF ou foto).',
  'Guarda a prova de que o colaborador teve ciência do ajuste feito na conferência — exigência de rastro da NR-36. Fica anexado ao dia (colaborador + data).',
  'Foto do formulário assinado pelo colaborador confirmando a saída às 10:12 que faltou bater.',
  'Anexar documento de outro dia ou de outro colaborador: o anexo fica preso ao dia que está aberto na conferência.',
  50, '/dashboard/compliance/pausas-tecnicas')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
