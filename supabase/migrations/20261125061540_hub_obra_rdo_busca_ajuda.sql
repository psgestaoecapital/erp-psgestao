-- 20261125061540 · code-desenvolvedor-3 · PDCA Hub RDO (tela 321, msg 3f5bbae1)
-- RD-95: a tela /dashboard/projetos/obras/[id]/rdo ganhou a BUSCA nos diários (palavra-chave + dia).
-- Esta migration só SEMEIA as 2 chaves de ajuda ("?") dos novos filtros em erp_ajuda_campo.
-- Aditiva e idempotente (ON CONFLICT (chave) DO UPDATE). Não cria função, não toca dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_rdo.busca', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Buscar no diário',
  'Digite uma palavra para achar os diários que a contêm — procura no que foi feito, nas ocorrências, no clima e na OS.',
  'Localizar rápido um dia específico pelo serviço, pela ocorrência ou por qualquer termo, sem rolar a lista inteira.',
  'concretagem', 'Esperar que a busca ache fotos ou valores — ela procura só no texto do diário.', 'hub_projetos', 6, 1, 'publicado'),
 ('projetos.obra_rdo.busca_data', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Buscar por dia',
  'Escolha uma data para ver só o diário daquele dia; deixe em branco para ver todos os dias.',
  'Abrir direto o diário de uma data (ex.: conferir o que foi lançado numa visita específica).',
  '18/11/2026', 'Procurar um dia futuro — o diário é sempre de um dia que já aconteceu.', 'hub_projetos', 7, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, atualizado_em = now();
