-- Fila de Divergências (RD-49, tela compartilhada) · modal "Resolver divergência" — RD-95 "?" nos 3 campos
-- ============================================================================
-- GAP (RD-95): o modal de resolução em src/components/divergencias/CentralDivergencias.tsx
--   (aberto em /dashboard/_compartilhado/divergencias) não tinha "?" em nenhum dos 3 campos:
--   Setor, "Esta pessoa NÃO bate ponto" e Observação.
-- CORREÇÃO (aditiva, idempotente): 3 chaves NOVAS no grupo "Divergências".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('divergencias.resolver.setor', '/dashboard/_compartilhado/divergencias', 'Divergências', 'Setor',
   'O setor da pessoa cuja folha apareceu sem registro de ponto. Escolha um da lista ou digite um novo.',
   'Aponta onde a pessoa trabalha para que o custo de mão de obra caia no setor certo e a apuração de horas passe a casar.',
   'Produção',
   'Deixar em branco sem marcar "não bate ponto" não resolve a divergência — ela volta a aparecer na próxima ingestão.',
   'geral', 9200),

  ('divergencias.resolver.nao_apura', '/dashboard/_compartilhado/divergencias', 'Divergências', 'Esta pessoa NÃO bate ponto',
   'Marque quando a pessoa realmente não registra ponto (ex.: sócio, terceirizado, cargo sem controle de horas).',
   'Mantém o custo da pessoa na folha, mas a tira do cálculo de horas — assim deixamos de cobrar um ponto que nunca vai existir.',
   'Sócio-diretor → marcado',
   'Marcar por engano para quem deveria bater ponto esconde faltas e horas que precisam ser apuradas.',
   'geral', 9201),

  ('divergencias.resolver.obs', '/dashboard/_compartilhado/divergencias', 'Divergências', 'Observação',
   'Um comentário curto e opcional explicando como você resolveu esta divergência.',
   'Fica registrado junto da resolução para auditoria e para quem revisar depois entender a decisão.',
   'Confirmado com o RH em 15/11.',
   'Escrever dado sensível (CPF, salário) aqui — a observação é visível a quem opera a fila; use só o necessário.',
   'geral', 9202)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
