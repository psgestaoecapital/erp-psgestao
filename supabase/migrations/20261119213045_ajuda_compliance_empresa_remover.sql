-- RD-95: "?" da ação "Remover" na tela Documentos da Empresa (/dashboard/ehs/empresa).
-- RD-98 p2 ganhou a ação Excluir (soft-delete do documento enviado); esta migration
-- publica o texto de ajuda do novo botão. Aditiva e idempotente (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'compliance.empresa.remover',
  '/dashboard/ehs/empresa',
  'Documentos da Empresa',
  'Remover',
  'Clique para remover o arquivo já anexado neste tipo de documento. Pede confirmação antes.',
  'Tira da lista um documento enviado por engano ou que não vale mais, deixando a linha pronta para um novo envio. O registro é mantido no histórico (não some do sistema); para apenas trocar por uma versão nova, use Substituir.',
  'Remover um alvará anexado no tipo errado para reenviá-lo no tipo certo.',
  'Usar Remover quando só quer atualizar o documento: nesse caso use Substituir, que preserva o vínculo e o histórico de renovação.',
  'compliance',
  11,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
