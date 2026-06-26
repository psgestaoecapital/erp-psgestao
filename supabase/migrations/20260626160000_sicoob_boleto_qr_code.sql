-- Sicoob boleto hibrido (boleto + Pix QR): persiste o QR code do Pix
-- direto no titulo a receber, junto com a linha digitavel/codigo de barras.
-- Aplicada via MCP em 2026-06-26.
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS boleto_qr_code text;
