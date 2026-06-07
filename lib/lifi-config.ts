// lib/lifi-config.ts
import { createClient } from '@lifi/sdk';

// Cria e exporta a instância do cliente configurado para a Versão 3
export const lifiClient = createClient({
  integrator: 'CriptoMorseARC', // Seu nome de integrador (max 23 chars)
});