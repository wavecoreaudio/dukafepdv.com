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

## Primeiro uso depois da atualização (PINs novos)

Os PINs antigos foram **desativados** (eles estavam escritos no código e foram para o GitHub).
Na primeira vez que o sistema iniciar, ele gera **PINs novos e aleatórios** e mostra no terminal:

```
================ PRIMEIRO USO ================
Gerência                 PIN: ????   (admin)
Funcionária 1            PIN: ????   (atendente)
...
```

Os mesmos PINs ficam salvos em `config/PINS_INICIAIS.txt`. Anote, entregue a cada pessoa e depois apague esse arquivo.

### Trocar PINs, nomes ou adicionar pessoas
Com o terminal aberto na pasta do sistema, rode:

```
npm run equipe
```

Um menu vai aparecer (trocar PIN, renomear, adicionar, remover, mudar papel). Não precisa parar o servidor.

- **Gerência (admin):** PDV, caixa, estoque, histórico, cancelamentos. Também pode usar atendimento e cozinha.
- **Atendente:** lança pedidos no celular e usa a tela da cozinha. **Não** acessa caixa, estoque nem histórico.
- Depois de 5 PINs errados seguidos, o aparelho fica bloqueado por alguns segundos.
- O login vale por 16 horas. Depois disso o sistema pede o PIN de novo.

---

## Como usar o sistema no dia a dia

### Telas disponíveis
| Tela | Endereço | Quem usa |
|------|----------|----------|
| PDV (Caixa) | http://localhost:3000 | Gerência |
| Estoque | http://localhost:3000/estoque.html | Gerência |
| Caixa Diário | http://localhost:3000/caixa.html | Gerência |
| Histórico | http://localhost:3000/historico.html | Gerência |
| Relatórios | http://localhost:3000/relatorios.html | Gerência |
| Atendimento (celular) | http://IP-DO-PC:3000/atendimento.html | Atendentes |
| Cozinha | http://IP-DO-PC:3000/cozinha.html | Cozinha |

Quando o sistema inicia, o terminal mostra os endereços certos com o IP do PC.

### Fluxo diário
1. **Abrir:** gerência abre o **Caixa Diário** e informa o troco inicial.
2. **Balcão:** vendas diretas no **PDV**, como antes.
3. **Mesas:**
   - A atendente lança o pedido no celular, com mesa, número de pessoas e observações ("sem açúcar"…).
   - O pedido aparece na **Cozinha**, com cronômetro. A cor muda com 10 e 20 minutos de espera.
   - A cozinha toca em **COMEÇAR** e depois em **PRONTO**. O celular das atendentes apita e vibra.
   - A atendente leva o pedido e toca em **Entregue**.
   - No PDV, o botão **📋 Comandas** (ou **F4**) mostra as mesas que ainda não pagaram. **COBRAR** junta todas as rodadas da mesa num único pagamento.
4. **Fechar:** no **Caixa Diário**, clique em **Fechar Caixa** e informe o dinheiro contado. O caixa **não fecha** se ainda houver comanda sem pagamento. Cobre no PDV ou cancele no Histórico.

> Na tela da cozinha, toque em "ativar o som" ao abrir (o navegador exige um toque). A tela fica acesa sozinha nos navegadores que permitem.

---

## Iniciar sozinho quando o PC ligar

Na pasta do sistema há três arquivos:

| Arquivo | O que faz |
|---|---|
| `iniciar-dukafe.bat` | Abre o sistema (duplo clique). Se o servidor cair, **reinicia sozinho** em 5 segundos e já abre o PDV no navegador. |
| `instalar-inicio-automatico.bat` | Faz o sistema abrir **sozinho e minimizado** toda vez que o Windows ligar. Rode **uma vez**. |
| `remover-inicio-automatico.bat` | Desfaz o início automático. |

> Se mudar a pasta do sistema de lugar (ex.: de Downloads para `C:\DUKAFE`), rode `instalar-inicio-automatico.bat` de novo.

---

## Estoque

- **Controlar estoque (liga/desliga):** desmarque em itens feitos na hora (café, suco, tapioca). Esses itens nunca ficam "sem estoque" e aparecem como **SEM CONTROLE**.
- **+ Repor:** entrada de mercadoria. Dá para anotar o fornecedor e atualizar o preço de custo.
- **⚖️ Ajustar:**
  - **Perda:** quebrou, venceu, caiu ou foi consumo interno.
  - **Contagem:** você conta a prateleira e informa o número certo. O sistema acerta a diferença.
  - O motivo é obrigatório.
