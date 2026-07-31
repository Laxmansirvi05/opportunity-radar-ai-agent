const extractOpportunity = require("./extract-opportunity");
const buildProfile = require("./build-profile");

function createTaskRegistry(tasks = [extractOpportunity, buildProfile]) {
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
