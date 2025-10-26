Aqui está o PRD (Documento de Requisitos de Produto) detalhado, estruturado para ser compreendido por todas as equipes (Desenvolvimento, Gerenciamento e Comercial), com base na nossa lógica final.

---

### **PRD: Delivery Interativo por IA e Áudio (Hackathon)**

**1\. Sumário Executivo (Para Gerenciamento e Comercial)**

Este documento detalha os requisitos para um protótipo de "Delivery Interativo", um sistema de pedidos de comida via WhatsApp que substitui bots robóticos por uma experiência conversacional fluida. O objetivo deste projeto (contexto Hackathon 24h) é provar a viabilidade de duas inovações principais:

1. **Pedidos por Linguagem Natural:** O cliente pode pedir (por texto ou áudio) "me vê dois filés com fritas e uma coca" e a Inteligência Artificial (IA) entenderá e estruturará o pedido.  
2. **Validação por Áudio:** O cliente "paga" e confirma seu pedido enviando uma mensagem de áudio com uma palavra-chave de segurança, eliminando a necessidade de links de pagamento externos e reduzindo a fricção no fechamento da compra.

A arquitetura técnica é híbrida, projetada para ser rápida e escalável, separando ações instantâneas (cliques de botão) de ações complexas (processamento de IA).

**2\. O Problema (A Oportunidade Comercial)**

O processo de pedido de delivery por WhatsApp hoje é falho e gera abandono de carrinho:

* **Menus Robóticos:** A maioria dos bots força o cliente a um fluxo de "Digite 1 para Pizza, Digite 2 para Bebidas", o que é lento e frustrante.  
* **Links Externos:** Para pagar, o cliente é quase sempre direcionado para fora do WhatsApp (links de pagamento, apps), quebrando a fluidez da conversa e abrindo espaço para desistência.  
* **Falta de Humanização:** A interação é impessoal e não lida bem com a forma natural como as pessoas falam.

**3\. A Solução (A Experiência do Usuário)**

Nossa solução é um assistente de delivery que opera inteiramente dentro do WhatsApp, guiado por uma arquitetura inteligente que entende o estado do cliente.

* **Para o Cliente:** É como conversar com um atendente humano rápido. Ele pede, a IA entende. Ele recebe um resumo. Ele confirma o pedido falando um código. O pedido é aprovado instantaneamente.  
* **Para o Negócio:** Um funil de vendas sem atrito, que captura o pedido de forma natural e usa uma "assinatura de voz" inovadora para fechar a venda com alta segurança e baixa fricção.

**4\. Objetivos e Métricas de Sucesso (Hackathon)**

* **Objetivo 1 (Funcionalidade):** Apresentar um demo funcional E2E (ponta-a-ponta), desde o "oi" do cliente até o "Pedido Validado".  
* **Objetivo 2 (Experiência):** O fluxo de validação por áudio deve funcionar de forma confiável e ser percebido como "mágico" e seguro.  
* **Objetivo 3 (Técnica):** Provar que a arquitetura híbrida (Síncrona/Assíncrona) é funcional, capaz de lidar com botões instantaneamente e IA em segundo plano.

**5\. Arquitetura Técnica (Para Gerenciamento e Devs)**

O sistema é dividido em duas "camadas" lógicas para garantir velocidade e inteligência:

* **Componente 1: O Webhook Síncrono (O "Atendente da Porta")**  
  * **Função:** Recebe **todas** as mensagens do WhatsApp.  
  * **Ação Rápida (Síncrona):** Se a mensagem for um **clique de botão**, o Webhook resolve a lógica *imediatamente* (ex: "Cancelar Pedido", "Finalizar"). Ele mesmo envia a resposta e atualiza o status do cliente.  
  * **Ação Lenta (Delegação):** Se a mensagem for **Texto ou Áudio** (um pedido, uma dúvida, o áudio de validação), o Webhook **NÃO PENSA**. Ele apenas salva a mensagem na tabela mensagem\_temporario e encerra sua função (return 200 OK).  
* **Componente 2: O Orquestrador Assíncrono (O "Cérebro")**  
  * **Função:** Um gatilho no banco de dados (ON INSERT ON mensagem\_temporario) aciona esta função automaticamente sempre que o Webhook "delega" uma mensagem.  
  * **Ação Inteligente (Assíncrona):** O Orquestrador lê a mensagem e, crucialmente, verifica o status\_conversa do cliente. Baseado nesse estado, ele decide o que fazer:  
    * "Cliente está navegando? Vou chamar a LLM."  
    * "Cliente está finalizando\_pedido? Vou validar este áudio."  
    * "Cliente está aguardando\_pedido? Vou enviar o status da entrega."

