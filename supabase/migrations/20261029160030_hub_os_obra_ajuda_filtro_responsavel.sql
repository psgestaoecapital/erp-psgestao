-- Hub · Ordens de serviço de obra (/dashboard/projetos/obras/os): "?" (RD-95) do novo filtro por Responsável.
-- Motivo (PDCA Hub 28/10): o auditor pediu "filtro por responsável/equipe". A OS já grava o responsável
-- (projetos_obra_os.responsavel; na Construtora DEMO …0006 há "Carlos Encarregado (Demo)" e "Marina Técnica (Demo)"),
-- mas a tela só filtrava por obra e situação. Esta migration cadastra o texto de ajuda do filtro novo.
-- Aditiva: só texto de ajuda novo (erp_ajuda_campo); sem dado de cliente, sem RLS. Idempotente: ON CONFLICT (chave) DO NOTHING.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.os_obra.filtro_responsavel', 'Filtros', 'Filtrar por responsável',
  'Escolha um responsável para ver só as OS dele; "Todos os responsáveis" mostra todas.',
  'Foca a lista em quem toca a OS no canteiro — útil para o encarregado acompanhar o próprio pacote sem o ruído das outras equipes.',
  'Responsável = "Carlos Encarregado" → a lista mostra só as OS do Carlos.',
  'Achar que a OS sumiu: ela pode estar só filtrada por outro responsável — volte para "Todos os responsáveis".',
  3, '/dashboard/projetos/obras/os')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
