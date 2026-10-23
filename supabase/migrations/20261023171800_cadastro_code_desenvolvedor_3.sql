-- Cadastro de Code novo: code-desenvolvedor-3 (nome Code-Desenvolvedor 3), 3o PRODUTOR do Hub (CEO 23/10, Eng. Chefe 2).
-- Adicionar um Code toca 3 guardas hardcoded do canal de agentes. Já aplicado em produção via hotfix (execute_sql);
-- este arquivo torna durável no repo/ledger. Tudo IDEMPOTENTE (CREATE OR REPLACE, DROP IF EXISTS, ON CONFLICT).

-- 1) Registro-mestre (FK alvo de erp_agente_mensagem.para): a lista de Codes válidos.
ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT IF EXISTS erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria',
    'gilberto-chamados','rodrigo-code','jordana-code','andre-code','stephany-code','teste-despertador',
    'gilberto-esteira','gilberto-revisor','eng-chefe-auto','code-desenvolvedor-3']::text[]));

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao, atualizado_em)
VALUES ('code-desenvolvedor-3', false, 'Produtor Hub (Opus 5.5). Cadastrado CEO 23/10 via Eng. Chefe 2. aciona=true quando o cofre tiver agente_rotina_url/token_code-desenvolvedor-3.', now())
ON CONFLICT (agente) DO NOTHING;

-- 2) Trigger do canal de mensagens: o eng_chefe pode mandar TAREFA para este Code (lista de Codes PS).
CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.de = 'eng_chefe' THEN
    IF NEW.tipo = 'tarefa'
       AND NEW.para NOT IN ('gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','gilberto-esteira','code-desenvolvedor-3','teste-despertador')
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

-- Obs.: a faixa de migration do code-desenvolvedor-3 é SEGUNDOS=35 (doutrina AGENTS.md).
