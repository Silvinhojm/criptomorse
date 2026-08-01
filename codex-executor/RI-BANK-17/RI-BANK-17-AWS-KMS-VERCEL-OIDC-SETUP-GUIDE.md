# RI-BANK-17 — Guia manual de setup AWS KMS + Vercel OIDC

```text
DOCUMENT_KIND=MANUAL_SETUP_GUIDE
STATUS=GUIA CONCLUÍDO — SETUP NÃO EXECUTADO
CODE_CHANGE_AUTHORIZED=NÃO
CODE_CHANGE_PERFORMED=NÃO
EXECUTION_AUTHORIZED=NÃO
EXECUTION_PERFORMED=NÃO
DATE=2026-07-31
MANDATE=RI-BANK-17
DEPENDE_DE=RI-BANK-16-TECHNICAL-PROPOSAL-CODEX.md
BLOQUEIA=implementação real do signer/plano/lease
AUTOR=Codex
```

## Antes de começar

Este guia cria a identidade criptográfica da futura carteira exclusiva do cron. Ele **não ativa o cron**, **não assina transações**, **não conecta trading** e **não transfere fundos**.

Regra principal durante todo o processo:

> A carteira nova não recebe USDC, POL, ETH, ARC, tokens ou approvals nesta etapa. Salve apenas o endereço público.

Você precisará de:

- acesso administrativo ao projeto ArcFlow na Vercel;
- acesso administrativo a uma conta AWS;
- celular ou chave de segurança para MFA;
- um cartão válido para abrir a conta AWS, caso ainda não exista;
- acesso ao computador onde está `C:\Users\silvi\arcflow`;
- cerca de 30–60 minutos sem pressa.

Não coloque private key, access key, secret access key ou token OIDC em nenhum arquivo. A private key será gerada dentro do KMS e nunca será mostrada.

## Visão simples do que será criado

```text
Vercel production
   └─ prova por OIDC: “sou este projeto, neste time, em production”
         └─ AWS entrega credencial temporária para uma única role
               └─ role pode chamar somente GetPublicKey e Sign
                     └─ em uma única chave KMS secp256k1
```

Valores finais que você guardará:

```text
AWS_REGION
AWS_ACCOUNT_ID
CRON_KMS_KEY_ARN
AWS_ROLE_ARN
CRON_EXPECTED_SIGNER_ADDRESS
VERCEL_TEAM_SLUG
VERCEL_PROJECT_NAME
```

Use o arquivo `VALORES-PARA-PREENCHER.txt` deste pacote para anotar somente esses valores públicos/não secretos.

## Passo 1 — confirmar ou criar a conta AWS

### 1.1 Verificar se já existe uma conta

