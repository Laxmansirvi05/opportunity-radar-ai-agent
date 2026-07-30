const { GatewayError } = require("./errors");

class TaskService {
  constructor({ gateway, registry, logger }) {
    this.gateway = gateway;
    this.registry = registry;
    this.logger = logger;
  }

  getTask(name) {
    const task = this.registry.get(name);
    if (!task) {
      throw new GatewayError("INVALID_REQUEST", "Unsupported task", { status: 400 });
    }
    return task;
  }

  async execute(name, input, context) {
    const task = this.getTask(name);
    const normalizedInput = task.validateInput(input);
    const initial = await this.gateway.chat(task.createModelInput(normalizedInput), context);

    try {
      return task.parseAndValidate(initial.text);
    } catch (error) {
      if (error.code !== "TASK_OUTPUT_INVALID") throw error;
      this.logger.warn("task_output_invalid", { requestId: context.requestId, task: task.name, repairAttempt: 1 });
    }

    const repaired = await this.gateway.chat(task.createRepairInput(normalizedInput, initial.text), context);
    try {
      return task.parseAndValidate(repaired.text);
    } catch (error) {
      if (error.code === "TASK_OUTPUT_INVALID") {
        this.logger.warn("task_repair_failed", { requestId: context.requestId, task: task.name });
      }
      throw error;
    }
  }
}

module.exports = { TaskService };
