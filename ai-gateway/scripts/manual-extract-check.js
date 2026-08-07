require('dotenv').config();
const fs = require('fs');
const sys = fs.readFileSync('./src/tasks/extract-opportunity.js', 'utf8').match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];

async function testExtract(text) {
    const body = {
        model: "google/gemma-4-26b-a4b-it:free",
        messages: [{ role: "system", content: sys }, { role: "user", content: text }],
        response_format: { type: "json_object" }
    };
    
    console.log("Sending text: ", text);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    
    const data = await res.json();
    console.log("Raw Response:");
    if (data.choices && data.choices[0]) {
        console.log(data.choices[0].message.content);
    } else {
        console.log(data);
    }
}

async function run() {
    await testExtract("We need a dev in San Francisco, CA, USA");
    await testExtract("based in Austin, Texas");
    await testExtract("Remote - New York based team");
    await testExtract("London, UK office");
}
run();