Esta separação garante que o WhatsApp nunca fique "esperando" pela IA, e que os cliques de botão sejam instantâneos.

**6\. Requisitos Detalhados (Para Desenvolvedores)**

#### **6.1. Esquema do Banco de Dados**

1. **clientes**  
   * id (uuid): Chave primária.  
   * phone\_number (text): O WhatsApp do cliente.  
   * nome (text)  
   * status\_conversa (text): O cérebro do fluxo. **Valores:**  
     * 'navegando' (Default. Carrinho vazio, esperando primeiro item).  
     * 'fazendo\_pedido' (Viu o resumo \+ 3 botões).  
     * 'finalizando\_pedido' (Aguardando áudio-chave).  
     * 'aguardando\_pedido' (Pós-pagamento, esperando entrega).  
2. **pedidos**  
   * id (uuid)  
   * cliente\_id (uuid, FK clientes.id)  
   * status (text): 'iniciado' (carrinho), 'em\_andamento' (validando), 'fechado', 'cancelado'.  
   * palavra\_chave (text, nullable): O código para validação de áudio.  
3. **itens\_pedido**  
   * id (uuid)  
   * pedido\_id (uuid, FK pedidos.id)  
   * cardapio\_item\_id (uuid, FK cardapio.id)  
   * quantidade (integer)  
   * preco\_unitario\_no\_momento (numeric)  
4. **cardapio**  
   * id (uuid)  
   * nome\_item (text)  
   * preco (numeric)  
   * descricao\_ia (text): (Ex: "filé, bife, carne, com batata frita").  
5. **mensagem\_temporario** (O Gatilho Assíncrono)  
   * id (uuid)  
   * cliente\_id (uuid, FK clientes.id)  
   * whatsapp (text): Número do cliente.  
   * mensagem (text): O texto que o cliente enviou ("pergunta").  
   * tem\_audio (boolean)  
   * audio\_base64 (text, nullable)  
   * timestamp\_mensagem (timestamprz)  
   * resposta (text, nullable): O texto que o bot respondeu.  
6. **tabela\_prompts**  
   * id (uuid)  
   * nome\_prompt (text): Ex: "prompt\_pedido\_v1".  
   * texto\_prompt (text): O prompt da LLM.

---

#### **6.2. Fluxo 1: Lógica do Webhook Síncrono (O "Atendente")**

\[POST\] /api/webhook

funcao webhook(request):  
    // 1\. Recebe a mensagem  
    dados \= request.body  
    is\_button \= (dados.button\_id \!= null)

    // 2\. Rota Rápida: Ação de Botão  
    IF (is\_button):  
        cliente \= getCliente(dados.phone\_number)  
          
        // As 3 Ações de Botão que o Webhook resolve NA HORA  
        SWITCH (dados.button\_id):  
              
            CASE 'btn\_finalizar\_pedido':  
                pedido \= getPedidoAtivo(cliente.id)  
                palavra\_chave \= gerarPalavraChave()  
                  
                UPDATE pedidos SET status='em\_andamento', palavra\_chave=palavra\_chave WHERE id=pedido.id  
                UPDATE clientes SET status\_conversa='finalizando\_pedido' WHERE id=cliente.id  
                  
                enviarResposta(cliente.phone, "Perfeito\! Seu código é " \+ palavra\_chave \+ ". Me envie um áudio...")  
                RETURN 200

            CASE 'btn\_adicionar\_mais\_itens':  
                UPDATE clientes SET status\_conversa='navegando' WHERE id=cliente.id  
                enviarResposta(cliente.phone, "Ok, diga qual item você quer adicionar.")  
                RETURN 200

            CASE 'btn\_cancelar\_pedido':  
                pedido \= getPedidoAtivo(cliente.id)  
                  
                DELETE FROM itens\_pedido WHERE pedido\_id \= pedido.id  
                UPDATE pedidos SET status='cancelado' WHERE id=pedido.id  
                INSERT INTO pedidos (cliente\_id, status) VALUES (cliente.id, 'iniciado') // Cria novo carrinho  
                  
                UPDATE clientes SET status\_conversa='navegando' WHERE id=cliente.id  
                  
                enviarResposta(cliente.phone, "Pedido cancelado. Pode começar um novo pedido, o que gostaria?")  
                RETURN 200  
      
    // 3\. Rota Lenta: Delegar para o Orquestrador  
    ELSE (is\_text OU is\_audio):  
        cliente \= getCliente(dados.phone\_number)  
          
        // Apenas salva e sai. O Orquestrador Assíncrono assume daqui.  
        INSERT INTO mensagem\_temporario (cliente\_id, whatsapp, mensagem, tem\_audio, audio\_base64)   
        VALUES (cliente.id, dados.phone, dados.body, dados.tem\_audio, dados.audio\_base64)  
          
        RETURN 200

