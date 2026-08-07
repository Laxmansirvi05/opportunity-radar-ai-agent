const PDFDocument = require('pdfkit');
const fs = require('fs');

// 1. Scanned Image Resume (No text, just graphics or empty)
const doc1 = new PDFDocument();
doc1.pipe(fs.createWriteStream('scanned_resume.pdf'));
// Draw a rectangle instead of text to simulate an image/scanned doc
doc1.rect(50, 50, 500, 700).fillAndStroke('lightgray', 'black');
doc1.end();

// 2. No Location Resume
const text = `Aarav Sharma
Frontend / Full Stack Developer | Final Year B.Tech (Computer Science)
aarav.sharma.dev@example.com
Portfolio: https://aaravdev.vercel.app | GitHub: https://github.com/aaravsharma

Professional Summary
Final-year Computer Science student with practical experience developing scalable web applications.

Technical Skills
Languages: JavaScript, TypeScript, Python, SQL, C, C++, HTML5, CSS3
Frontend: React, Next.js, Tailwind CSS, Redux Toolkit, React Query, Framer Motion
Backend: Node.js, Express.js, REST APIs, JWT Authentication

Education
B.Tech – Computer Science & Engineering (2023–2027)
XYZ Institute of Technology
CGPA: 9.28/10
`;

const doc2 = new PDFDocument();
doc2.pipe(fs.createWriteStream('no_location_resume.pdf'));
doc2.text(text);
doc2.end();

console.log("Created test PDFs");
