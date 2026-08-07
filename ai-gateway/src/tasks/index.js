const extractOpportunity = require("./extract-opportunity");
const buildProfile = require("./build-profile");
const scoreFit = require("./score-fit");

function createTaskRegistry(tasks = [extractOpportunity, buildProfile, scoreFit]) {
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
