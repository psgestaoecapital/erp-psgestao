-- RD-98 p3 · auditor /dashboard/ehs/empresa (score 90, 2 gaps em 2026-11-17):
--   (1) system_screens.views_consumidas e rpcs_chamadas VAZIOS (origem do dado nao registrada);
--   (2) estado_real = 'desconhecida' (tela nao classificada).
--
-- Fontes reais da tela (prova no codigo, RD-38):
--   LEITURA (src/app/dashboard/ehs/empresa/page.tsx:92,99):
--     * tabela compliance_tipos_documento  (tipos de doc da empresa, categoria='empresa')
--     * tabela compliance_documentos       (documentos enviados por empresa/tipo)
--   ESCRITA — acao "Upload" por linha (UploadDocumentoModal -> POST /api/compliance/documentos):
--     grava em compliance_documentos + storage; sem RPC de banco.
--   AJUDA "?" (12 AjudaCampo na tela) -> src/components/ajuda/AjudaCampo.tsx:23,46:
--     * RPC fn_ajuda_campo_listar (carrega os textos de ajuda por rota)
--     * RPC fn_ajuda_campo_uso    (registra o uso do "?")
--
-- Estado antes (producao): views_consumidas = NULL; rpcs_chamadas = NULL; estado_real = 'desconhecida'.
-- A tela esta funcional (leitura + upload + "?"), porem a origem do dado nao foi documentada e a
-- rota nao estava classificada -> fica <95 ate fechar RD-98 p3.
--
-- Correcao corretiva e idempotente (so metadado de registro da tela; nao toca RLS, dado de cliente,
-- storage, nem comportamento): registra as fontes reais e classifica como 'parcial' (consistente
-- com as demais telas de compliance que leem tabela direto e tem CRUD funcional).

UPDATE public.system_screens
   SET views_consumidas = ARRAY['compliance_tipos_documento','compliance_documentos']::text[],
       rpcs_chamadas    = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
       estado_real      = 'parcial',
       atualizado_em    = now()
 WHERE rota = '/dashboard/ehs/empresa';
