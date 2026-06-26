require('dotenv').config();
// scripts/verifyERC8183Arc.js
// Verifica ERC8183 no arcscan

const { readFileSync, existsSync, readdirSync } = require('fs');
const path = require('path');

const CONTRACT_ADDRESS = '0x319227cf1de5c61d11313af8226a8f5309fa70d9';
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
        const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        sources[rel] = { content: readFileSync(fullPath, 'utf8') };
      }
    }
  }
  walk(dir, dir);
  return sources;
}

async function main() {
  const contractSource = readFileSync('contracts/ERC8183.sol', 'utf8');
  const agentIdentitySource = readFileSync('contracts/AgentIdentity.sol', 'utf8');

  let prefixedOZ = {};
  const ozDir = 'node_modules/@openzeppelin/contracts';
  if (existsSync(ozDir)) {
    const ozSources = collectSources(ozDir);
    for (const [key, value] of Object.entries(ozSources)) {
      prefixedOZ['@openzeppelin/contracts/' + key] = value;
    }
  }

  const sources = {
    'contracts/ERC8183.sol': { content: contractSource },
    'contracts/AgentIdentity.sol': { content: agentIdentitySource },
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

  const boundary = '----Boundary' + Math.random().toString(36).slice(2);
  const CRLF = '\r\n';

  const fields = {
    address_hash: CONTRACT_ADDRESS,
    compiler_version: COMPILER_VERSION,
    contract_name: 'contracts/ERC8183.sol:ERC8183',
    license_type: 'mit',
    autodetect_constructor_args: 'true',
  };

  let body = '';
  for (const [name, value] of Object.entries(fields)) {
    body += '--' + boundary + CRLF;
    body += 'Content-Disposition: form-data; name="' + name + '"' + CRLF + CRLF;
    body += value + CRLF;
  }

  body += '--' + boundary + CRLF;
  body += 'Content-Disposition: form-data; name="files[0]"; filename="standard-input.json"' + CRLF;
  body += 'Content-Type: application/json' + CRLF + CRLF;
  body += standardInput + CRLF;
  body += '--' + boundary + '--' + CRLF;

  const url = EXPLORER_API + '/smart-contracts/' + CONTRACT_ADDRESS + '/verification/via/standard-input';
  console.log('Verificando ERC8183...');
  console.log('Payload:', Math.round(body.length / 1024), 'KB');

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body,
  });
  const text = await resp.text();
  console.log('Status:', resp.status, text);

  if (resp.ok) {
    console.log('\nOK! Aguardando processamento...');
    // Aguarda 15s e verifica
    await new Promise(r => setTimeout(r, 15000));
    const checkResp = await fetch('https://testnet.arcscan.app/api/v2/addresses/' + CONTRACT_ADDRESS);
    const checkData = await checkResp.json();
    console.log('is_verified:', checkData.is_verified);
    if (checkData.is_verified) {
      console.log('\nContrato verificado!');
      console.log('Widgets: https://testnet.arcscan.app/address/' + CONTRACT_ADDRESS + '?tab=widgets');
    }
  }
}

main().catch(e => console.error(e.message));
