-- EHS › /dashboard/ehs/setores · critério (e) "língua do cliente": a coluna "Slug" expunha jargão técnico
-- na listagem (auditor 22/11, nota 94). O slug é auto-gerado e não editável, mas é um identificador útil
-- (estável para integrações/relatórios), então em vez de esconder renomeamos para "Identificador".
-- A tela já troca o header (page.tsx). Aqui alinhamos o texto de ajuda (erp_ajuda_campo) à nova palavra,
-- removendo "slug" do conteúdo VISÍVEL ao usuário. A CHAVE interna (ehs.setores.col_slug) permanece.
--
-- Prova RD-38 (BEGIN…ROLLBACK): 1 linha afetada. Aditivo/idempotente (UPDATE do mesmo conteúdo);
-- não toca estrutura, RLS nem dado de cliente. RD-52: arquivo + PR, acima da main, faixa :45.

UPDATE public.erp_ajuda_campo
   SET rotulo = 'Identificador',
       o_que_preencher = 'É o identificador do setor, gerado automaticamente a partir do nome (sem acentos nem espaços). Não é editável.',
       exemplo = 'O nome "Caldeiraria" vira o identificador "caldeiraria".',
       erro_comum = 'Tentar alterar o identificador — ele é fixo; para mudar o rótulo, edite o Nome.'
 WHERE chave = 'ehs.setores.col_slug';
