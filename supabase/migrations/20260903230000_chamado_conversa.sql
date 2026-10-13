-- Chamado é CONVERSA, não pergunta e resposta única.
--
-- Origem (03/09/2026): o Rodrigo tinha resposta_aprovada=true e a notificação (28ce6baa) chegou nele.
-- O ciclo #1252 funcionou até onde foi construído. Mas ele não queria ENCERRAR — queria mandar uma
-- FOTO NOVA de um erro novo. A tela só oferecia "Funcionou" ou "Ainda não resolveu (com motivo)":
-- não existe responder no meio. Foi exatamente o que ele abriu no chamado 075480a7, 1 min antes:
-- "precisa ter mais uma opção para envio de nova imagem". Este é o desenho que faltava.
--
-- O que muda: o chamado ganha um HISTÓRICO de ida e volta (sugestao_mensagem). O autor pode responder
-- SEM encerrar — manda mensagem com foto nova, o chamado volta pra fila PS com aviso, sem perder nada.
-- Confirmar (#1252) continua existindo, mas como AÇÃO SEPARADA, não como única saída. E a IA analisa a
-- foto nova também — a análise fica ligada à MENSAGEM, não ao chamado.

-- (1) sugestao_mensagem — a conversa. papel = quem falou (autor do chamado × equipe PS). ia_analise é a
--     leitura da foto DESTA mensagem (separada do ia_analise do chamado, RD-51).
CREATE TABLE IF NOT EXISTS public.sugestao_mensagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sugestao_id uuid NOT NULL REFERENCES public.sugestoes(id) ON DELETE CASCADE,
  autor_id uuid NOT NULL,
  autor_email text,
  papel text NOT NULL CHECK (papel IN ('autor','ps')),
  texto text,
  ia_analise jsonb,
  ia_analisado_em timestamptz,
  ia_custo_usd numeric,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sugestao_msg_sug ON public.sugestao_mensagem (sugestao_id, criado_em);

-- (2) a foto da mensagem REUSA sugestao_anexo (com marcacoes — o apontamento do #1249). mensagem_id
--     liga o anexo à mensagem; sugestao_id continua setado (o anexo é do chamado também). Anexos do
--     chamado original têm mensagem_id NULL — quem olha "a foto do chamado" filtra por isso.
ALTER TABLE public.sugestao_anexo
  ADD COLUMN IF NOT EXISTS mensagem_id uuid REFERENCES public.sugestao_mensagem(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_sugestao_anexo_msg ON public.sugestao_anexo (mensagem_id);

-- (3) RLS: vê a conversa quem é o AUTOR do chamado, ou a fila PS. Inserção só via RPC (SECURITY
--     DEFINER), então não há policy de INSERT — a RPC decide papel e notifica.
ALTER TABLE public.sugestao_mensagem ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sugestao_msg_sel ON public.sugestao_mensagem;
CREATE POLICY sugestao_msg_sel ON public.sugestao_mensagem FOR SELECT
  USING (
    public.fn_pode_ver_fila_suporte()
    OR EXISTS (SELECT 1 FROM public.sugestoes s WHERE s.id = sugestao_id AND s.user_id = auth.uid())
  );

-- (4) fn_sugestao_mensagem_enviar: o coração do desenho. Autor OU PS mandam mensagem (texto e/ou foto).
--     Autor → o chamado volta pra fila PS (reabre se estava terminal) e a fila PS é avisada.
--     PS → o autor é avisado. Nunca conclui: encerrar é ação separada (fn_sugestao_confirmar).
CREATE OR REPLACE FUNCTION public.fn_sugestao_mensagem_enviar(
    p_sugestao_id uuid, p_user uuid, p_texto text DEFAULT NULL, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_autor_chamado uuid; v_company uuid; v_titulo text; v_status text;
  v_papel text; v_msg_id uuid; v_email text; v_an jsonb; v_ord int := 0;
  v_tem_anexo boolean := (p_anexos IS NOT NULL AND jsonb_typeof(p_anexos) = 'array' AND jsonb_array_length(p_anexos) > 0);
  v_anexo_ids uuid[] := ARRAY[]::uuid[]; v_new_anexo uuid;
BEGIN
  SELECT user_id, company_id, titulo, status INTO v_autor_chamado, v_company, v_titulo, v_status
    FROM sugestoes WHERE id = p_sugestao_id;
  IF v_autor_chamado IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;

  -- papel: o autor do chamado fala como 'autor'; a fila PS (ou admin) fala como 'ps'. Ninguém mais entra.
  IF auth.uid() = v_autor_chamado THEN v_papel := 'autor';
  ELSIF is_admin() OR fn_pode_ver_fila_suporte() THEN v_papel := 'ps';
  ELSE RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF COALESCE(btrim(p_texto),'') = '' AND NOT v_tem_anexo THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_vazia'); END IF;

  SELECT email INTO v_email FROM users WHERE id = p_user;

  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
  VALUES (p_sugestao_id, p_user, v_email, v_papel, NULLIF(btrim(p_texto),''))
  RETURNING id INTO v_msg_id;

  -- anexos da mensagem (reusa sugestao_anexo; sugestao_id + mensagem_id setados). Espelha fn_sugestao_criar.
  IF v_tem_anexo THEN
    FOR v_an IN SELECT * FROM jsonb_array_elements(p_anexos) LOOP
      INSERT INTO sugestao_anexo (sugestao_id, mensagem_id, company_id, storage_path, url_publica, tipo, marcacoes, ordem, created_by)
      VALUES (p_sugestao_id, v_msg_id, v_company, v_an->>'storage_path', v_an->>'url_publica',
              COALESCE(v_an->>'tipo','imagem'), COALESCE(v_an->'marcacoes','[]'::jsonb), v_ord, p_user)
      RETURNING id INTO v_new_anexo;
      v_anexo_ids := v_anexo_ids || v_new_anexo;
      v_ord := v_ord + 1;
    END LOOP;
  END IF;

  IF v_papel = 'autor' THEN
    -- o chamado volta pra fila PS. Se estava terminal, reabre em em_desenvolvimento (o autor tem algo novo).
    UPDATE sugestoes SET
      status = CASE WHEN status IN ('concluida','recusada','duplicada','arquivada') THEN 'em_desenvolvimento' ELSE status END,
      confirmado_pelo_autor = false,
      updated_at = now()
    WHERE id = p_sugestao_id;
    -- avisa a fila PS (por pessoa) — sem perder o histórico
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_sugestao_id, u.id, 'mensagem',
           'Nova mensagem no chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sem título'),
           left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200)
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT');
  ELSE
    -- PS falou: avisa o AUTOR. Não muda status (a resposta "oficial" continua no fluxo responder/aprovar).
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    VALUES (p_sugestao_id, v_autor_chamado, 'mensagem',
            'Nova mensagem no seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
            left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200));
  END IF;

  RETURN jsonb_build_object('ok', true, 'mensagem_id', v_msg_id, 'papel', v_papel,
                            'anexos', to_jsonb(v_anexo_ids), 'tem_foto', v_tem_anexo);
END $function$;

-- (5) fn_sugestao_msg_ia_registrar: a IA escreve a leitura da foto NA MENSAGEM (não no chamado).
CREATE OR REPLACE FUNCTION public.fn_sugestao_msg_ia_registrar(p_mensagem_id uuid, p_analise jsonb, p_custo numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE sugestao_mensagem SET ia_analise = p_analise, ia_analisado_em = now(), ia_custo_usd = COALESCE(p_custo,0)
   WHERE id = p_mensagem_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- (6) teto diário: UMA fonte de verdade. Antes só somava sugestoes.ia_custo_usd — a foto da mensagem
--     escaparia do teto (analisada de graça, sem limite). Agora soma as duas tabelas. RD-52: o contador
--     não pode ter dois vocabulários nem duas contas paralelas.
CREATE OR REPLACE FUNCTION public.fn_sugestao_ia_gasto_hoje()
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (
    (SELECT COALESCE(SUM(ia_custo_usd),0) FROM sugestoes         WHERE ia_analisado_em::date = CURRENT_DATE)
  + (SELECT COALESCE(SUM(ia_custo_usd),0) FROM sugestao_mensagem WHERE ia_analisado_em::date = CURRENT_DATE)
  )::numeric
$function$;
