// #136 (PS Gestão) · "Não está mais puxando o extrato da conta" Sicoob. Desde 24/09 (#1789) o mTLS devolvia a cadeia
// do certificado A1 do CLIENTE em `ca` — em https.request isso SUBSTITUI a lista de CAs confiáveis do Node, e o
// certificado do SERVIDOR do banco deixava de ser verificado ("unable to get local issuer certificate": 8 erros no
// log de 25–26/09). Agora a cadeia vai junto do `cert` e o `ca` não é mais tocado. Teste de regra, sem rede/banco.

import { test, expect } from '../../support/fixtures'
import tls from 'node:tls'
import forge from 'node-forge'
import { pfxParaMtls } from '../../../src/lib/banco/pfxMtls'
import { registrarJornada } from '../../support/api'

function certificado(cn: string, emissor: forge.pki.CertificateField[] | null, pub: forge.pki.PublicKey, assinante: forge.pki.PrivateKey) {
  const c = forge.pki.createCertificate()
  c.publicKey = pub; c.serialNumber = String(Date.now())
  c.validity.notBefore = new Date(); c.validity.notAfter = new Date(Date.now() + 86_400_000)
  const nome = [{ name: 'commonName', value: cn }]
  c.setSubject(nome); c.setIssuer(emissor ?? nome)
  c.sign(assinante as forge.pki.rsa.PrivateKey, forge.md.sha256.create())
  return c
}

test.describe('mTLS bancário — cadeia do cliente não substitui as CAs do servidor (#136)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-sicoob-mtls-136', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('A1 com cadeia (PKCS#12 3DES): sem `ca`, folha + cadeia no `cert`, contexto TLS válido', () => {
    const caKeys = forge.pki.rsa.generateKeyPair(1024)
    const ca = certificado('AC teste', null, caKeys.publicKey, caKeys.privateKey)
    const cliKeys = forge.pki.rsa.generateKeyPair(1024)
    const folha = certificado('cliente A1', ca.subject.attributes, cliKeys.publicKey, caKeys.privateKey)
    const p12 = forge.pkcs12.toPkcs12Asn1(cliKeys.privateKey, [folha, ca], 'senha', { algorithm: '3des' })
    const pfx = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary')

    const m = pfxParaMtls(pfx, 'senha') as Record<string, unknown>
    expect('ca' in m, 'não substitui a lista de CAs confiáveis (era a causa do erro)').toBe(false)
    expect('key' in m && 'cert' in m, 'chave + certificado em PEM').toBe(true)
    expect(String(m.cert).split('BEGIN CERTIFICATE').length - 1, 'folha + cadeia no cert').toBe(2)
    expect(() => tls.createSecureContext(m as tls.SecureContextOptions), 'o OpenSSL aceita o material').not.toThrow()
  })
})
