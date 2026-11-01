-- PDCA P&M (auditor_pdca_2) · /dashboard/pm/portfolio · RD-95 ("?") dos indicadores do card.
--
-- Contexto (RD-38, provado no dado): a tela é uma VITRINE só-leitura de agency_jobs publicados/concluídos
-- (DEMO Agência: 1235 entregas, 1002 com arquivos anexados). A PR passa a usar a 1ª imagem de
-- agency_jobs.arquivos como capa real da entrega (fallback para o ícone por tipo) e documenta, num único
-- "?" premium da galeria, todos os elementos do card (capa, título, cliente, valor e data de publicação) —
-- em vez de poluir cada um dos ~1234 cards com vários "?".
--
-- 100% ADITIVA: só acrescenta um texto de ajuda em erp_ajuda_campo (ON CONFLICT DO NOTHING).
-- Nenhuma tabela/coluna nova, nenhuma função, nenhuma RLS, nenhum dado de cliente alterado.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'pm.portfolio.card', 'Portfolio · Card da entrega', 'O que cada card mostra',
       'Nada a preencher aqui: cada card é uma entrega publicada ou concluída desta agência.',
       'Mostra o seu portfolio de entregas por cliente. Em cada card: a CAPA (a 1ª imagem anexada ao job; quando o job não tem imagem, aparece um ícone pelo tipo — 🎨 design, 🎬 vídeo, 📣 campanha), o TÍTULO da entrega, o CLIENTE, o VALOR do job (quando houver) e a DATA de publicação (data de entrega, ou o prazo quando ainda não há data de entrega).',
       'Uma peça de design concluída aparece com a arte de capa, o nome do cliente e o valor fechado.',
       'Se a capa não carregar (link do anexo quebrado), o card volta a mostrar o ícone do tipo — o anexo precisa ser uma imagem acessível.',
       10, '/dashboard/pm/portfolio', 'pm', 'publicado'
ON CONFLICT (chave) DO NOTHING;