1. Abra [AWS Management Console](https://console.aws.amazon.com/).
2. Clique em **Sign in to the Console**.
3. Se você já possui uma conta dedicada ao projeto e consegue entrar, não crie outra.
4. Depois de entrar, clique no nome da conta no canto superior direito.
5. Anote o **Account ID**, com 12 dígitos, no campo `AWS_ACCOUNT_ID` do checklist.

Não use uma conta de terceiros ou uma conta cujo e-mail de recuperação você não controla.

### 1.2 Criar uma conta, se necessário

1. Abra [Create an AWS Account](https://signin.aws.amazon.com/signup).
2. Informe um e-mail seguro e permanente para o usuário root.
3. Use um nome claro, por exemplo `ArcFlow Production`.
4. Confirme o código enviado ao e-mail.
5. Crie uma senha longa e exclusiva.
6. Preencha dados de contato e cobrança.
7. Informe o cartão solicitado pela AWS.
8. Conclua a verificação por telefone/SMS.
9. Selecione o plano de suporte **Basic**, salvo se você já tiver decidido contratar outro.
10. Aguarde o e-mail confirmando que a conta foi ativada.

A AWS recomenda que o e-mail root seja recuperável pela organização e que o root não seja usado nas tarefas diárias. [Documentação oficial de criação de conta](https://docs.aws.amazon.com/accounts/latest/reference/getting-started.html).

### 1.3 Proteger o usuário root

1. Entre na AWS escolhendo **Root user**.
2. Abra o menu da conta no canto superior direito.
3. Escolha **Security credentials**.
4. Em **Multi-factor authentication (MFA)**, clique em **Assign MFA device**.
5. Prefira passkey/chave de segurança. Um aplicativo autenticador TOTP também é aceito.
6. Conclua o cadastro e teste o novo login.
7. Guarde os meios de recuperação da conta em local seguro.

A AWS exige MFA para root e recomenda passkey ou chave física quando possível. [Documentação oficial de MFA](https://docs.aws.amazon.com/IAM/latest/UserGuide/enable-mfa-for-root.html).

### 1.4 Criar acesso administrativo cotidiano

Não continue usando root para o trabalho normal.

1. Na busca da AWS, procure **IAM Identity Center**.
2. Abra o serviço e clique em **Enable** se ainda estiver desativado.
3. Vá a **Users** → **Add user**.
4. Cadastre seu nome e um e-mail que você controla.
5. Aceite o convite recebido e configure senha + MFA.
6. No Identity Center, abra **AWS accounts**.
7. Selecione a conta atual e clique em **Assign users or groups**.
8. Selecione seu usuário.
9. Crie/selecione um permission set administrativo, normalmente `AdministratorAccess`, apenas para realizar o setup inicial.
10. Faça logout do root e confirme que consegue entrar pelo portal do Identity Center.

Depois do setup, esse acesso administrativo pode ser reduzido. A AWS recomenda Identity Center/federação no lugar de credenciais IAM permanentes. [Guia oficial de preparação da conta](https://docs.aws.amazon.com/IAM/latest/UserGuide/getting-started-account-iam.html).

### O que você deve ter ao fim do Passo 1

- conta AWS ativa;
- `AWS_ACCOUNT_ID` de 12 dígitos;
- root protegido por MFA;
- acesso administrativo cotidiano sem usar root;
- nenhum access key criado;
- nenhum fundo transferido.

## Passo 2 — escolher e travar a região AWS

Chaves KMS pertencem a uma região. Para o setup inicial, use:

```text
AWS_REGION=us-east-1
Nome no console: US East (N. Virginia)
```

Motivo: a rota atual não define `preferredRegion`, e a região padrão documentada para Vercel Functions é Washington, D.C. (`iad1`). Colocar o KMS em Northern Virginia reduz distância no desenho atual. Se a região da função mudar no futuro, essa escolha deve ser revisada antes da implementação. [Vercel Functions](https://vercel.com/docs/functions).

1. No canto superior direito do console AWS, abra o seletor de região.
2. Escolha **US East (N. Virginia) — us-east-1**.
3. Confirme visualmente que `N. Virginia` aparece no topo antes de criar a chave.
4. Anote `us-east-1` como `AWS_REGION`.

### O que você deve ter ao fim do Passo 2

- `AWS_REGION=us-east-1` anotada;
- console AWS apontando para N. Virginia.

## Passo 3 — criar a chave KMS assimétrica

### 3.1 Abrir o assistente

1. Na busca da AWS, procure **Key Management Service** ou **KMS**.
2. Abra **AWS Key Management Service**.
3. No menu esquerdo, clique em **Customer managed keys**.
4. Clique em **Create key**.

### 3.2 Configuração criptográfica — copie exatamente

Na tela de configuração:

1. **Key type:** selecione `Asymmetric`.
2. **Key usage:** selecione `Sign and verify`.
3. **Key spec:** selecione `ECC_SECG_P256K1`.
4. **Key material origin:** mantenha `KMS`/AWS KMS gerando o material.
5. Se aparecer opção regional, escolha chave normal/single-region; não há necessidade de multi-region neste estágio.
6. Clique em **Next**.

Não escolha RSA, NIST P-256, encrypt/decrypt, key agreement ou imported material. Tipo, uso e spec não podem ser trocados depois da criação. [AWS — criação de chave assimétrica](https://docs.aws.amazon.com/kms/latest/developerguide/asymm-create-key.html).

### 3.3 Alias, descrição e tags

Use:

```text
Alias: arcflow-cron-signer-prod
Description: ArcFlow production cron EVM signer — RI-BANK-17
```

Tags opcionais:

```text
Project = ArcFlow
Environment = production
Purpose = cron-evm-signer
```

Não coloque endereço, segredo, e-mail pessoal ou private key em alias, descrição ou tags. Esses campos podem aparecer em logs da AWS.

### 3.4 Administradores da chave

1. Em **Key administrators**, selecione somente sua identidade administrativa do Identity Center.
2. Não selecione a futura role do cron aqui: ela será usuária criptográfica, não administradora.
3. Se houver a opção **Allow key administrators to delete this key**, deixe desmarcada neste primeiro setup.
4. Clique em **Next**.

### 3.5 Usuários da chave — deixar vazio agora

Na tela **Key users**:

1. Não selecione usuário, role ou conta externa.
2. Continue com a lista vazia.

A role Vercel ainda não existe; a AWS rejeita ARN de principal inexistente. A política final será aplicada depois que a role tiver um ARN real. Não use `*` como solução temporária.

### 3.6 Revisar e criar

Antes de confirmar, confira:

```text
Asymmetric
Sign and verify
ECC_SECG_P256K1
KMS-generated material
Region us-east-1
No key users
```

Clique em **Finish** ou **Create key**.

### 3.7 Copiar identificadores

1. Abra a chave recém-criada.
2. Copie o **ARN**, parecido com:

```text
arn:aws:kms:us-east-1:123456789012:key/12345678-abcd-1234-abcd-1234567890ab
```

3. Anote-o como `CRON_KMS_KEY_ARN`.
4. Anote também o Key ID e confirme o alias.

O ARN não é a private key. Ele apenas identifica a chave.

### O que você deve ter ao fim do Passo 3

- chave assimétrica KMS criada em `us-east-1`;
- spec `ECC_SECG_P256K1`;
- uso `SIGN_VERIFY`;
- material gerado dentro do KMS;
- `CRON_KMS_KEY_ARN` copiado;
- lista de key users vazia;
- nenhum fundo transferido.

## Passo 4 — baixar somente a chave pública e derivar o endereço EVM

A public key pode ser baixada; a private key não pode. O endereço Ethereum/Polygon é derivado da public key secp256k1.

### 4.1 Baixar a public key no console

Faça isto antes de aplicar a política final restrita:

1. Em KMS → **Customer managed keys**, abra `arcflow-cron-signer-prod`.
2. Procure a aba/seção **Public key**.
3. Clique em **Download public key**.
4. Salve o arquivo DER com um nome claro, por exemplo:

```text
C:\Users\silvi\Downloads\arcflow-cron-kms-public-key.der
```

Esse arquivo é público. Mesmo assim, não o edite nem o envie a sites aleatórios. [AWS — download de public key](https://docs.aws.amazon.com/kms/latest/developerguide/download-public-key.html).

### 4.2 Derivar o endereço localmente, sem instalar nada novo

O projeto já possui Node.js e `ethers`. Abra PowerShell e execute:

```powershell
Set-Location 'C:\Users\silvi\arcflow'
$env:ARCFLOW_KMS_PUBLIC_KEY_FILE = 'C:\Users\silvi\Downloads\arcflow-cron-kms-public-key.der'
node -e "const fs=require('node:fs');const {createPublicKey}=require('node:crypto');const {computeAddress}=require('ethers');const der=fs.readFileSync(process.env.ARCFLOW_KMS_PUBLIC_KEY_FILE);const jwk=createPublicKey({key:der,format:'der',type:'spki'}).export({format:'jwk'});if(jwk.crv!=='secp256k1'||!jwk.x||!jwk.y)throw new Error('Public key não é secp256k1');const pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);console.log(computeAddress(pub));"
```

Saída esperada:

```text
0x...endereço de 40 caracteres hexadecimais...
```

O comando:

- lê somente o arquivo público;
- confirma que a curva é `secp256k1`;
- monta a public key não comprimida;
- usa `ethers.computeAddress()` para gerar o endereço com checksum;
- não acessa Redis, wallet existente, RPC ou blockchain;
- não assina nem transmite nada.

Copie a saída como:

```text
CRON_EXPECTED_SIGNER_ADDRESS=0x...
```

Não rode ferramenta online de “converter private key”. Você nunca terá e nunca precisará da private key.

### 4.3 Conferência manual

Confira:

- começa com `0x`;
- possui 42 caracteres ao todo;
- não é igual às wallets antigas do projeto;
- foi produzido a partir do arquivo da chave KMS correta.

### O que você deve ter ao fim do Passo 4

- arquivo público DER;
- `CRON_EXPECTED_SIGNER_ADDRESS` novo e exclusivo;
- nenhuma private key;
- nenhum fundo enviado ao endereço.

## Passo 5 — ativar Vercel OIDC em modo Team

### 5.1 Coletar nomes exatos

1. Abra [Vercel Dashboard](https://vercel.com/dashboard).
2. Entre no projeto ArcFlow/CriptoMorse que atende produção.
3. Observe a URL:

```text
https://vercel.com/<TEAM_SLUG>/<PROJECT_NAME>
```

4. Copie exatamente:

```text
VERCEL_TEAM_SLUG=<TEAM_SLUG>
VERCEL_PROJECT_NAME=<PROJECT_NAME>
```

Não use nome de exibição aproximado; use os slugs/nomes presentes na URL e nas configurações do projeto.

### 5.2 Habilitar Secure Backend Access

1. Dentro do projeto, abra **Settings**.
2. Abra **Security**.
3. Procure **Secure Backend Access with OIDC Federation**.
4. Habilite o recurso, se estiver desligado.
5. Em **Issuer mode**, selecione **Team**.
6. Salve.

O modo Team é recomendado pela Vercel porque o issuer fica específico ao time. [Documentação Vercel OIDC](https://vercel.com/docs/oidc).

Você usará:

```text
Provider URL = https://oidc.vercel.com/<TEAM_SLUG>
Audience     = https://vercel.com/<TEAM_SLUG>
Subject      = owner:<TEAM_SLUG>:project:<PROJECT_NAME>:environment:production
```

### O que você deve ter ao fim do Passo 5

- `VERCEL_TEAM_SLUG` exato;
- `VERCEL_PROJECT_NAME` exato;
- OIDC habilitado em modo Team;
- Provider URL, Audience e Subject montados;
- nenhuma credencial AWS permanente criada.

## Passo 6 — cadastrar a Vercel como OIDC provider na AWS

1. Volte ao console AWS.
2. Na busca, abra **IAM**.
3. No menu esquerdo, clique em **Identity providers**.
4. Clique em **Add provider**.
5. Em **Provider type**, escolha `OpenID Connect`.
6. Em **Provider URL**, informe:

```text
https://oidc.vercel.com/<TEAM_SLUG>
```

7. Em **Audience**, informe:

```text
https://vercel.com/<TEAM_SLUG>
```

8. Confira que não há espaço, barra final extra ou nome de projeto no Provider URL.
9. Clique em **Add provider**.

Fluxo oficial: [Vercel — Connect to AWS](https://vercel.com/docs/oidc/aws).

### O que você deve ter ao fim do Passo 6

- um OIDC identity provider AWS para `oidc.vercel.com/<TEAM_SLUG>`;
- Audience limitada ao seu time;
- nenhum access key ou secret access key.

## Passo 7 — criar a role exclusiva da função Vercel production

### 7.1 Montar a trust policy

Substitua todos os valores entre `<...>` antes de usar:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowOnlyArcFlowVercelProduction",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/oidc.vercel.com/<TEAM_SLUG>"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.vercel.com/<TEAM_SLUG>:aud": "https://vercel.com/<TEAM_SLUG>",
          "oidc.vercel.com/<TEAM_SLUG>:sub": "owner:<TEAM_SLUG>:project:<PROJECT_NAME>:environment:production"
        }
      }
    }
  ]
}
```

Antes de salvar, procure literalmente por `<`. Se ainda houver algum `<...>`, falta substituir.

Não use `StringLike`, `*`, `project:*`, `environment:preview` ou `environment:development`. A decisão fechada permite somente o projeto exato em production.

### 7.2 Criar a role

1. No IAM, vá a **Roles**.
2. Clique em **Create role**.
3. Em trusted entity, escolha **Custom trust policy**.
4. Cole a política acima já preenchida.
5. Clique em **Next**.
6. Na tela de permissões, você pode continuar sem selecionar uma policy gerenciada; adicionaremos uma policy inline específica depois.
7. Use o nome:

```text
ArcFlowCronKmsSignerProduction
```

8. Descrição:

```text
Assumida somente pelo projeto ArcFlow na Vercel production via OIDC.
```

9. Revise e clique em **Create role**.
10. Abra a role criada e copie o **ARN**, parecido com:

```text
arn:aws:iam::123456789012:role/ArcFlowCronKmsSignerProduction
```

11. Anote como `AWS_ROLE_ARN`.

### 7.3 Adicionar a permissions policy mínima

1. Na role, abra **Permissions**.
2. Clique em **Add permissions** → **Create inline policy**.
3. Abra a aba **JSON**.
4. Cole o modelo abaixo, substituindo `<CRON_KMS_KEY_ARN>` pelo ARN real:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOnlyTheCronPublicKey",
      "Effect": "Allow",
      "Action": "kms:GetPublicKey",
      "Resource": "<CRON_KMS_KEY_ARN>"
    },
    {
      "Sid": "SignOnlyWithTheCronKey",
      "Effect": "Allow",
      "Action": "kms:Sign",
      "Resource": "<CRON_KMS_KEY_ARN>",
      "Condition": {
        "StringEquals": {
          "kms:SigningAlgorithm": "ECDSA_SHA_256"
        }
      }
    }
  ]
}
```

5. Nome da policy:

```text
ArcFlowCronKmsSignOnly
```

6. Crie a policy.

O `Resource` deve ser o ARN completo da única chave. Não use `*`, alias ARN ou outra chave. A AWS exige o key ARN para escopo de chave em IAM policy. [AWS — especificar chave em IAM policy](https://docs.aws.amazon.com/kms/latest/developerguide/cmks-in-iam-policies.html).

### O que você deve ter ao fim do Passo 7

- role `ArcFlowCronKmsSignerProduction`;
- trust limitada a time + projeto + production exatos;
- `AWS_ROLE_ARN` copiado;
- policy permitindo apenas `GetPublicKey` e `Sign` na chave específica;
- `Sign` limitado a `ECDSA_SHA_256`;
- nenhum wildcard financeiro ou KMS.

## Passo 8 — aplicar a key policy final restrita

Agora que a role existe, volte à chave KMS e aplique a política final. Essa é a segunda passagem necessária.

### 8.1 Descobrir o ARN da sua identidade administrativa

Na política atual da chave, a AWS já terá colocado a identidade selecionada como **Key administrators**. Copie o ARN dessa identidade, sem inventar outro valor. Ele pode parecer com uma role do IAM Identity Center.

Anote temporariamente como:

```text
AWS_ADMIN_PRINCIPAL_ARN=arn:aws:iam::123456789012:role/...
```

Esse valor não vai para a Vercel.

### 8.2 Abrir a política

1. AWS KMS → **Customer managed keys**.
2. Abra `arcflow-cron-signer-prod`.
3. Abra a aba **Key policy**.
4. Escolha **Switch to policy view** ou **Edit**.
5. Antes de alterar, copie a política atual para um arquivo de backup local.

### 8.3 Modelo final

Substitua os três placeholders: account ID, admin principal ARN e cron role ARN.

```json
{
  "Version": "2012-10-17",
  "Id": "arcflow-cron-kms-policy-v1",
  "Statement": [
    {
      "Sid": "AllowAccountRecoveryOfKeyPolicy",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::<AWS_ACCOUNT_ID>:root"
      },
      "Action": [
        "kms:GetKeyPolicy",
        "kms:PutKeyPolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowAdministrationWithoutCryptographicUse",
      "Effect": "Allow",
      "Principal": {
        "AWS": "<AWS_ADMIN_PRINCIPAL_ARN>"
      },
      "Action": [
        "kms:Create*",
        "kms:Describe*",
        "kms:Enable*",
        "kms:List*",
        "kms:Put*",
        "kms:Update*",
        "kms:Revoke*",
        "kms:Disable*",
        "kms:GetKeyPolicy",
        "kms:GetKeyRotationStatus",
        "kms:Delete*",
        "kms:TagResource",
        "kms:UntagResource",
        "kms:ScheduleKeyDeletion",
        "kms:CancelKeyDeletion"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowCronRoleToReadPublicKey",
      "Effect": "Allow",
      "Principal": {
        "AWS": "<AWS_ROLE_ARN>"
      },
      "Action": "kms:GetPublicKey",
      "Resource": "*"
    },
    {
      "Sid": "AllowCronRoleToSign",
      "Effect": "Allow",
      "Principal": {
        "AWS": "<AWS_ROLE_ARN>"
      },
      "Action": "kms:Sign",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:SigningAlgorithm": "ECDSA_SHA_256"
        }
      }
    }
  ]
}
```

Em key policy, `Resource: "*"` significa “esta própria chave”, porque a policy está anexada diretamente a ela. O principal nunca deve ser `*`.

### 8.4 Revisão obrigatória antes de salvar

Procure e confirme:

- nenhum `<...>` restante;
- nenhum `Principal: "*"`;
- nenhum usuário/role antiga em declaração de uso criptográfico;
- somente a cron role possui `kms:GetPublicKey` e `kms:Sign`;
- o administrador pode administrar, mas sua lista não contém `kms:Sign` nem `kms:GetPublicKey`;
- root tem apenas recuperação da policy, não assinatura;
- a cron role não possui `kms:PutKeyPolicy`, delete, grants ou administração.

Salve. Se a AWS avisar que a chave ficará inadministrável, não force: restaure a policy anterior e confira o ARN administrativo.

Key policies são a autoridade principal do KMS. Não usar `Principal: *` é recomendação explícita da AWS. [AWS — key policy](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-overview.html).

### O que você deve ter ao fim do Passo 8

- key policy final salva;
- somente a role do cron com uso criptográfico;
- administrador sem `Sign`/`GetPublicKey` operacional;
- mecanismo de recuperação de policy preservado;
- nenhuma role ampla e nenhum wildcard de principal.

## Passo 9 — salvar os valores na Vercel

### 9.1 Variáveis necessárias

No projeto correto da Vercel:

1. Abra **Settings** → **Environment Variables**.
2. Crie as quatro variáveis abaixo:

```text
AWS_REGION=us-east-1
AWS_ROLE_ARN=arn:aws:iam::<account-id>:role/ArcFlowCronKmsSignerProduction
CRON_KMS_KEY_ARN=arn:aws:kms:us-east-1:<account-id>:key/<key-id>
CRON_EXPECTED_SIGNER_ADDRESS=0x...
```

3. Marque **somente Production** para todas.
4. Não marque Preview nem Development.
5. Salve.

Esses valores identificam recursos, mas não são private keys. Ainda assim, mantenha-os server-only: nunca use prefixo `NEXT_PUBLIC_`.

### 9.2 O que não deve ser criado

Não crie:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN
VERCEL_OIDC_TOKEN manual
CRON_TRADING_PRIVATE_KEY
NEXT_PUBLIC_CRON_KMS_KEY_ARN
NEXT_PUBLIC_CRON_EXPECTED_SIGNER_ADDRESS
```

O token OIDC é fornecido automaticamente pela Vercel à função. Não copie nem persista esse token. A Vercel troca o token por credenciais AWS temporárias. [Vercel OIDC](https://vercel.com/docs/oidc).

### 9.3 Não testar ainda

Não crie rota de teste, não chame `kms:Sign`, não faça deploy de código improvisado e não tente “ver se funciona” por ferramenta externa. O próximo mandato implementará um teste controlado e revisável.

Alterações de environment variables da Vercel só passam a deployments posteriores. Não é necessário redeploy agora, pois ainda não existe código autorizado que as use.

### O que você deve ter ao fim do Passo 9

- quatro variáveis server-only em Production;
- nenhum segredo AWS permanente;
- nenhum token OIDC salvo manualmente;
- nenhum código/deploy/teste executado.

## Passo 10 — checklist final e parada obrigatória

Marque cada item:

- [ ] Conta AWS sob seu controle.
- [ ] Root protegido por MFA.
- [ ] Trabalho cotidiano sem root.
- [ ] Região `us-east-1`.
- [ ] Chave `Asymmetric`.
- [ ] Uso `Sign and verify` / `SIGN_VERIFY`.
- [ ] Spec `ECC_SECG_P256K1`.
- [ ] Material gerado dentro do KMS.
- [ ] ARN da chave guardado.
- [ ] Endereço EVM derivado da public key.
- [ ] Endereço diferente das wallets antigas.
- [ ] Vercel OIDC em modo Team.
- [ ] OIDC provider AWS com Audience exata.
- [ ] Trust policy limitada ao projeto exato e `production`.
- [ ] Role com somente `kms:GetPublicKey` e `kms:Sign` na chave exata.
- [ ] Key policy final sem `Principal: *`.
- [ ] Variáveis Vercel somente em Production e sem `NEXT_PUBLIC_`.
- [ ] Nenhuma access key AWS criada.
- [ ] Nenhuma private key existente/exportada.
- [ ] Nenhum fundo ou token enviado.

Ao completar o checklist, **pare**. Entregue ao próximo mandato somente:

```text
AWS_REGION
AWS_ROLE_ARN
CRON_KMS_KEY_ARN
CRON_EXPECTED_SIGNER_ADDRESS
```

Não envie senha, MFA, token OIDC, cookie, access key ou conteúdo de sessão.

## Se algo der errado

### A AWS não aceita a trust policy

- confira o Account ID;
- confirme que o OIDC provider existe;
- confira Team slug, Project name e maiúsculas/minúsculas;
- remova qualquer barra final extra;
- não relaxe para `*` para “fazer funcionar”.

### A AWS diz “Invalid principal” na key policy

- abra a role e copie novamente o ARN real;
- não use nome amigável ou URL do console;
- confirme que a role já foi criada;
- restaure o backup da policy se necessário.

### O comando do endereço falha

- confirme o caminho do arquivo DER;
- execute a partir de `C:\Users\silvi\arcflow`;
- confirme que `node_modules` existe;
- confirme no KMS que a spec é `ECC_SECG_P256K1`;
- não instale conversores de wallet desconhecidos.

### Você perdeu acesso administrativo à chave

- não desabilite nem agende exclusão;
- entre com o acesso de recuperação da conta;
- restaure a key policy anterior;
- se não conseguir, pare e procure AWS Support.

### Custos

Customer-managed KMS keys e chamadas KMS podem gerar cobrança. Consulte a página de preços atual antes de concluir e considere criar um AWS Budget/alerta de custo. Não há necessidade de fazer chamadas `Sign` neste setup.

## Escopo observado pelo Codex

- O Codex não criou conta, chave, role, provider ou variável.
- O Codex não executou o comando de derivação.
- Nenhum código de signer/plano/lease foi criado.
- Nenhum teste, trade, RPC, Redis externo, KMS ou wallet foi acionado.
- Nenhum fundo foi transferido.

