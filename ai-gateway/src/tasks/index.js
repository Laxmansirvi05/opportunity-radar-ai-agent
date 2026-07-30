const extractOpportunity = require("./extract-opportunity");

function createTaskRegistry(tasks = [extractOpportunity]) {
  const registry = new Map(tasks.map((task) => [task.name, task]));
  return Object.freeze({
    get(name) {
      return registry.get(name);
    },
    has(name) {
      return registry.has(name);
    }
  });
}

module.exports = { createTaskRegistry };
