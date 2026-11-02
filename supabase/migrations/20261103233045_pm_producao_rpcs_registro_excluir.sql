-- RD-98 p3 (origem do dado): a tela /dashboard/producao chama fn_pm_registro_excluir
-- (page.tsx L242 e L324, exclusão de timesheet/tarefas), mas system_screens.rpcs_chamadas
-- não listava essa RPC — o inventário de origem-do-dado ficava incompleto.
-- Aditiva e idempotente: só acrescenta o nome que falta ao array existente; não toca em
-- dado de cliente nem em outra rota. PDCA P&M /dashboard/producao gap3.
UPDATE public.system_screens
   SET rpcs_chamadas = array_append(rpcs_chamadas, 'fn_pm_registro_excluir')
 WHERE rota = '/dashboard/producao'
   AND NOT ('fn_pm_registro_excluir' = ANY(rpcs_chamadas));
