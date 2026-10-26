# ☕ DUKAFE PDV

Sistema de Ponto de Venda (PDV) desenvolvido para gerenciar atendimento, cozinha, controle de estoque e operações de cafeterias em rede local.

---

## 🚀 Tecnologias e Ferramentas Utilizadas
* **Backend:** Node.js, Express e Socket.io (para comunicação em tempo real entre o atendimento e a cozinha).
* **Banco de Dados:** SQLite (com os arquivos de persistência e logs na pasta `data/`).
* **Frontend:** HTML5, CSS3 e JavaScript.
* **Controle de Versão:** Git e GitHub.

---

## 📁 Estrutura do Projeto
O repositório está organizado com os seguintes arquivos e pastas principais:
* `public/` — Arquivos da interface visual (frontend) do sistema.
* `data/` — Pasta contendo o banco de dados SQLite (`dukafe`, `dukafe.db-shm`, `dukafe.db-wal`).
* `server.js` — Arquivo principal do servidor Node.js.
* `database.js` — Configuração e conexão com o banco de dados.
* `package.json` & `package-lock.json` — Gerenciamento de dependências e pacotes do projeto.
* `GUIA_INSTALACAO.md` — Documentação de instalação do sistema.

---

## 📦 Como Instalar e Executar o Projeto

Se precisar clonar e colocar o sistema para rodar em um novo computador (ou na máquina da cafeteria), siga o passo a passo:

### 1. Clonar o Repositório
Abra o terminal na pasta onde deseja salvar o projeto e execute:
```bash
git clone [https://github.com/wavecoreaudio/dukafepdv.com.git](https://github.com/wavecoreaudio/dukafepdv.com.git)
cd dukafepdv.com
