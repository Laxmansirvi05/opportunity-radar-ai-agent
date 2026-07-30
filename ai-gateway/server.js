require("dotenv").config();

const { createApp } = require("./src/app");
const { loadConfig } = require("./src/config");
const { createProviders } = require("./src/providers");
const { GatewayService } = require("./src/gateway-service");
const { createLogger } = require("./src/logger");
const { TaskService } = require("./src/task-service");
const { createTaskRegistry } = require("./src/tasks");

const config = loadConfig(process.env);
const logger = createLogger();
const providers = createProviders(config);
const gateway = new GatewayService({ providers, config, logger });
const taskService = new TaskService({ gateway, registry: createTaskRegistry(), logger });
const app = createApp({ gateway, taskService, logger });

const server = app.listen(config.port, () => {
  logger.info("gateway_started", { port: config.port });
});

function shutdown(signal) {
  logger.info("gateway_stopping", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
