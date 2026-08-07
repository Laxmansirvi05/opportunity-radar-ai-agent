const fs = require('fs');

const data = JSON.parse(fs.readFileSync('workflows.json', 'utf8'));

// Find the "Message a model" node
const msgNode = data[0].nodes.find(n => n.name === 'Message a model');
if (msgNode) {
  // Extract the prompt from the langchain messages
  const promptContent = msgNode.parameters.messages?.values[0]?.content || "";
  
  // Transform the node to an httpRequest node
  msgNode.type = 'n8n-nodes-base.httpRequest';
  msgNode.typeVersion = 4;
  msgNode.parameters = {
    method: 'POST',
    url: 'http://localhost:4000/api/ai/chat',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'x-api-key', value: '7Kf92LmPqX4zR8NwLs5YbH3cUv9TxQa1' }
      ]
    },
    sendBody: true,
    specifyBody: 'keypair',
    bodyParameters: {
      parameters: [
        { name: 'prompt', value: promptContent }
      ]
    }
  };
  // Remove ollama credentials
  delete msgNode.credentials;
}

// Find the "Code in JavaScript" node
const codeNode = data[0].nodes.find(n => n.name === 'Code in JavaScript');
if (codeNode) {
  codeNode.parameters.jsCode = codeNode.parameters.jsCode.replace('const raw = $json.content;', 'const raw = $json.content || $json.text || $json.message?.content;');
}

fs.writeFileSync('workflows.json', JSON.stringify(data, null, 2));
console.log('Successfully updated workflows.json');
