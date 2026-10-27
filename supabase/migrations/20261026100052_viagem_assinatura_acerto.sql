-- Viagem · prestação de contas assinada (auditor 24/10, gap "Adiantamento e prestação de contas … aprovação do gestor no
-- celular … assinatura eletrônica do colaborador" · desenvolvedor_4_g, faixa 52).
-- ADITIVA: tabela NOVA (só INSERT, pela função), funções NOVAS e textos NOVOS de "?" (RD-95). Nenhuma função, view,
-- tabela ou policy existente muda; nenhum dado de cliente é alterado ou apagado; nada vai para o financeiro.
--
--   1. O colaborador confere o acerto (adiantamento × o que pagou = saldo) e assina digitando o nome completo, que tem de
--      ser o nome da viagem. Fica gravado quem estava logado, a hora e uma impressão digital do acerto (hash).
--   2. O gestor aprova. Ele precisa ter perfil de gestão na empresa, não pode ser quem registrou a assinatura do
--      colaborador e só aprova se o acerto ainda for o mesmo que o colaborador assinou.
--   3. Mudou um cupom, a obra de um cupom, quem pagou ou o adiantamento depois da assinatura? O hash muda e a tela mostra
--      a assinatura como desatualizada: é preciso assinar e aprovar de novo. Nada é apagado: vale sempre a última.

CREATE TABLE IF NOT EXISTS public.erp_viagem_assinatura (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  viagem_id     uuid NOT NULL REFERENCES public.erp_viagem(id),
  papel         text NOT NULL CHECK (papel IN ('colaborador', 'gestor')),
  nome_assinado text NOT NULL CHECK (length(btrim(nome_assinado)) >= 3),
  usuario_id    uuid NOT NULL,
  acerto_hash   text NOT NULL,
  total         numeric(14,2) NOT NULL,
  adiantamento  numeric(14,2) NOT NULL,
  saldo         numeric(14,2) NOT NULL,
  assinado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_viagem_assinatura_viagem_idx ON public.erp_viagem_assinatura (viagem_id, papel, assinado_em DESC);

ALTER TABLE public.erp_viagem_assinatura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_viagem_assinatura_ler ON public.erp_viagem_assinatura;
CREATE POLICY erp_viagem_assinatura_ler ON public.erp_viagem_assinatura FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.erp_viagem_assinatura FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_viagem_assinatura TO authenticated;
GRANT ALL ON public.erp_viagem_assinatura TO service_role;

-- perfil de consulta não assina (mesmo gatilho das outras tabelas da viagem)
DROP TRIGGER IF EXISTS trg_viagem_trava_viewer ON public.erp_viagem_assinatura;
CREATE TRIGGER trg_viagem_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_viagem_assinatura
  FOR EACH ROW EXECUTE FUNCTION public.fn__viagem_trava_viewer();

-- Impressão digital do acerto: adiantamento + cada cupom vivo (id, valor, obra, forma, quem pagou), em ordem fixa.
CREATE OR REPLACE FUNCTION public.fn__viagem_acerto_hash(p_viagem_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT md5(COALESCE((SELECT v.adiantamento::text FROM public.erp_viagem v WHERE v.id = p_viagem_id), '') || '|' ||
    COALESCE((SELECT string_agg(concat_ws(';', l.id, l.valor, l.obra_id, l.forma_pagamento, l.pago_colaborador), '|' ORDER BY l.id)
                FROM public.erp_viagem_lancamento l WHERE l.viagem_id = p_viagem_id AND l.excluido_em IS NULL), ''))
$function$;
REVOKE ALL ON FUNCTION public.fn__viagem_acerto_hash(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__viagem_acerto_hash(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_viagem_assinar(p_viagem_id uuid, p_papel text, p_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_v public.erp_viagem%ROWTYPE; v_res jsonb; v_hash text; v_nome text := btrim(COALESCE(p_nome, ''));
        v_col public.erp_viagem_assinatura%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Assinatura exige usuário logado'); END IF;
  IF p_papel NOT IN ('colaborador', 'gestor') THEN RETURN jsonb_build_object('ok', false, 'erro', 'Papel inválido'); END IF;
  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_viagem_id;
  IF NOT FOUND OR v_v.excluido_em IS NOT NULL OR v_v.status = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_v.company_id);
  IF NOT public.fn_viagem_pode_gravar(v_v.company_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Seu perfil é de consulta: não assina o acerto'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_viagem_lancamento WHERE viagem_id = p_viagem_id AND excluido_em IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Lance os cupons antes de assinar o acerto');
  END IF;
  IF length(v_nome) < 3 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Digite o nome completo para assinar'); END IF;

  v_hash := public.fn__viagem_acerto_hash(p_viagem_id);
  v_res := public.fn_viagem_resumo(p_viagem_id);

  IF p_papel = 'colaborador' THEN
    IF lower(v_nome) <> lower(btrim(v_v.colaborador_nome)) THEN
      RETURN jsonb_build_object('ok', false, 'erro', format('O nome digitado tem de ser o do colaborador da viagem (%s)', v_v.colaborador_nome));
    END IF;
  ELSE
    IF NOT (public.is_admin() OR EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = v_v.company_id
              AND lower(COALESCE(uc.role, '')) IN ('owner', 'socio', 'admin', 'adm', 'acesso_total', 'diretor_area', 'coordenador', 'supervisor', 'financeiro'))) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Só o gestor (perfil de gestão na empresa) aprova o acerto');
    END IF;
    SELECT * INTO v_col FROM public.erp_viagem_assinatura WHERE viagem_id = p_viagem_id AND papel = 'colaborador' ORDER BY assinado_em DESC, id DESC LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'O colaborador ainda não assinou o acerto'); END IF;
    IF v_col.acerto_hash <> v_hash THEN RETURN jsonb_build_object('ok', false, 'erro', 'O acerto mudou depois da assinatura do colaborador: ele precisa assinar de novo'); END IF;
    IF v_col.usuario_id = auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Quem registrou a assinatura do colaborador não pode aprovar o mesmo acerto'); END IF;
  END IF;

  INSERT INTO public.erp_viagem_assinatura (company_id, viagem_id, papel, nome_assinado, usuario_id, acerto_hash, total, adiantamento, saldo)
  VALUES (v_v.company_id, p_viagem_id, p_papel, CASE WHEN p_papel = 'colaborador' THEN btrim(v_v.colaborador_nome) ELSE v_nome END, auth.uid(), v_hash,
          (v_res->>'total')::numeric, (v_res->>'adiantamento')::numeric, (v_res->>'saldo')::numeric);
  RETURN jsonb_build_object('ok', true, 'papel', p_papel, 'acerto_hash', v_hash, 'total', (v_res->>'total')::numeric, 'saldo', (v_res->>'saldo')::numeric);
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_assinar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_assinar(uuid, text, text) TO authenticated, service_role;

-- Situação das assinaturas: a última de cada papel e se ainda vale para o acerto de agora. Só leitura, RLS de quem lê.
CREATE OR REPLACE FUNCTION public.fn_viagem_assinaturas(p_viagem_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH h AS (SELECT public.fn__viagem_acerto_hash(p_viagem_id) AS atual),
  ult AS (SELECT DISTINCT ON (a.papel) a.* FROM public.erp_viagem_assinatura a WHERE a.viagem_id = p_viagem_id ORDER BY a.papel, a.assinado_em DESC, a.id DESC),
  j AS (SELECT u.papel, jsonb_build_object('nome', u.nome_assinado, 'em', u.assinado_em, 'total', u.total, 'saldo', u.saldo,
                 'valida', u.acerto_hash = h.atual) AS d, u.acerto_hash = h.atual AS valida FROM ult u, h)
  SELECT jsonb_build_object(
    'colaborador', (SELECT d FROM j WHERE papel = 'colaborador'),
    'gestor', (SELECT d FROM j WHERE papel = 'gestor'),
    'situacao', CASE
      WHEN NOT EXISTS (SELECT 1 FROM j WHERE papel = 'colaborador') THEN 'falta_colaborador'
      WHEN NOT (SELECT valida FROM j WHERE papel = 'colaborador') THEN 'desatualizada'
      WHEN COALESCE((SELECT valida FROM j WHERE papel = 'gestor'), false) THEN 'aprovada'
      ELSE 'falta_gestor' END)
$function$;
REVOKE ALL ON FUNCTION public.fn_viagem_assinaturas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_assinaturas(uuid) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.assin_situacao', 'Prestação de contas', 'Situação da prestação de contas', 'Calculado: falta a assinatura do colaborador, falta a aprovação do gestor, aprovada ou desatualizada.', 'Mostra se o acerto já foi conferido pelo colaborador e aprovado pelo gestor antes de fechar a viagem.', 'Aprovada por Maria em 25/10 14:10', 'Achar que a aprovação vale depois de mudar um cupom: mudou o acerto, assina e aprova de novo.', 70),
  ('projetos.viagem.assin_colaborador', 'Prestação de contas', 'Assinatura do colaborador', 'O colaborador confere total, adiantamento e saldo e digita o nome completo, igual ao da viagem.', 'É a confirmação dele de que os cupons e o saldo estão certos. Fica gravado quem estava logado e a hora.', 'João da Silva', 'Digitar apelido ou só o primeiro nome: tem de ser o nome que está na viagem.', 71),
  ('projetos.viagem.assin_gestor', 'Prestação de contas', 'Aprovação do gestor', 'O gestor confere o acerto assinado e digita o nome dele para aprovar. Funciona no celular.', 'Libera o acerto para o fechamento: reembolso ou devolução já conferidos por quem responde pela obra.', 'Maria Souza', 'Aprovar pelo mesmo login que registrou a assinatura do colaborador: o sistema recusa.', 72),
  ('projetos.viagem.assin_nome', 'Prestação de contas', 'Nome completo', 'Digite seu nome completo. É a sua assinatura eletrônica neste acerto.', 'Identifica quem assinou, junto com o usuário logado e a hora.', 'João da Silva', 'Deixar em branco ou com menos de 3 letras.', 73)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
