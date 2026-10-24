# 🍵 DUKAFE PDV — Guia de Instalação e Uso

## O que é este sistema?

O **DUKAFE PDV** é um sistema completo de Ponto de Venda e Controle de Estoque para a cafeteria DUKAFE. Ele roda **100% no seu computador**, sem precisar de internet após a instalação.

---

## PASSO 1 — Instalar o Node.js (apenas uma vez)

O Node.js é o programa que faz o sistema funcionar. Se você já tem instalado, pule para o Passo 2.

### Windows
1. Acesse: **https://nodejs.org**
2. Clique no botão verde grande **"LTS"** (versão recomendada)
3. Baixe e abra o instalador `.msi`
4. Clique em **Next → Next → Install → Finish**
5. Pronto! O Node.js está instalado.

### Mac (macOS)
1. Acesse: **https://nodejs.org**
2. Baixe o instalador **LTS** para macOS
3. Abra o arquivo `.pkg` e siga as instruções
4. Clique em **Continuar → Instalar → Fechar**

### Linux (Ubuntu/Debian)
Abra o Terminal e digite:
```bash
sudo apt update
sudo apt install nodejs npm -y
```

---

## PASSO 2 — Baixar os arquivos do sistema

1. Baixe o arquivo **`dukafe-pdv.zip`** que foi gerado
2. Crie uma pasta em um lugar de fácil acesso (ex: `C:\DUKAFE` no Windows ou `~/DUKAFE` no Mac/Linux)
3. **Extraia** o conteúdo do ZIP para dentro dessa pasta

Após a extração, você deve ter esta estrutura:
```
DUKAFE/
  dukafe-pdv/
    package.json
    server.js
    database.js
    public/
    data/
```

---

## PASSO 3 — Abrir o Terminal na pasta correta

### Windows
1. Abra a pasta `dukafe-pdv` no Explorador de Arquivos
2. Clique na **barra de endereço** (onde aparece o caminho) e apague o texto
3. Digite **`cmd`** e pressione **Enter**
4. O Terminal (Prompt de Comando) vai abrir **já na pasta certa** ✅

### Mac
1. Abra o **Terminal** (procure em Aplicativos → Utilitários)
2. Digite o comando: `cd ~/DUKAFE/dukafe-pdv` e pressione **Enter**

### Linux
1. Abra o **Terminal**
2. Digite: `cd ~/DUKAFE/dukafe-pdv` e pressione **Enter**

---

## PASSO 4 — Instalar as dependências (apenas uma vez)

Com o Terminal aberto na pasta `dukafe-pdv`, digite o seguinte comando e pressione **Enter**:

```
npm install
```

Aguarde alguns segundos. Você verá textos passando na tela — isso é normal. Quando terminar, o cursor vai piscar novamente.

> ⚠️ Este comando só precisa ser executado **uma única vez**. Nas próximas vezes que for usar o sistema, pule direto para o Passo 5.

---

## PASSO 5 — Iniciar o sistema

No Terminal (ainda na pasta `dukafe-pdv`), digite:

```
npm start
```

Você verá a mensagem:
```
✅ DUKAFE PDV rodando em http://localhost:3000
```

---

## PASSO 6 — Acessar o sistema no navegador

Abra seu navegador (Chrome, Edge, Firefox) e acesse:

**http://localhost:3000**

O sistema vai abrir! 🎉

---

## Como usar o sistema no dia a dia

### Telas disponíveis
| Tela | Endereço | Para quê serve |
|------|----------|----------------|
| PDV (Caixa) | http://localhost:3000 | Fazer vendas |
| Estoque | http://localhost:3000/estoque.html | Gerenciar produtos |
| Caixa Diário | http://localhost:3000/caixa.html | Abrir/fechar caixa, sangria |
| Histórico | http://localhost:3000/historico.html | Ver vendas passadas |

### Fluxo diário recomendado
1. **Manhã:** Acesse **Caixa Diário** → clique em **Abrir Caixa** → informe o troco inicial
2. **Durante o dia:** Use a tela de **PDV** para registrar as vendas
3. **Fim do dia:** Acesse **Caixa Diário** → clique em **Fechar Caixa** → confira o saldo

---

## Atalhos de teclado (tela de PDV)

| Tecla | Ação |
|-------|------|
| **F2** | Foco na busca de produtos |
| **F9** | Abre o modal de pagamento |
| **1** | Seleciona pagamento em Dinheiro |
| **2** | Seleciona pagamento em Pix |
| **3** | Seleciona pagamento em Débito |
| **4** | Seleciona pagamento em Crédito |
| **Enter** | Confirma o pagamento |
| **Esc** | Fecha modal / limpa busca |

---

## Parar o sistema

Para encerrar o servidor, vá ao Terminal e pressione **Ctrl + C**.

---

## Backup dos dados

Os dados do sistema ficam salvos em:
```
dukafe-pdv/data/dukafe.db
```

Para fazer backup, simplesmente **copie este arquivo** para um pendrive ou pasta segura. Para restaurar, substitua o arquivo na mesma pasta.

---

## Problemas comuns

**"npm não é reconhecido como comando"**
→ O Node.js não foi instalado corretamente. Repita o Passo 1.

**"Porta 3000 já em uso"**
→ O sistema já está rodando em outra janela do terminal. Acesse http://localhost:3000 diretamente.

**Página em branco ou erro ao carregar**
→ Certifique-se de que o servidor está rodando (deve aparecer a mensagem verde no terminal).

---

*Sistema desenvolvido para uso exclusivo da DUKAFE Cafeteria. Versão 1.0*
