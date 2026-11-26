-- feat(consultor-ia · PR B): chaves de ajuda ("?") das NOVIDADES do agente — RD-95.
-- O aviso LGPD e o feedback 👍/👎 são novos na tela; cada campo/ação novo precisa do "?".
-- Aditiva/idempotente (ON CONFLICT upsert por chave).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('inteligencia.consultor.lgpd', '/dashboard/consultor-ia', 'Consultor', 'Como a IA usa seus dados',
  'Nada a preencher — é um aviso.',
  'As respostas são geradas por IA a partir dos dados desta empresa. Só os dados necessários para a sua pergunta são enviados ao provedor de IA, que não os usa para treinar modelos. O assistente nunca altera nada: ele explica e mostra o link da tela onde você corrige.',
  'Ao perguntar "por que o saldo do cliente X está negativo?", só os títulos e baixas desse cliente são consultados — não a base inteira.',
  'Achar que o assistente mexe nos dados: ele é só de leitura; quem corrige é você, pelo link que ele indica.',
  'nucleo', 15, 'publicado'),
 ('inteligencia.consultor.feedback', '/dashboard/consultor-ia', 'Consultor', 'A resposta ajudou?',
  'Toque 👍 se a resposta resolveu ou 👎 se não; no 👎, diga em uma linha o que faltou.',
  'Seu retorno melhora o assistente: 👎 com "o que faltou" vira tarefa para a equipe PS ajustar a resposta. Dono e gestor da empresa (e a equipe PS) veem esse retorno.',
  'Ex.: "faltou dizer em qual conta estava a diferença" ou "não explicou por que o título ficou parcial".',
  'Deixar o 👎 sem escrever o que faltou: sem isso fica mais difícil corrigir.',
  'nucleo', 90, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status, atualizado_em = now();
