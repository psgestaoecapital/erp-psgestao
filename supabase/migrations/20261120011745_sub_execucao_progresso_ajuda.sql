-- Hub · Gestão de Obras · aba Subempreiteiros → MEDIÇÕES. Code: desenvolvedor_4_g.
-- RD-95: "?" do indicador "Progresso de execução" (medido aprovado × contratado) do subempreiteiro —
-- a margem/avanço de execução do H7. Migration aditiva e idempotente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.subempreiteiro.execucao_progresso', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'Progresso de execução',
   'Indicador só de leitura: soma o valor bruto das medições APROVADAS deste subempreiteiro e compara com o valor contratado. Não é um campo para preencher.',
   'Mostra quanto do contrato já foi executado/medido e o saldo que falta medir, para acompanhar o avanço do subempreiteiro sem abrir o financeiro.',
   'Contrato de R$ 100.000 com R$ 40.000 em medições aprovadas: mostra 40% e saldo de R$ 60.000 a medir.',
   'Achar que inclui medições em rascunho: só as medições aprovadas entram no progresso (as em rascunho ainda não contam).', 24)
ON CONFLICT (chave) DO NOTHING;