---

#### **6.3. Fluxo 2: Lógica do Orquestrador Assíncrono (O "Cérebro")**

Gatilho: ON INSERT ON mensagem\_temporario

Função: /api/orquestrador

funcao orquestrador(nova\_mensagem):  
      
    // 1\. Identifica o contexto  
    cliente \= getCliente(nova\_mensagem.cliente\_id)  
    status\_atual \= cliente.status\_conversa  
    resposta\_bot \= ""

    // 2\. Roteador de Status (A Inteligência)  
    SWITCH (status\_atual):

        CASE 'navegando' OR 'fazendo\_pedido':  
            // Cliente está comprando. Vamos chamar a IA.  
            pedido \= getPedidoAtivo(cliente.id)  
            texto\_usuario \= (nova\_mensagem.tem\_audio) ? transcreverAudio(nova\_mensagem.audio\_base64) : nova\_mensagem.mensagem  
              
            prompt \= getPrompt('prompt\_pedido\_v1')  
            cardapio\_formatado \= getCardapioFormatado()  
            json\_itens \= callLLM(prompt, cardapio\_formatado, texto\_usuario)  
              
            // Grava os itens no pedido  
            FOR item IN json\_itens.itens:  
                INSERT INTO itens\_pedido (pedido\_id=pedido.id, cardapio\_item\_id=item.id, ...)  
              
            // Atualiza o status  
            UPDATE clientes SET status\_conversa='fazendo\_pedido' WHERE id=cliente.id  
              
            // Envia o resumo e os 3 botões  
            resumo\_texto \= gerarResumoCarrinho(pedido.id)  
            resposta\_bot \= resumo\_texto  
            enviarMensagemComBotoes(cliente.phone, resposta\_bot, \[BOTOES\_3\])  
            BREAK

        CASE 'finalizando\_pedido':  
            // Cliente está validando.  
            IF (nova\_mensagem.tem\_audio \== false):  
                resposta\_bot \= "Ops, estou aguardando um ÁUDIO com seu código. Por favor, grave o áudio."  
            ELSE:  
                pedido \= getPedidoPendente(cliente.id) // Busca pedido 'em\_andamento'  
                match \= validarAudio(nova\_mensagem.audio\_base64, pedido.palavra\_chave)  
                  
                IF (match):  
                    resposta\_bot \= "✅ Validado\! Seu pedido foi confirmado e já está em produção."  
                    UPDATE pedidos SET status='fechado' WHERE id=pedido.id  
                    UPDATE clientes SET status\_conversa='aguardando\_pedido' WHERE id=cliente.id  
                ELSE:  
                    resposta\_bot \= "❌ Código inválido. Tente enviar o áudio novamente."  
              
            enviarResposta(cliente.phone, resposta\_bot)  
            BREAK

        CASE 'aguardando\_pedido':  
            // Cliente está esperando a entrega.  
            resposta\_bot \= "Olá, " \+ cliente.nome \+ "\! Seu pedido já está com o entregador, deve chegar em cerca de 10 minutos."  
            enviarResposta(cliente.phone, resposta\_bot)  
            BREAK  
              
    // 3\. Finaliza o log  
    UPDATE mensagem\_temporario SET resposta \= resposta\_bot WHERE id \= nova\_mensagem.id

**7\. Fora do Escopo (Não fazer no Hackathon)**

* Qualquer integração real de pagamento (Stripe, Pix).  
* Sistema de login ou cadastro de cliente (o cadastro é implícito pelo nº de WhatsApp).  
* Integração com sistema de logística/cozinha.  
* Tratamento de endereço (vamos presumir endereço fixo).  
* Edição de itens (ex: "tirar 1 item"). O cliente deve "Cancelar" e recomeçar.  
* Um painel de gerenciamento (Admin) para ver os pedidos.

