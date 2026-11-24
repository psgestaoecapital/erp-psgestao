-- Chamado #6727 (Frioeste · NR-36 pausas térmicas) · desenvolvedor_4_g
-- A aba Conferência de /dashboard/ehs/pausas-tecnicas só lista pausas PENDENTES
-- (fn_nr36_pausas_pendentes_listar). Um dia cuja(s) pausa(s) já têm hora de saída NÃO aparece lá,
-- então não havia como registrar uma pausa que foi FEITA mas não ficou no ponto (caso do colaborador
-- do chamado: 2 pausas registradas + 1 sem registro no dia 27/10). O front passa a abrir o editor do
-- dia por colaborador + data (reusa fn_nr36_marcas_dia + fn_nr36_reler_dia_justificado já existentes).
-- Esta migration só cadastra o "?" (RD-95) dos 2 campos novos do seletor. Aditiva e idempotente; não
-- cria/altera tabela, não toca dado de cliente, não mexe em RLS.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('compliance.pausas.conferencia.dia_colaborador', '/dashboard/ehs/pausas-tecnicas', 'Pausas · Conferência',
   'Colaborador',
   'Escolha o colaborador que fez uma pausa que não ficou registrada no ponto. A lista traz quem tem ponto na empresa.',
   'Abre o dia desse colaborador para lançar a pausa que faltou, mesmo quando o dia não aparece na lista de pendências (porque as pausas dele já têm hora de saída).',
   'Selecionar o colaborador para corrigir o dia 27/10, em que uma pausa foi feita mas não bateu no ponto.',
   'Deixar em branco: sem colaborador escolhido o botão "Abrir o dia" fica desabilitado.',
   'compliance', 20, 'publicado'),
  ('compliance.pausas.conferencia.dia_data', '/dashboard/ehs/pausas-tecnicas', 'Pausas · Conferência',
   'Dia',
   'O dia em que a pausa foi feita mas não ficou registrada no ponto.',
   'Abre o editor daquele dia para você lançar o horário da pausa com justificativa (mesmo fluxo do botão "Saída/retorno"). A leitura anterior fica no histórico e dá para desfazer.',
   'Escolher 27/10 para lançar a pausa que faltou daquele dia.',
   'Escolher um dia sem jornada importada: o editor abre, mas não há batidas para ancorar a pausa — importe o ponto antes.',
   'compliance', 21, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
