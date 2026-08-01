import { Redis } from "@upstash/redis"

/**
 * Cria um cliente exclusivamente para testes de integração Redis.
 * Não há fallback: as duas credenciais dedicadas são obrigatórias.
 */
export function createTestRedisClient(): Redis {
  const url = process.env.ARCFLOW_TEST_REDIS_URL
  const token = process.env.ARCFLOW_TEST_REDIS_TOKEN
  if (!url || !token) {
    throw new Error(
      "Redis dedicado de teste indisponível: ARCFLOW_TEST_REDIS_URL/ARCFLOW_TEST_REDIS_TOKEN ausentes",
    )
  }
  return new Redis({ url, token })
}

