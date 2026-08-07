const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    results: [
      { title: "Senior Node.js Developer - Google", url: "https://example.com/job1", content: "We are looking for a Senior Node.js Developer in San Francisco, CA. Requires 5 years experience." },
      { title: "Entry Level Developer - Microsoft", url: "https://example.com/job2", content: "Great entry level role for new grads. Needs JS skills. Remote." },
      { title: "Node.js Engineer (reposted) - Startup", url: "https://example.com/job3", content: "Startup looking for engineer. Austin, TX." },
      { title: "5+ years experience developer jobs", url: "https://example.com/job4", content: "This is an aggregator job board with 100s of roles." }
    ]
  }));
});

server.listen(3555, () => console.log('Mock Tavily running on 3555'));
