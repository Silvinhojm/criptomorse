require('dotenv').config();
// scripts/verifyArcscan.js
// Verifica o AgentIdentity na arcscan.app via standard-input

const { readFileSync, readdirSync, existsSync } = require('fs');
const path = require('path');

const CONTRACT_ADDRESS = '0xd2a801E60A0AB36Da3Fb17d4A7654b494bA8326B';
const CONTRACT_PATH = 'contracts/AgentIdentity.sol';
const CONTRACT_NAME = 'contracts/AgentIdentity.sol:AgentIdentity';
const COMPILER_VERSION = 'v0.8.26+commit.8a97fa7a';
const EXPLORER_API = 'https://testnet.arcscan.app/api/v2';

function collectSources(dir) {
  const sources = {};
  function walk(currentDir, baseDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, baseDir);
      } else if (entry.name.endsWith('.sol')) {
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        sources[relativePath] = { content: readFileSync(fullPath, 'utf8') };
      }
    }
  }
  walk(dir, dir);
  return sources;
}

async function main() {
  const contractSource = readFileSync(CONTRACT_PATH, 'utf8');
  const ozDir = 'node_modules/@openzeppelin/contracts';

  let prefixedOZ = {};
  if (existsSync(ozDir)) {
    const ozSources = collectSources(ozDir);
    for (const [key, value] of Object.entries(ozSources)) {
      prefixedOZ[`@openzeppelin/contracts/${key}`] = value;
    }
  }

  const sources = {
    [CONTRACT_PATH]: { content: contractSource },
    ...prefixedOZ,
  };

  const standardInput = JSON.stringify({
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['*'] } },
      evmVersion: 'cancun',
    },
  });

  // Monta multipart form data manual
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
  const CRLF = '\r\n';

  let body = '';
  
  // Campo: address_hash
  body += '--' + boundary + CRLF;
  body += 'Content-Disposition: form-data; name="address_hash"' + CRLF + CRLF;
  body += CONTRACT_ADDRESS + CRLF;

  // Campo: compiler_version
  body += '--' + boundary + CRLF;
  body += 'Content-Disposition: form-data; name="compiler_version"' + CRLF + CRLF;
  body += COMPILER_VERSION + CRLF;

  // Campo: contract_name
  body += '--' + boundary + CRLF;
  body += 'Content-Disposition: form-data; name="contract_name"' + CRLF + CRLF;
  body += CONTRACT_NAME + CRLF;

  // Campo: license_type
  body += '--' + boundary + CRLF;
  body += 'Content-Disposition: form-data; name="license_type"' + CRLF + CRLF;
  body += 'mit' + CRLF;

  // Campo: autodetect_constructor_args
  body += '--' + boundary + CRLF;
  body += 'Content-Disposition: form-data; name="autodetect_constructor_args"' + CRLF + CRLF;
  body += 'true' + CRLF;

  // Arquivo: files[0]
  body += '--' + boundary + CRLF;
  body += 'Content-Disposition: form-data; name="files[0]"; filename="standard-input.json"' + CRLF;
  body += 'Content-Type: application/json' + CRLF + CRLF;
  body += standardInput + CRLF;

  body += '--' + boundary + '--' + CRLF;

  const url = `${EXPLORER_API}/smart-contracts/${CONTRACT_ADDRESS}/verification/via/standard-input`;
  console.log('Enviando para:', url);
  console.log('Compilador:', COMPILER_VERSION);
  console.log('Contrato:', CONTRACT_NAME);
  console.log('Tamanho:', Math.round(body.length / 1024), 'KB');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
      },
      body,
    });

    const text = await response.text();
    console.log(`Status: ${response.status}`);
    console.log('Resposta:', text);

    if (response.ok) {
      console.log('\n✓ Contrato verificado! Acesse:');
      console.log(`https://testnet.arcscan.app/address/${CONTRACT_ADDRESS}?tab=widgets`);
    }
  } catch (err) {
    console.error('Erro:', err.message);
  }
}

main().catch(console.error);
