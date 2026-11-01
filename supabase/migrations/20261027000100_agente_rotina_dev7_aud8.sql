-- Libera 2 novos identificadores de agente na lista branca de erp_agente_rotina / erp_agente_mensagem
-- e registra as rotinas. Aditivo: só ACRESCENTA valores aos CHECKs.
--
-- dev7claudeps (Dev 2 do Hub, assinatura nova 26/10) — produz telas do Hub, faixa própria.
-- aud8claudeps (2º Auditor visual, assinatura nova 26/10) — loop foto->insight->nota nas telas do Hub.

BEGIN;

ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY[
    'gilberto-desenv', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
    'gilberto-chamados', 'rodrigo-code', 'jordana-code', 'andre-code', 'stephany-code',
    'teste-despertador', 'gilberto-esteira', 'gilberto-revisor', 'eng-chefe-auto',
    'code-desenvolvedor-3', 'desenvolvedor_4_g', 'desenvolvedor_5_g', 'desenvolvedor_6_g',
    'auditor_pdca_g', 'dev7claudeps', 'aud8claudeps'
  ]));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (
    (tipo = 'aviso')
    OR (para = ANY (ARRAY[
      'gilberto-desenv', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
      'gilberto-chamados', 'teste-despertador', 'desenvolvedor_4_g', 'desenvolvedor_5_g',
      'desenvolvedor_6_g', 'auditor_pdca_g', 'dev7claudeps', 'aud8claudeps'
    ]))
    OR (de ~ '^[a-z][a-z0-9]*-chat$')
    OR (de = 'eng_chefe')
  );

-- Guarda: eng_chefe pode enviar tarefa aos 2 novos ids (CEO via Eng. Chefe, 26/10). Mantém todos os destinos atuais;
-- definição viva conferida com pg_get_functiondef antes de reescrever.
CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.de = 'eng_chefe' THEN
    IF NEW.tipo = 'tarefa'
       AND NEW.para NOT IN ('gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','gilberto-esteira','code-desenvolvedor-3','teste-despertador','desenvolvedor_4_g','desenvolvedor_5_g','desenvolvedor_6_g','auditor_pdca_g','dev7claudeps','aud8claudeps')
       AND NOT EXISTS (SELECT 1 FROM erp_agente_dono d WHERE d.agente = NEW.para AND d.ativo) THEN
      RAISE EXCEPTION 'Code % está desligado: só aviso, tarefa não', NEW.para USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.de = 'ceo' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_dono d WHERE d.remetente_chat = NEW.de AND d.agente = NEW.para AND d.ativo) THEN
    RAISE EXCEPTION 'remetente % só fala com o Code do próprio dono ativo (destino %)', NEW.de, NEW.para USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo <> 'tarefa' OR NEW.enviado_por IS DISTINCT FROM NEW.de THEN
    RAISE EXCEPTION 'pedido do canal PS: tipo tarefa e enviado_por = %', NEW.de USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Guarda de funções (check_fn_guards): SECURITY DEFINER recriada fecha o acesso do anon.
REVOKE ALL ON FUNCTION public.fn__agente_mensagem_remetente_chat() FROM PUBLIC, anon;

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao, atualizado_em) VALUES
  ('dev7claudeps', true, 'Dev 2 do Hub (assinatura nova 26/10). Produz telas do Hub, faixa propria. Corrige gaps do auditor ate nota>=95 + PDCA verde.', now()),
  ('aud8claudeps', true, '2o Auditor visual (assinatura nova 26/10). Loop foto->insight->nota nas telas do Hub, abre tarefa de correcao pro dev da faixa.', now())
ON CONFLICT (agente) DO UPDATE SET aciona = true, observacao = EXCLUDED.observacao, atualizado_em = now();

COMMIT;
