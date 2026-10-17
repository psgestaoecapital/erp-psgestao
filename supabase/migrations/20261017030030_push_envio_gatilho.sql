-- Chamado #120 (Tryo) — Web Push custo zero, passo 3: ENVIO por evento (REGRAS APROVADAS, CEO 13/10, ref 8cf0318d).
-- O push é só mais um CANAL do aviso que já existe: ao GRAVAR em erp_notificacao_usuario o banco chama,
-- via pg_net, a edge function 'push-enviar' (genérica: serve qualquer tipo). Sem cron, sem polling.
-- Travas no banco (antes de chamar a função, para não gastar invocação à toa):
--  1) opt-in: só quem ATIVOU o tipo (erp_push_preferencia.ativo) e tem aparelho ativo;
--  2) agrupa: no máximo 1 push por oportunidade (origem) a cada 10 min por destinatário;
--  3) teto diário por empresa (500) — acima disso não envia e avisa (WARNING) uma vez por dia.
-- Falha de push NUNCA impede o aviso do sininho (EXCEPTION engolida).
-- Usa o segredo do vault já existente (SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER); a função só aceita chamada do banco.

CREATE TABLE IF NOT EXISTS public.erp_push_grupo (
  destinatario_id uuid NOT NULL,
  chave           text NOT NULL,
  ultimo_em       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (destinatario_id, chave)
);
CREATE TABLE IF NOT EXISTS public.erp_push_cota_dia (
  company_id uuid NOT NULL,
  dia        date NOT NULL,
  qtd        int  NOT NULL DEFAULT 0,
  alertado   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, dia)
);
ALTER TABLE public.erp_push_grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_push_cota_dia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_push_grupo FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.erp_push_cota_dia FROM PUBLIC, anon, authenticated;
-- sem policy: só o dono da função (SECURITY DEFINER) e o service_role mexem.

CREATE OR REPLACE FUNCTION public.fn_push_notificar_aviso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  v_chave   text;
  v_qtd     int;
  v_key     text;
  v_teto    constant int := 500;
BEGIN
  IF NEW.destinatario_id IS NULL THEN RETURN NEW; END IF;

  -- 1) opt-in por usuário e tipo + aparelho ativo
  IF NOT EXISTS (SELECT 1 FROM erp_push_preferencia p
                  WHERE p.user_id = NEW.destinatario_id AND p.tipo = NEW.tipo AND p.ativo)
     OR NOT EXISTS (SELECT 1 FROM erp_push_assinatura a
                     WHERE a.user_id = NEW.destinatario_id AND a.ativo) THEN
    RETURN NEW;
  END IF;

  -- 2) agrupa: 1 push por origem (oportunidade) a cada 10 min por destinatário
  v_chave := coalesce(NEW.origem_tipo, NEW.tipo) || ':' || coalesce(NEW.origem_id::text, NEW.id::text);
  INSERT INTO erp_push_grupo (destinatario_id, chave, ultimo_em)
  VALUES (NEW.destinatario_id, v_chave, now())
  ON CONFLICT (destinatario_id, chave) DO UPDATE SET ultimo_em = now()
  WHERE erp_push_grupo.ultimo_em < now() - interval '10 minutes';
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- 3) teto diário por empresa
  INSERT INTO erp_push_cota_dia (company_id, dia, qtd) VALUES (NEW.company_id, current_date, 1)
  ON CONFLICT (company_id, dia) DO UPDATE SET qtd = erp_push_cota_dia.qtd + 1
  RETURNING qtd INTO v_qtd;
  IF v_qtd > v_teto THEN
    UPDATE erp_push_cota_dia SET alertado = true
     WHERE company_id = NEW.company_id AND dia = current_date AND NOT alertado;
    IF FOUND THEN
      RAISE WARNING 'push: teto diario (%) da empresa % estourado — envio suspenso hoje', v_teto, NEW.company_id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_key IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url     := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/push-enviar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object(
      'user_id', NEW.destinatario_id, 'tipo', NEW.tipo,
      'titulo', NEW.titulo, 'mensagem', NEW.mensagem, 'link', NEW.link, 'tag', v_chave),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_push_notificar_aviso: %', SQLERRM;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_push_notificar_aviso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_notificar_aviso ON public.erp_notificacao_usuario;
CREATE TRIGGER trg_push_notificar_aviso
  AFTER INSERT ON public.erp_notificacao_usuario
  FOR EACH ROW EXECUTE FUNCTION public.fn_push_notificar_aviso();
