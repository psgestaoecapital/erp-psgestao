-- ============================================================
-- Onda 7 · selo da Agenda (RD-58/RD-44) — 'parcial' → 'pronto'
-- ============================================================
-- Complemento do #1418. A /oficina/agenda foi confirmada como tela REAL (484 linhas,
-- fn_agenda_listar/fn_agendamento_criar/fn_agendamento_mudar_status, Dia/Semana, +Agendar) com
-- 60 agendamentos de uso real — mesmo critério das outras quatro. A nota do MASTER_V2
-- ("parqueado/branch WIP") estava desatualizada. CEO aprovou 'pronto'.

UPDATE public.system_screens
   SET estado_real = 'pronto', atualizado_em = now()
 WHERE area = 'oficina'
   AND estado_real = 'parcial'
   AND rota = '/dashboard/oficina/agenda';
