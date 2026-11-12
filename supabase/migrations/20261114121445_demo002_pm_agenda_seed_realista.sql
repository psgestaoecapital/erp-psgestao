-- P&M · Agenda (/dashboard/pm/agenda) — semeia compromissos reais na DEMO
-- ============================================================================
-- Acompanha o filtro de front (page.tsx) que esconde o ruído de automação (E2E/[BOT]/
-- ScreenshotBot/Visual Watcher). Como TODOS os compromissos vivos da DEMO 002 eram ruído
-- (5254/5254), a agenda ficaria vazia depois do filtro — então semeamos ~6 compromissos
-- comerciais realistas (próximos dias), para a DEMO mostrar uma agenda legível e útil.
--
-- Guardado a is_demo + idempotente (marca dados->>'seed' = 'pm_agenda_demo': apaga os seus
-- e reinsere). origem_modulo='comercial' (a agenda do P&M lê esse módulo). Datas relativas a
-- current_date, para caírem sempre na semana/mês corrente no momento do deploy. Sem dado de
-- cliente real; nomes de clientes da própria DEMO. Não toca RLS nem função.
--
-- RD-38 (prova no dado): ANTES — DEMO 002 tinha 5254 compromissos vivos, 100% ruído de
-- automação (títulos "… E2E …", "[BOT] Lead …"). DEPOIS do filtro + seed — a agenda mostra
-- 6 compromissos comerciais legíveis; o ruído some da tela (segue no banco até a limpeza
-- sistêmica do vazamento de e2e). Empresa real: nada muda (guarda is_demo).
-- ============================================================================

DO $$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000002';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = c AND is_demo IS TRUE) THEN
    RAISE NOTICE 'empresa % não é demo — seed de agenda ignorado', c;
    RETURN;
  END IF;

  -- idempotência: remove só o seed anterior desta migração (marca no jsonb)
  DELETE FROM public.erp_agendamento
   WHERE company_id = c AND dados->>'seed' = 'pm_agenda_demo';

  INSERT INTO public.erp_agendamento
    (company_id, origem_modulo, titulo, data, hora_inicio, hora_fim, status,
     cliente_nome, responsavel_nome, local, link_reuniao, observacao, dados)
  VALUES
    (c,'comercial','Reunião de briefing — campanha de fim de ano', current_date,                 '09:30','10:30','agendado',
     'Cliente Agência','Consultor P&M','Online','https://meet.exemplo/ps-briefing',
     'Levantar objetivos, público e peças da campanha.', jsonb_build_object('seed','pm_agenda_demo')),
    (c,'comercial','Apresentação de proposta — Clínica Sorriso Vale', current_date + 1,           '14:00','15:00','agendado',
     'Clínica Sorriso Vale','Consultor P&M','Escritório do cliente', NULL,
     'Apresentar escopo e investimento do plano trimestral.', jsonb_build_object('seed','pm_agenda_demo')),
    (c,'comercial','Ligar · follow-up do orçamento', current_date + 2,                            '11:00','11:20','agendado',
     'Cliente Agência','Consultor P&M', NULL, NULL,
     'Confirmar recebimento da proposta e dúvidas.', jsonb_build_object('seed','pm_agenda_demo')),
    (c,'comercial','Alinhamento de conteúdo — calendário de novembro', current_date + 3,          '16:00','17:00','agendado',
     'Clínica Sorriso Vale','Consultor P&M','Online','https://meet.exemplo/ps-conteudo',
     'Aprovar temas e datas dos posts do mês.', jsonb_build_object('seed','pm_agenda_demo')),
    (c,'comercial','WhatsApp · retomar negociação', current_date + 5,                             '10:00','10:15','agendado',
     'Cliente Agência','Consultor P&M', NULL, NULL,
     'Reaquecer lead parado e remarcar reunião.', jsonb_build_object('seed','pm_agenda_demo')),
    (c,'comercial','Reunião de resultados — fechamento do mês', current_date + 8,                 '15:30','16:30','agendado',
     'Clínica Sorriso Vale','Consultor P&M','Online','https://meet.exemplo/ps-resultados',
     'Revisar métricas e próximos passos.', jsonb_build_object('seed','pm_agenda_demo'));
END $$;
