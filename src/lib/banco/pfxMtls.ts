// Leitura tolerante de PKCS#12 (.pfx) para o mTLS bancário — resolve o "Unsupported PKCS12 PFX data".
//
// PROBLEMA (auditado 24/09/2026): certificados A1 emitidos em FORMATO LEGADO (PKCS#12 cifrado com
// 3DES/RC2 + MAC SHA-1) NÃO são lidos pelo OpenSSL 3 (usado pelo Node no `https.request({ pfx })`).
// O OpenSSL 3 recusa esses arquivos com "Unsupported PKCS12 PFX data" e o boleto/extrato falha.
// Empresas afetadas na base (cert < ~5 KB): FC Pisos (Sicoob), R.R (Bradesco), Proplay, PS Consultoria.
//
// SOLUÇÃO (em código, sem depender de NODE_OPTIONS=--openssl-legacy-provider no host): o node-forge
// lê o PKCS#12 legado em JS puro (é o MESMO parser que já usamos no upload/validação do cert). Aqui
// extraímos a chave privada + a cadeia de certificados e devolvemos PEM `key`/`cert` — que o OpenSSL 3
// aceita nativamente. Assim o mTLS funciona tanto para o cert legado quanto para o moderno.
//
// RD-53 (não quebrar o que funciona): se o node-forge NÃO conseguir abrir o arquivo (ex.: algum
// PKCS#12 muito novo que ele não suporte), caímos no caminho ORIGINAL — devolvemos { pfx, passphrase }
// e deixamos o OpenSSL tentar, exatamente como antes. Os certs modernos (KGF/PS Gestão/Vianz) seguem
// funcionando: o node-forge os lê e devolve PEM (que o OpenSSL aceita) ou, no pior caso, cai no pfx.
import { Buffer } from 'node:buffer'
import forge from 'node-forge'

// Material aceito por https.request/https.Agent: OU o par key+cert (PEM), OU o pfx cru + senha.
export type MtlsMaterial =
  | { key: string; cert: string; ca?: string[] }
  | { pfx: Buffer; passphrase: string }

/**
 * Converte um .pfx (Buffer) + senha em material de mTLS que o OpenSSL 3 aceita.
 * - Sucesso (inclusive PKCS#12 legado): { key, cert, ca? } em PEM (o `cert` é a folha; a cadeia vai em `ca`).
 * - Falha ao parsear com node-forge: { pfx, passphrase } (fallback ao comportamento original — RD-53).
 * Nunca lança: qualquer erro cai no fallback.
 */
export function pfxParaMtls(pfx: Buffer, passphrase: string): MtlsMaterial {
  try {
    const asn1 = forge.asn1.fromDer(pfx.toString('binary'))
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase ?? '')

    // Chave privada: A1 costuma vir como pkcs8ShroudedKeyBag; keyBag como fallback.
    const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []
    const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []
    const key = shrouded.find((b) => b.key)?.key ?? plain.find((b) => b.key)?.key
    if (!key) return { pfx, passphrase }

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
    const certs = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c)
    if (certs.length === 0) return { pfx, passphrase }

    // A folha é o certificado cuja chave pública casa com a chave privada (compara o módulo RSA).
    // Se não der para casar (ex.: chave não-RSA), usa o 1º como folha — que é a ordem típica do A1.
    const keyN = (key as forge.pki.rsa.PrivateKey).n
    const ehFolha = (c: forge.pki.Certificate) => {
      const cn = (c.publicKey as forge.pki.rsa.PublicKey | undefined)?.n
      return !!(keyN && cn && cn.equals(keyN))
    }
    const folha = certs.find(ehFolha) ?? certs[0]
    const cadeia = certs.filter((c) => c !== folha)

    const keyPem = forge.pki.privateKeyToPem(key as forge.pki.PrivateKey)
    const certPem = forge.pki.certificateToPem(folha)
    const caPems = cadeia.map((c) => forge.pki.certificateToPem(c))

    return caPems.length > 0 ? { key: keyPem, cert: certPem, ca: caPems } : { key: keyPem, cert: certPem }
  } catch {
    // node-forge não conseguiu abrir → mantém o caminho original (OpenSSL tenta o pfx).
    return { pfx, passphrase }
  }
}
