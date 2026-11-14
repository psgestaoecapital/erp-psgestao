-- Revenda · Painel do dono (/dashboard/revenda) — RD-95: "?" no modal "Marcar como comunicado ao COAF"
-- ============================================================================
-- GAP (anti-ócio / RD-95): o modal de registro da comunicação ao COAF (protocolo do SISCOAF +
--   observação) não tinha "?". Os dois campos agora têm ajuda explicando o que é o protocolo e
--   que o registro é só interno (a comunicação em si é feita pelo usuário no SISCOAF).
-- CORREÇÃO (aditiva, idempotente): duas chaves em erp_ajuda_campo; o front renderiza <AjudaCampo>
--   no rótulo de cada campo.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('revenda.coaf.protocolo', '/dashboard/revenda', 'Comunicação ao COAF', 'Protocolo do SISCOAF',
   'O número do protocolo que o SISCOAF gerou quando você fez a comunicação por lá (opcional).',
   'Guarda a prova de que a comunicação ao COAF foi feita, para auditoria e consulta futura — o sistema NÃO comunica sozinho ao COAF.',
   '2026.1234.5678.9012', 'Deixar em branco é permitido, mas sem o protocolo você perde a referência da comunicação feita no SISCOAF.', 'gestao_empresarial', 10),

  ('revenda.coaf.observacao', '/dashboard/revenda', 'Comunicação ao COAF', 'Observação',
   'Uma nota livre sobre essa comunicação (opcional): contexto, responsável, data em que foi enviada etc.',
   'Registra detalhes que ajudam a entender depois por que e como a ocorrência foi comunicada.',
   'Comunicado em 14/11 por João; operação acima de R$ 30 mil em espécie.', '—', 'gestao_empresarial', 20)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
