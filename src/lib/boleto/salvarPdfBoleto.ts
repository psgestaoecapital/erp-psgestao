// Armazenamento do PDF de boleto — caminho ÚNICO compartilhado por Bradesco/Sicoob/Sicredi
// (e pelo /api/boleto/pdf). A FONTE do PDF varia por banco (2ª via nativa do banco ou o gerador
// FEBRABAN local), mas gravar é sempre igual: sobe no bucket privado 'boletos' com path por
// company_id e devolve uma signed URL de 1 ano. Antes essa lógica estava copiada em cada rota;
// consolidar aqui evita divergência (RD-26).
//
// Segurança: o bucket 'boletos' é PRIVADO (public=false) e NÃO tem policy de RLS em
// storage.objects — só service_role (esta função, via supabaseAdmin) escreve/lê. O cliente recebe
// apenas a signed URL (token temporário). Boleto tem CPF/nome/endereço do pagador; nada disso é
// acessível por path direto nem por outra empresa.
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const BUCKET = 'boletos'
const UM_ANO_SEG = 60 * 60 * 24 * 365

/** Path do objeto no bucket: sempre <company_id>/<receber_id>.pdf (upsert sobrescreve na 2ª via). */
export function pathBoletoPdf(companyId: string, receberId: string): string {
  return `${companyId}/${receberId}.pdf`
}

/**
 * Sobe os bytes do PDF no bucket 'boletos' (upsert) e devolve a signed URL de 1 ano.
 * Não lança: em falha devolve { url: null, erro } para a rota decidir (logar / seguir sem PDF).
 */
export async function salvarPdfBoletoNoBucket(
  companyId: string, receberId: string, pdfBytes: Uint8Array | Buffer,
): Promise<{ url: string | null; erro?: string }> {
  const objectPath = pathBoletoPdf(companyId, receberId)
  const up = await supabaseAdmin.storage.from(BUCKET)
    .upload(objectPath, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true })
  if (up.error) return { url: null, erro: `upload PDF falhou: ${up.error.message}` }
  const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(objectPath, UM_ANO_SEG)
  return { url: signed.data?.signedUrl ?? null }
}
