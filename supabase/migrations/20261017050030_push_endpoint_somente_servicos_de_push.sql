-- Chamado #120 — ajuste do revisor (SSRF): o endpoint é gravado pelo próprio usuário e a edge function push-enviar
-- faz POST nele com service_role. Só https e hosts dos serviços de push (Google/FCM, Apple, Mozilla, Windows).
-- NOT VALID: não reprova linhas antigas, vale para todo INSERT/UPDATE novo.
ALTER TABLE public.erp_push_assinatura
  DROP CONSTRAINT IF EXISTS erp_push_assinatura_endpoint_host_ck;
ALTER TABLE public.erp_push_assinatura
  ADD CONSTRAINT erp_push_assinatura_endpoint_host_ck
  CHECK (endpoint ~* '^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)(:443)?/[^[:space:]]*$')
  NOT VALID;
