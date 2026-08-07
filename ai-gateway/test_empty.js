const { validateApiRequest } = require("./src/validation");
const { createTaskRegistry } = require("./src/tasks");
const { TaskService } = require("./src/task-service");
const { GatewayService } = require("./src/gateway-service");
const { createProviders } = require("./src/providers");
const { loadConfig } = require("./src/config");

require("dotenv").config();
const config = loadConfig(process.env);
const providers = createProviders(config);
const gateway = new GatewayService({ providers, config, logger: { info:console.log, warn:console.log, error:console.log, debug:console.log } });
const taskService = new TaskService({ gateway, registry: createTaskRegistry(), logger: { info:console.log, warn:console.log, error:console.log, debug:console.log } });

async function run() {
  try {
    const input = { text: "   " }; // empty resume!
    const res = await taskService.execute("build_profile", input, { requestId: "test" });
    console.log("Success:", JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("Error:", e.message);
  }
}
run();
