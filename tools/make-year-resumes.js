'use strict';

/**
 * make-year-resumes.js — three resumes that differ ONLY in graduation year,
 * so year routing is the single variable under test.
 *
 * Uses the current year so the fixtures do not rot.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const CY = new Date().getFullYear();
const OUT = path.resolve(__dirname, '..', 'test-resumes');
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  { file: 'resume-2nd-year.pdf',   start: CY - 1, end: CY + 3, label: '2nd Year',    expect: 'internship' },
  { file: 'resume-final-year.pdf', start: CY - 3, end: CY + 1, label: 'Final Year',  expect: 'job' },
  { file: 'resume-graduate.pdf',   start: CY - 6, end: CY - 2, label: 'Graduated',   expect: 'job' },
];

function body({ start, end, label }) {
  const graduated = end < CY;
  return `Aarav Sharma
Frontend / Full Stack Developer | ${label} B.Tech (Computer Science)
Hyderabad, Telangana, India
aarav.sharma.dev@example.com
Portfolio: https://aaravdev.vercel.app | GitHub: https://github.com/aaravsharma

Professional Summary
${graduated
  ? `Computer Science graduate (${end}) with practical experience developing scalable web applications.`
  : `${label} Computer Science student with practical experience developing scalable web applications.`}

Technical Skills
Languages: JavaScript, TypeScript, Python, SQL, C, C++, HTML5, CSS3
Frontend: React, Next.js, Tailwind CSS, Redux Toolkit, React Query
Backend: Node.js, Express.js, REST APIs, JWT Authentication
Databases: PostgreSQL, MongoDB, Redis
Tools: Git, GitHub, Docker, Postman, Vercel

Education
B.Tech - Computer Science & Engineering (${start}-${end})
XYZ Institute of Technology, Hyderabad, Telangana
CGPA: 9.28/10

Experience
Frontend Developer${graduated ? '' : ' (Part-time)'} - Acme Digital, Hyderabad
Built and shipped React interfaces for a customer analytics dashboard.
Technologies: React, TypeScript, Node.js

Projects
DevConnect - Full stack developer community platform
Built with Next.js, Node.js, PostgreSQL. Implemented JWT auth and real-time chat.

TaskFlow - Kanban project management tool
Built with React, Redux Toolkit, Express, MongoDB.

Achievements
Winner, XYZ Institute Hackathon ${Math.max(start, CY - 2)}
`;
}

for (const c of CASES) {
  const doc = new PDFDocument();
  const target = path.join(OUT, c.file);
  doc.pipe(fs.createWriteStream(target));
  doc.fontSize(10).text(body(c), { align: 'left' });
  doc.end();
  console.log(`  ${c.file.padEnd(24)} education ${c.start}-${c.end}  expect: ${c.expect}`);
}

console.log(`\nWritten to ${OUT} (current year ${CY})`);
