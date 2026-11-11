-- Chamado #3270 (Tryo, HB2) · Histórico de quem atribuiu o orçamentista da proposta.
-- Aceite do #3270 pedia, além de atribuir/trocar/filtrar (já entregue), o "histórico de quem atribuiu".
-- Hoje a atribuição é um UPDATE direto em erp_orcamentos (via RLS da tabela) e não deixa rastro de QUEM atribuiu.
--
-- RD-94.1 (c) ADITIVO: tabela NOVA + função NOVA. NÃO altera erp_orcamentos (o UPDATE do orçamentista segue
-- pela via existente, com a RLS da tabela). Esta migration só REGISTRA quem atribuiu/trocou/removeu e quando,
-- para a lista do Hub mostrar o histórico. RLS por empresa (get_user_company_ids/is_admin, mesmo padrão de
-- fn_obra_custo_lancar), REVOKE anon, escrita só pela função SECURITY DEFINER (sem policy de INSERT ao cliente).
-- Plano de volta: DROP da função e da tabela — ninguém mais lê e nenhuma estrutura existente foi alterada.

CREATE TABLE IF NOT EXISTS public.erp_orcamento_orcamentista_hist (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL,
  orcamento_id       uuid NOT NULL,
  orcamentista_id    uuid,
  orcamentista_nome  text,
  acao               text NOT NULL DEFAULT 'atribuido',   -- atribuido | trocado | removido
  atribuido_por      uuid,
  atribuido_por_nome text,
  criado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orc_orcamentista_hist_orc
  ON public.erp_orcamento_orcamentista_hist (orcamento_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_orc_orcamentista_hist_company
  ON public.erp_orcamento_orcamentista_hist (company_id);

ALTER TABLE public.erp_orcamento_orcamentista_hist ENABLE ROW LEVEL SECURITY;

-- Leitura: só a própria empresa (adm vê tudo). Escrita: nenhuma policy → só a função definer grava.
DROP POLICY IF EXISTS orc_orcamentista_hist_sel ON public.erp_orcamento_orcamentista_hist;
CREATE POLICY orc_orcamentista_hist_sel ON public.erp_orcamento_orcamentista_hist
  FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.erp_orcamento_orcamentista_hist FROM anon;
GRANT SELECT ON public.erp_orcamento_orcamentista_hist TO authenticated;

-- Registro da atribuição. Resolve o nome de quem atribuiu no servidor (auth.uid) e guarda por empresa do
-- orçamento. Só registra: não toca erp_orcamentos nem nenhum dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_orcamento_orcamentista_log(
  p_orcamento_id    uuid,
  p_orcamentista_id uuid,
  p_orcamentista_nome text,
  p_acao            text DEFAULT 'atribuido'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_nome    text;
  v_id      uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_orcamentos WHERE id = p_orcamento_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Orçamento não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Guarda por empresa do usuário (serviço/cron sem auth.uid passa).
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a este orçamento' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(NULLIF(btrim(u.full_name), ''), 'Usuário')
    INTO v_nome FROM public.users u WHERE u.id = auth.uid();

  INSERT INTO public.erp_orcamento_orcamentista_hist
    (company_id, orcamento_id, orcamentista_id, orcamentista_nome, acao, atribuido_por, atribuido_por_nome)
  VALUES
    (v_company, p_orcamento_id, p_orcamentista_id,
     NULLIF(btrim(p_orcamentista_nome), ''),
     COALESCE(NULLIF(btrim(p_acao), ''), 'atribuido'),
     auth.uid(), v_nome)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_orcamento_orcamentista_log(uuid, uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_orcamentista_log(uuid, uuid, text, text) TO authenticated;

-- RD-95: "?" do histórico na coluna Orçamentista.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('projetos.propostas.orcamentista_hist', '/dashboard/projetos/propostas', 'Propostas', 'Histórico do orçamentista',
  'Mostra quem atribuiu o orçamentista desta proposta e quando.',
  'Dá rastro de quem passou a proposta para cada orçamentista, sem precisar perguntar.',
  'Atribuído a Maria por João em 10/11.',
  'Confundir com o autor da proposta: aqui aparece quem fez a ATRIBUIÇÃO do orçamentista.',
  'hub', 'publicado')
ON CONFLICT (chave) DO NOTHING;
