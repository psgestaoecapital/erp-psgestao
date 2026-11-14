-- Agentes-fantasma (CEO 09/11): tirar os 7 de aparecer como agentes ATIVOS, SEM apagar histórico.
-- Os 7: andre-code, stephany-code, desenvolvedor_6_g, gilberto-automotivo, gilberto-industria, gilberto-desenv, eng-chefe-auto.
--
-- Por que NÃO é DELETE: as FKs de erp_agente_rotina (mensagem.para, sessao_lease, dono, escopo, papel) são NO ACTION,
-- e o histórico (PRs em erp_dev_entrega, mensagens em erp_agente_mensagem) aponta para esses agentes. Apagar quebra
-- a FK ou apaga memória. Então: marca como OCULTO e desliga o acionamento. A linha e o histórico ficam.
--
-- O que já estava certo e não muda: aciona = false nos 7 (cron e despertador não acordam), sem papel (roteamento de
-- dev e de chamado não os considera), sem lease, dono de sócio inativo (andre-code e stephany-code).
-- O que muda: fn_codes_saude (saúde dos Codes) lista TODAS as linhas da rotina; passa a ignorar as ocultas.
-- O painel de Codes já mostra só a lista fixa de Codes principais (src/lib/dev/painelCodes.ts), que não tem os 7.
-- Roteadores (fn_dev_mais_vazio, fn_chamados_rotear, fn_hub_rotear_gaps) não são alterados.

ALTER TABLE public.erp_agente_rotina ADD COLUMN IF NOT EXISTS oculto boolean NOT NULL DEFAULT false;
ALTER TABLE public.erp_agente_rotina ADD COLUMN IF NOT EXISTS oculto_em timestamptz;

UPDATE public.erp_agente_rotina
   SET oculto = true, oculto_em = coalesce(oculto_em, now()), aciona = false
 WHERE agente IN ('andre-code', 'stephany-code', 'desenvolvedor_6_g', 'gilberto-automotivo',
                  'gilberto-industria', 'gilberto-desenv', 'eng-chefe-auto')
   AND NOT oculto;

-- fn_codes_saude: troca a origem da rotina por uma visão sem as ocultas (trecho exato; aborta se não bater uma vez)
DO $fase_codes$
DECLARE d text; n int; antigo text := $o$FROM erp_agente_rotina r LEFT JOIN LATERAL$o$;
BEGIN
  d := pg_get_functiondef('public.fn_codes_saude'::regproc);
  n := (length(d) - length(replace(d, antigo, ''))) / length(antigo);
  IF n <> 1 THEN RAISE EXCEPTION 'fn_codes_saude: trecho de origem ocorre % vez(es)', n; END IF;
  EXECUTE replace(d, antigo, $n$FROM (SELECT * FROM erp_agente_rotina WHERE NOT oculto) r LEFT JOIN LATERAL$n$);
END
$fase_codes$;
