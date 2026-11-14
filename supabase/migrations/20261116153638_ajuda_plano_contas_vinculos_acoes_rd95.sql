-- RD-95: "?" em TODA ação da sub-rota /dashboard/cadastros/plano-contas/vinculos.
-- Reaudit aud8 (#5082, nota 96): os 3 botões de ação em massa (Propor/Confirmar/Descartar proposta)
-- e as abas de filtro de situação ainda não tinham <AjudaCampo/>. Esta migration ADITIVA cria as
-- 4 chaves de ajuda em erp_ajuda_campo (texto em linguagem do usuário); a tela passa a renderizar o "?".
-- Aditiva e idempotente (ON CONFLICT (chave)). Nenhum dado de cliente tocado.
-- Code: code-desenvolvedor-3

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('plano_contas_vinc.filtros', '/dashboard/cadastros/plano-contas/vinculos', 'Filtros', 'Filtrar por situação',
  'Clique numa aba para mostrar só as contas naquela situação: Pendências (ainda sem confirmar), Sem vínculo, Propostos ou Confirmados. A aba trabalha junto com a busca por texto ao lado.',
  'Foca o trabalho na etapa que importa agora — por exemplo, ver só o que falta amarrar (Pendências) sem o ruído das contas já confirmadas.',
  'Clicar em "Pendências" para listar apenas as contas contábeis que ainda não têm vínculo confirmado e tratar o lote.',
  'Estranhar a lista "vazia": é só o filtro ativo. Volte para "Todas" para ver o plano inteiro.',
  'cadastros', 5, 1, 'publicado'),
 ('plano_contas_vinc.propor', '/dashboard/cadastros/plano-contas/vinculos', 'Ações em massa', 'Propor (em massa)',
  'Aplica a conta gerencial escolhida acima como PROPOSTA para todas as contas contábeis marcadas na lista. O número no botão mostra quantas serão afetadas.',
  'Monta o mapeamento de uma vez só; a proposta continua editável até você confirmar, então dá para revisar antes de travar.',
  'Marcar 12 contas de despesa, escolher a gerencial "Despesas administrativas" e clicar em Propor (12).',
  'Propor e achar que já acabou: o vínculo fica PROPOSTO (editável). Só vira definitivo no botão Confirmar.',
  'cadastros', 6, 1, 'publicado'),
 ('plano_contas_vinc.confirmar', '/dashboard/cadastros/plano-contas/vinculos', 'Ações em massa', 'Confirmar (em massa)',
  'Confirma, de uma vez, os vínculos PROPOSTOS das contas marcadas. O número no botão mostra quantos vínculos serão confirmados.',
  'Confirmado é a versão definitiva que alimenta o DRE e os relatórios por conta gerencial — fecha o mapeamento revisado.',
  'Depois de revisar as propostas de um lote, marcar todas e clicar em Confirmar (12).',
  'Confirmar sem revisar: uma vez CONFIRMADO o vínculo é imutável (regra da contabilidade); para corrigir é preciso criar outra conta gerencial.',
  'cadastros', 7, 1, 'publicado'),
 ('plano_contas_vinc.descartar', '/dashboard/cadastros/plano-contas/vinculos', 'Ações em massa', 'Descartar proposta (em massa)',
  'Remove a PROPOSTA de vínculo das contas marcadas: a conta contábil volta para "sem vínculo", para você propor outra conta gerencial. Só afeta propostas (não mexe em confirmados).',
  'Desfaz um lote proposto errado sem precisar ir linha por linha, antes de confirmar.',
  'Perceber que o lote foi proposto para a gerencial errada, marcar as contas e clicar em Descartar proposta.',
  'Esperar descartar um vínculo CONFIRMADO: o botão só atua sobre PROPOSTAS; confirmados são imutáveis.',
  'cadastros', 8, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, status = 'publicado', atualizado_em = now();