- **🕘 Histórico:** mostra cada entrada, venda, cancelamento, perda e ajuste do produto, com o saldo depois de cada um e quem fez.

---

## Relatórios

Menu **📊 Relatórios**. Escolha o período (Hoje, 7 dias, 30 dias, mês…). A tela mostra:
- Faturamento, ticket médio, **lucro bruto** e custo dos produtos (CMV).
  - O custo é o preço de custo cadastrado **no momento da venda**. Para vendas feitas antes desta versão, o sistema usa o custo atual.
- Descontos, cancelamentos, comandas a receber e **perdas de estoque** (em valor de custo).
- Gráfico de faturamento por dia e por horário (horário de pico).
- Tabelas por forma de pagamento, por pessoa, por produto (com margem) e lista de perdas.
- **Exportar CSV** (abre no Excel) e **Imprimir**.

---

## Impressão (cupom, conta da mesa e cozinha)

Formato para impressora térmica de 80 mm. Também funciona em impressora comum. **Não é documento fiscal.**
- **PDV:** depois de uma venda, clique em **🖨️ Imprimir cupom** (ou tecla **P**).
- **Comandas:** **🧾 Conta** imprime a conferência da mesa, com o valor por pessoa.
- **Cozinha:** o botão 🖨️ de cada pedido imprime o ticket, sem preços e com letra grande. Marque **Imprimir novos** para imprimir cada pedido assim que chegar.

Dados que saem no cupom: abra `config/config.json` e preencha a parte `"loja"` (nome, endereço, telefone, CNPJ e a mensagem do rodapé). Depois, reinicie o sistema.

**Dica:** o navegador mostra a janela de impressão a cada cupom. Para imprimir direto, sem perguntar, na impressora padrão do Windows:
1. Defina a impressora térmica como padrão do Windows.
2. Crie um atalho do Chrome com este destino:
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing http://localhost:3000`
3. Abra o PDV (ou a cozinha) sempre por esse atalho.

---

## Atalhos de teclado (tela de PDV)

| Tecla | Ação |
|-------|------|
| **F2** | Foco na busca de produtos |
| **F4** | Abre as comandas das mesas |
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

## Backup dos dados (automático)

- O sistema faz backup **sozinho** ao iniciar e a cada 6 horas, na pasta `data/backups/`. Ficam guardados os 30 mais recentes.
- Antes de qualquer atualização da estrutura do banco, também é salva uma cópia `antes-da-atualizacao_*.db`.
- **Recomendado:** mande uma cópia automática para fora do PC (OneDrive, pendrive). Abra `config/config.json` e preencha a pasta, por exemplo:

```json
{
  "porta": 3000,
  "pastaBackupExtra": "C:\\Users\\lucas\\OneDrive\\Backup DUKAFE",
  "backupACadaHoras": 6
}
```

(no Windows, use **duas** barras `\\` no caminho). Reinicie o sistema depois de alterar.

**Restaurar um backup:**
1. Pare o sistema (Ctrl + C).
2. Apague `data/dukafe.db`, `data/dukafe.db-wal` e `data/dukafe.db-shm`.
3. Copie o backup desejado para `data/` com o nome `dukafe.db`.
4. Inicie de novo.

---

## Dicas de rede

- **IP fixo:** no roteador, reserve o IP do PC do caixa (DHCP estático/reserva). Assim o endereço nos celulares nunca muda.
- **Wi-Fi separado:** se possível, use uma rede para os clientes e outra para o sistema.

---

## Problemas comuns

**"npm não é reconhecido como comando"**
→ O Node.js não foi instalado corretamente. Repita o Passo 1.

**"Porta 3000 já em uso"**
→ O sistema já está rodando em outra janela do terminal. Acesse http://localhost:3000 diretamente.

**Esqueci o PIN da gerência**
→ No PC do caixa, rode `npm run equipe` e troque o PIN (o menu não pede PIN).

**"Sem conexão" no celular ou na cozinha**
→ Confira se o celular está no mesmo Wi-Fi e se o IP do PC não mudou (veja o terminal).

**Página em branco ou erro ao carregar**
→ Certifique-se de que o servidor está rodando (deve aparecer a mensagem verde no terminal).

---

*Sistema desenvolvido para uso exclusivo da DUKAFE Cafeteria. Versão 1.2*
