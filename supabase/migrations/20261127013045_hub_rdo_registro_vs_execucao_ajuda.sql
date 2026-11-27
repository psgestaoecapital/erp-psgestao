-- Hub · Diário de obra (RDO, tela 321) — ajuda do indicador "Registrado em" no histórico.
-- Blueprint vivo hub_projetos tela 321, requisito 47fbe3a2 ("Data da execução separada da data
-- de registro (aceita registro retroativo), com histórico de alteração"). A fatia front-only
-- mostra, em cada diário, a data da execução (o "Dia") ao lado da data de registro (criado_em) e
-- marca "Registro retroativo" quando a execução é anterior ao registro. Esta migration só cadastra
-- o texto do "?" (RD-95). ADITIVA e IDEMPOTENTE.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, versao, status)
SELECT
  'projetos.obra_rdo.registrado_em',
  '/dashboard/projetos/obras/[id]/rdo',
  'Diário de Obra',
  'Registrado em',
  'Não se preenche: é a data em que o diário foi lançado no sistema, separada do "Dia" (a data em que o serviço foi executado).',
  'Deixa claro quando o diário foi feito no mesmo dia e quando foi lançado depois (registro retroativo), preservando a ordem real dos fatos para fiscalização e cliente.',
  'Serviço feito no dia 15/03 e lançado no dia 18/03 aparece como "Dia 15/03 · Registrado em 18/03" com a marca "Registro retroativo".',
  'Confundir a data do "Dia" (quando o serviço aconteceu) com a de registro (quando foi digitado): no diário de obra as duas podem ser diferentes.',
  8,
  1,
  'publicado'
WHERE NOT EXISTS (SELECT 1 FROM erp_ajuda_campo WHERE chave = 'projetos.obra_rdo.registrado_em');
