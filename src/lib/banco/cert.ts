// Validação de certificado A1 (.pfx) a partir do base64 guardado no Vault — para o "Testar conexão".
// Espelha src/lib/fiscal/pfx-parser.ts (que parte de um File), mas parte de base64 (server-side) e foca
// no que o teste de conexão precisa: existe? a senha confere? está dentro da validade / quando vence?
// NÃO faz nenhuma chamada de rede — só abre o PKCS#12 localmente. Node runtime (node-forge).
import forge from 'node-forge'

export type CertStatus = 'ok' | 'ausente' | 'senha_invalida' | 'vencido' | 'expirando' | 'erro' | 'nao_aplicavel'

export type CertInfo = {
  presente: boolean
  senha_ok: boolean
  valido: boolean            // dentro da validade (notBefore ≤ agora ≤ notAfter)
  not_before: string | null  // ISO
  not_after: string | null   // ISO
  dias_para_vencer: number | null
  status: CertStatus
  erro?: string
}

// Quantos dias antes do vencimento já avisar ("expirando").
const DIAS_ALERTA_VENCIMENTO = 30

export function validarCertBase64(base64: string | null | undefined, senha: string | null | undefined): CertInfo {
  const vazio = (status: CertStatus, erro?: string): CertInfo => ({
    presente: status !== 'ausente', senha_ok: false, valido: false,
    not_before: null, not_after: null, dias_para_vencer: null, status, erro,
  })
  if (!base64) return vazio('ausente')

  let asn1: forge.asn1.Asn1
  try {
    asn1 = forge.asn1.fromDer(forge.util.decode64(base64))
  } catch (e) {
    return vazio('erro', 'Arquivo do certificado inválido (não é um .pfx válido): ' + (e instanceof Error ? e.message : String(e)))
  }

  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha ?? '')
  } catch {
    // node-forge lança quando a senha não decifra o PKCS#12 (ou o arquivo está corrompido).
    return vazio('senha_invalida', 'Senha do certificado não confere (ou arquivo corrompido).')
  }

  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = bags[forge.pki.oids.certBag]?.[0]
  if (!certBag?.cert) {
    return { presente: true, senha_ok: true, valido: false, not_before: null, not_after: null, dias_para_vencer: null, status: 'erro', erro: 'Certificado não encontrado dentro do arquivo .pfx.' }
  }

  const nb = certBag.cert.validity.notBefore
  const na = certBag.cert.validity.notAfter
  const agora = new Date()
  const dias = Math.floor((na.getTime() - agora.getTime()) / 86_400_000)
  const dentroValidade = nb <= agora && na >= agora
  let status: CertStatus = 'ok'
  if (na < agora) status = 'vencido'
  else if (dias <= DIAS_ALERTA_VENCIMENTO) status = 'expirando'

  return {
    presente: true, senha_ok: true, valido: dentroValidade,
    not_before: nb.toISOString(), not_after: na.toISOString(),
    dias_para_vencer: dias, status,
  }
}
