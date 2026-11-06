-- 20261026010000_agente_rotina_novos_codes.sql
-- Libera 4 novos identificadores de agente (3 Codes de desenvolvimento do Hub + 2º auditor
-- PDCA) na lista branca de erp_agente_rotina / erp_agente_mensagem. Aditivo: só ACRESCENTA
-- valores aos CHECKs, nenhuma linha existente é alterada ou removida.
--
-- Registra no repo o hotfix que JÁ roda em produção (conferido 24/10 com pg_get_constraintdef/pg_get_functiondef:
-- as 2 CHECKs e a função são iguais a este arquivo). Separada da #3153 a pedido do Eng. Chefe (guarda = alçada do CEO).
--
-- desenvolvedor_4_g  (Opus 5.5)  — Hub Projetos: Viagens + cálculo/rateio no GE
-- desenvolvedor_5_g  (Sonnet 5)  — Hub Projetos: comercial (visitas/clientes/oportunidades/propostas/simulador)
-- desenvolvedor_6_g  (Sonnet 5)  — Hub Projetos: engenharia/take-off + contrato de preços BRF/medição
-- auditor_pdca_g     (Sonnet 5)  — 2º auditor PDCA, audita as telas dos 3 acima + code-desenvolvedor-3

BEGIN;

ALTER TABLE public.erp_agente_rotina DROP CONSTRAINT erp_agente_rotina_agente_check;
ALTER TABLE public.erp_agente_rotina ADD CONSTRAINT erp_agente_rotina_agente_check
  CHECK (agente = ANY (ARRAY[
    'gilberto-desenv', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
    'gilberto-chamados', 'rodrigo-code', 'jordana-code', 'andre-code', 'stephany-code',
    'teste-despertador', 'gilberto-esteira', 'gilberto-revisor', 'eng-chefe-auto',
    'code-desenvolvedor-3',
    'desenvolvedor_4_g', 'desenvolvedor_5_g', 'desenvolvedor_6_g', 'auditor_pdca_g'
  ]));

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (
    (tipo = 'aviso')
    OR (para = ANY (ARRAY[
      'gilberto-desenv', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
      'gilberto-chamados', 'teste-despertador',
      'desenvolvedor_4_g', 'desenvolvedor_5_g', 'desenvolvedor_6_g', 'auditor_pdca_g'
    ]))
    OR (de ~ '^[a-z][a-z0-9]*-chat$')
    OR (de = 'eng_chefe')
  );

CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.de = 'eng_chefe' THEN
    IF NEW.tipo = 'tarefa'
       AND NEW.para NOT IN ('gilberto-desenv','gilberto-produto','gilberto-automotivo','gilberto-industria','gilberto-chamados','gilberto-esteira','code-desenvolvedor-3','teste-despertador','desenvolvedor_4_g','desenvolvedor_5_g','desenvolvedor_6_g','auditor_pdca_g')
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

-- Guarda de funções (check_fn_guards): função SECURITY DEFINER recriada fecha o acesso do anon, como as migrations anteriores dela.
REVOKE ALL ON FUNCTION public.fn__agente_mensagem_remetente_chat() FROM PUBLIC, anon;

INSERT INTO public.erp_agente_rotina (agente, aciona, observacao) VALUES
  ('desenvolvedor_4_g', true, 'Hub Projetos — Viagens + cálculo/rateio GE (Opus 5.5), ativado 24/10'),
  ('desenvolvedor_5_g', true, 'Hub Projetos — comercial: visitas/clientes/oportunidades/propostas/simulador, ativado 24/10'),
  ('desenvolvedor_6_g', true, 'Hub Projetos — engenharia/take-off + contrato BRF/medição, ativado 24/10'),
  ('auditor_pdca_g', true, '2º auditor PDCA — audita code-desenvolvedor-3/desenvolvedor_4_g/desenvolvedor_6_g, ativado 24/10')
ON CONFLICT (agente) DO UPDATE SET aciona = true, observacao = EXCLUDED.observacao, atualizado_em = now();

COMMIT;
