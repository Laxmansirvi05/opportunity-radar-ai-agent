function createLogger(output = console) {
  function write(level, event, fields = {}) {
    output.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
  }

  return Object.freeze({
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields)
  });
}

module.exports = { createLogger };
