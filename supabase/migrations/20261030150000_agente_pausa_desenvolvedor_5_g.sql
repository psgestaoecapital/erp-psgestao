-- CEO 28/10/2026 19:24: pausar o desenvolvedor_5_g (equilíbrio de consumo da conta CLAUDEPS) e tirá-lo da distribuição
-- automática de tarefas (fn_pdca_dono_hub só escolhe dev_hub com pausado=false). As tarefas que ele já tem ficam na caixa
-- até ele voltar; volta se houver crédito ocioso (basta pausado=false).
-- Só configuração de agente (sem dado de cliente).
UPDATE public.erp_agente_papel
   SET pausado = true,
       observacao = 'Pausado pelo CEO 28/10 19:24 (equilíbrio de consumo da conta CLAUDEPS); volta se houver crédito ocioso. Tarefas ficam na caixa.',
       atualizado_em = now()
 WHERE agente = 'desenvolvedor_5_g' AND papel = 'dev_hub' AND pausado IS DISTINCT FROM true;
