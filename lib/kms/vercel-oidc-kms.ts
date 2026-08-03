import { KMSClient } from "@aws-sdk/client-kms"
import { fromWebToken } from "@aws-sdk/credential-providers"
import { getVercelOidcToken } from "@vercel/oidc"

export interface VercelOidcKmsEnvironment {
  region: string
  roleArn: string
  keyArn: string
  expectedAddress: string
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required server-only environment variable: ${name}`)
  return value
}

export function readVercelOidcKmsEnvironment(): VercelOidcKmsEnvironment {
  return {
    region: requiredEnv("AWS_REGION"),
    roleArn: requiredEnv("AWS_ROLE_ARN"),
    keyArn: requiredEnv("CRON_KMS_KEY_ARN"),
    expectedAddress: requiredEnv("CRON_EXPECTED_SIGNER_ADDRESS"),
  }
}

export async function createVercelOidcKmsClient(
  env = readVercelOidcKmsEnvironment(),
): Promise<KMSClient> {
  const webIdentityToken = await getVercelOidcToken()
  if (!webIdentityToken) throw new Error("Vercel did not provide an OIDC token")

  return new KMSClient({
    region: env.region,
    credentials: fromWebToken({
      roleArn: env.roleArn,
      roleSessionName: "arcflow-ri-bank-32",
      webIdentityToken,
      clientConfig: { region: env.region },
    }),
  })
}
