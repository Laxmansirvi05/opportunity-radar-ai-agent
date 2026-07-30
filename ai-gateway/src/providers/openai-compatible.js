const { BaseProvider } = require("./base-provider");

class OpenAiCompatibleProvider extends BaseProvider {
  constructor({ endpoint, ...options }) {
    super(options);
    this.endpoint = endpoint;
  }

  async generate(input, signal) {
    const messages = [
      ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
      { role: "user", content: input.prompt }
    ];
    const data = await this.httpPost(this.endpoint, {
      model: this.model,
      messages,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
      ...(input.responseFormat === "json" ? { response_format: { type: "json_object" } } : {})
    }, {
      headers: { authorization: `Bearer ${this.apiKey}` },
      signal
    });
    return this.extractText(data?.choices?.[0]?.message?.content);
  }
}

module.exports = { OpenAiCompatibleProvider };
