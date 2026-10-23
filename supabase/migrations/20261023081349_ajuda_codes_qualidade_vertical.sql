-- Ajuda do indicador "Qualidade por vertical" (RD-95: todo indicador tem "?") — aba Codes, CEO 23/10.
-- Aditiva: só insere uma chave de ajuda; nenhum dado de cliente, RLS ou função é tocado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
 ('dev.codes.qualidade_vertical', 'Diagnóstico da esteira', 'Qualidade por vertical',
  'Indicador de leitura — não se preenche.',
  'Mostra, por vertical, quanto das telas está CONSTRUÍDO (telas prontas + parciais×0,5 ÷ total de telas) e quanto está AUDITADO · VALIDADO (telas auditáveis pelo robô que já passaram na validação visual ÷ telas auditáveis). É o retrato da qualidade das telas e funções de cada vertical, ao vivo.',
  'Oficina: 92% construído · 31% auditado · validado',
  'Ler "auditado" como "pronto": auditado mede só o que o robô já validou, não tudo o que existe. "Sem dado" (vertical sem tela mapeada ou sem tela auditável) não é 0%.',
  60, '/dashboard/dev/codes', 'dev', 'publicado')
ON CONFLICT (chave) DO NOTHING;
