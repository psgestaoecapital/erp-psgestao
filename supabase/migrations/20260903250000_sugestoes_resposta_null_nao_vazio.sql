-- resposta: NULL quando não há resposta — nunca '' (string vazia).
--
-- Origem achada no dado: sugestoes.resposta tinha DEFAULT ''::text. Todo chamado nascia com resposta =
-- string vazia, então `resposta IS NOT NULL` devolvia TRUE para chamados SEM resposta nenhuma. Enganou o
-- CEO (cinco chamados "com resposta" que tinham zero caractere) — 3º erro forma-vs-conteúdo da semana,
-- registrado em erp_contexto_projeto c695f007. Vazio parece resposta em qualquer consulta.
--
-- Correção na RAIZ: a coluna deixa de ter default '' (nasce NULL) e o histórico com '' vira NULL. Quem
-- pergunta "tem resposta?" passa a poder confiar em IS NOT NULL de novo. O front (#1255) já trata os dois
-- com .trim(); isto conserta a fonte.

ALTER TABLE public.sugestoes ALTER COLUMN resposta DROP DEFAULT;
UPDATE public.sugestoes SET resposta = NULL WHERE resposta = '';
