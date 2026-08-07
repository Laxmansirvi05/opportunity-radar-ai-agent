const { BaseProvider } = require("./base-provider");

class GeminiProvider extends BaseProvider {
  async generate(input, signal) {
    const data = await this.httpPost(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        ...(input.systemPrompt ? { systemInstruction: { parts: [{ text: input.systemPrompt }] } } : {}),
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        generationConfig: {
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.maxTokens !== undefined ? { maxOutputTokens: input.maxTokens } : {}),
          ...(input.responseFormat === "json" ? { responseMimeType: "application/json" } : {})
        }
      },
      { headers: { "x-goog-api-key": this.apiKey }, signal, timeoutMs: input.timeoutMs }
    );
    return this.extractText(data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join(""));
  }
}

module.exports = { GeminiProvider };
