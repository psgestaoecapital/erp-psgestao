// TODO HARDENING (pre-producao real): substituir por vault.create_secret() / pgsodium decrypt.
// Hoje so base64 (NAO seguro · serve so pra HOMOLOG).

export function decryptApiKey(encrypted: string): string {
  if (!encrypted) throw new Error('api_key_encrypted vazia')
  try {
    return Buffer.from(encrypted, 'base64').toString('utf-8')
  } catch {
    throw new Error('api_key_encrypted nao esta em base64 valido')
  }
}

export function decryptCertPassword(encrypted: string): string {
  if (!encrypted) throw new Error('senha_encrypted vazia')
  try {
    return Buffer.from(encrypted, 'base64').toString('utf-8')
  } catch {
    throw new Error('senha_encrypted nao esta em base64 valido')
  }
}
